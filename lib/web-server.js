import crypto from "node:crypto"
import path from "node:path"
import fs from "node:fs"
import { fileURLToPath } from "node:url"
import express from "express"
import { createWebActions } from "./web-actions.js"
import { redact, SerialQueue } from "./storage.js"
import { getManager } from "./manager.js"
import { defaults, validateWebUi } from "./config.js"

export const WEB_PREFIX = "/proxy-plugin"
const distDir = fileURLToPath(new URL("../webui/dist/", import.meta.url))

export class ProxyWebServer {
  constructor({
    actions = createWebActions(),
    staticDir = distDir,
    now = Date.now,
    streamClient,
  } = {}) {
    this.actions = actions
    this.staticDir = staticDir
    this.now = now
    this.streamClient =
      streamClient ||
      (async () => {
        const manager = getManager()
        await manager.initialize()
        return manager.queue.run(() => manager.requireClient())
      })
    this.sessions = new Map()
    this.streams = new Set()
    this.leases = new Set()
    this.router = this.createRouter()
    this.serviceQueue = new SerialQueue()
    this.server = null
    this.options = null
    this.lastError = ""
  }

  attachConfigured(options = defaults.webui, hostApp) {
    return this.serviceQueue.run(async () => {
      validateWebUi(options)
      this.lastError = ""
      if (!options.enabled) return null
      if (this.app) return this.attach(this.app)
      if (options.mountToYunzai) {
        const lease = this.attach(hostApp)
        this.options = structuredClone(options)
        return lease
      }
      const app = express()
      const lease = this.attach(app)
      let server
      try {
        server = app.listen(options.port, options.host)
        await new Promise((resolve, reject) => {
          const ready = () => {
            server.off("error", failure)
            resolve()
          }
          const failure = error => {
            server.off("listening", ready)
            reject(error)
          }
          server.once("listening", ready)
          server.once("error", failure)
        })
        server.on("error", error => {
          this.lastError = redact(error.message)
          globalThis.logger?.error?.(`[Proxy-Plugin] WebUI 服务错误：${this.lastError}`)
        })
        server.unref()
        this.server = server
        this.options = structuredClone(options)
        return lease
      } catch (error) {
        await this.detach(lease)
        server?.close()
        this.lastError = error.code === "EADDRINUSE"
          ? `WebUI 端口 ${options.port} 已被占用，请在锅巴修改独立端口后重启云崽`
          : `WebUI 启动失败：${redact(error.message)}`
        throw new Error(this.lastError)
      }
    })
  }

  release(lease) {
    return this.serviceQueue.run(() => this.detach(lease))
  }

  accessBase(hostUrl) {
    if (!this.app) throw new Error(this.lastError || "WebUI 未启用或尚未启动，请检查锅巴设置并重启云崽")
    if (this.options?.publicUrl) return this.options.publicUrl.replace(/\/+$/, "")
    if (this.server) {
      const host = ["0.0.0.0", "::"].includes(this.options.host) ? "127.0.0.1" : this.options.host
      const address = host.includes(":") ? `[${host}]` : host
      return `http://${address}:${this.server.address().port}`
    }
    const base = String(hostUrl || "").replace(/\/+$/, "")
    if (!/^https?:\/\//.test(base))
      throw new Error("请在云崽 server.url 或锅巴 WebUI 访问地址中设置可访问的 HTTP 地址")
    return base
  }

  createSession(minutes = 30) {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440)
      throw new Error("有效期为 1–1440 分钟")
    this.prune()
    while (this.sessions.size >= 5) this.sessions.delete(this.sessions.keys().next().value)
    const token = crypto.randomBytes(32).toString("hex")
    const expiresAt = this.now() + minutes * 60000
    this.sessions.set(token, expiresAt)
    return { token, expiresAt }
  }

  prune() {
    for (const [token, expiry] of this.sessions)
      if (expiry <= this.now()) this.sessions.delete(token)
  }

  revoke() {
    const count = this.sessions.size
    this.sessions.clear()
    for (const stream of this.streams) stream.abort()
    return count
  }

  authorized(req) {
    this.prune()
    const token = String(req.headers.authorization || "").replace(/^Bearer /, "")
    return /^[a-f0-9]{64}$/.test(token) && this.sessions.has(token)
  }

  createRouter() {
    const router = express.Router()
    router.use((req, res, next) => {
      res.set({
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      })
      next()
    })
    router.use("/api", (req, res, next) => {
      if (!this.authorized(req))
        return res
          .status(401)
          .json({ ok: false, message: "访问链接已过期，请发送 #代理web 获取新链接" })
      const allowedOrigins = [`${req.protocol}://${req.get("host")}`]
      if (this.options?.publicUrl) allowedOrigins.push(new URL(this.options.publicUrl).origin)
      if (req.headers.origin && !allowedOrigins.includes(req.headers.origin))
        return res.status(403).json({ ok: false, message: "请求来源不匹配" })
      next()
    })
    router.get("/api/stream/:channel", async (req, res) => {
      const channel = req.params.channel
      if (!["traffic", "memory", "logs"].includes(channel))
        return res.status(400).json({ ok: false, message: "未知数据流" })
      const level = String(req.query.level || "info")
      if (!["debug", "info", "warning", "error", "silent"].includes(level))
        return res.status(400).json({ ok: false, message: "日志级别无效" })
      const controller = new AbortController()
      this.streams.add(controller)
      res.on("close", () => controller.abort())
      const expiryTimer = setInterval(() => {
        if (!this.authorized(req)) controller.abort()
      }, 1000)
      expiryTimer.unref()
      try {
        const client = await this.streamClient()
        const upstream = await client.stream(channel, controller.signal, level)
        res.set({ "Content-Type": "application/x-ndjson", "X-Accel-Buffering": "no" })
        res.flushHeaders()
        const decoder = new TextDecoder()
        let pending = ""
        for await (const chunk of upstream.body) {
          pending += decoder.decode(chunk, { stream: true })
          if (pending.length > 1024 * 1024) throw new Error("数据流消息过大")
          let end
          while ((end = pending.indexOf("\n")) >= 0) {
            const line = pending.slice(0, end)
            pending = pending.slice(end + 1)
            if (!line.trim()) continue
            const data = JSON.parse(line)
            const safe =
              channel === "logs" ? { type: data.type, payload: redact(data.payload || "") } : data
            if (!res.write(JSON.stringify(safe) + "\n"))
              await new Promise(resolve => {
                const finish = () => {
                  res.off("drain", finish)
                  res.off("close", finish)
                  resolve()
                }
                res.once("drain", finish)
                res.once("close", finish)
              })
            if (controller.signal.aborted) break
          }
          if (controller.signal.aborted) break
        }
      } catch (error) {
        if (!res.headersSent) res.status(400).json({ ok: false, message: redact(error.message) })
      } finally {
        clearInterval(expiryTimer)
        this.streams.delete(controller)
        controller.abort()
        res.end()
      }
    })
    router.post(
      "/api/config/:operation",
      express.text({ type: "text/plain", limit: "8mb" }),
      async (req, res) => {
        const operations = { save: "saveConfigDocument", check: "checkConfigDocument" }
        if (!Object.hasOwn(operations, req.params.operation) || typeof req.body !== "string")
          return res.status(400).json({ ok: false, message: "配置请求无效" })
        try {
          const result = await this.actions[operations[req.params.operation]]({ content: req.body })
          res.json({ ok: true, result })
        } catch (error) {
          res.status(400).json({ ok: false, message: redact(error.message).slice(0, 1500) })
        }
      },
    )
    router.use("/api", express.json({ limit: "10mb" }))
    router.post("/api/action", async (req, res) => {
      const name = req.body?.action
      if (typeof name !== "string" || !Object.hasOwn(this.actions, name))
        return res.status(400).json({ ok: false, message: "未知操作" })
      try {
        const result = await this.actions[name](req.body.args)
        return res.json({ ok: true, result })
      } catch (error) {
        return res.status(400).json({ ok: false, message: redact(error.message).slice(0, 1500) })
      }
    })
    router.use("/api", (req, res) => res.status(404).json({ ok: false, message: "接口不存在" }))
    router.use(express.static(this.staticDir, { index: "index.html", dotfiles: "deny" }))
    router.use((req, res) =>
      res
        .status(404)
        .type("text/plain")
        .send("WebUI 文件不存在，请检查 plugins/Proxy-Plugin/webui/dist"),
    )
    router.use((error, req, res, next) => {
      if (res.headersSent) return next(error)
      res
        .status(error.status === 413 ? 413 : 400)
        .json({ ok: false, message: "请求内容无效或超过大小限制" })
    })
    return router
  }

  attach(app) {
    if (!app?.use) throw new Error("宿主 HTTP 服务未就绪")
    if (!fs.existsSync(path.join(this.staticDir, "index.html")))
      throw new Error("缺少 WebUI 构建产物，请运行 npm run build:web")
    const lease = Symbol("proxy web")
    this.leases.add(lease)
    if (!this.app) {
      this.app = app
      for (const key of ["skip_auth", "quiet"]) {
        app[key] ||= []
        if (!app[key].includes(WEB_PREFIX + "/")) app[key].push(WEB_PREFIX + "/")
      }
      app.use(WEB_PREFIX, this.router)
      const stack = app.router?.stack || app._router?.stack
      const index = stack?.findIndex(layer => layer.handle === this.router)
      if (index >= 0 && this.mountIndex !== undefined && index > this.mountIndex) {
        const [layer] = stack.splice(index, 1)
        stack.splice(Math.min(this.mountIndex, stack.length), 0, layer)
      } else this.mountIndex = index
    }
    return lease
  }

  detach(lease) {
    if (!this.leases.delete(lease)) return
    if (this.leases.size || !this.app) return
    for (const stream of this.streams) stream.abort()
    const stack = this.app.router?.stack || this.app._router?.stack
    const index = stack?.findIndex(layer => layer.handle === this.router)
    if (index >= 0) stack.splice(index, 1)
    for (const key of ["skip_auth", "quiet"])
      this.app[key] = this.app[key]?.filter(value => value !== WEB_PREFIX + "/")
    this.app = null
    this.options = null
    if (this.server) {
      const server = this.server
      this.server = null
      server.closeAllConnections()
      return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  }
}

export function getWebServer() {
  return (globalThis.__proxyPluginWebServerV1 ||= new ProxyWebServer())
}
