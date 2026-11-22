import fs from "node:fs/promises"
import path from "node:path"
import YAML from "yaml"
import { randomBytes } from "node:crypto"
import {
  ConfigStore,
  validateConfig,
  activeSubscription,
  subscriptionId,
  validateUrl,
} from "./config.js"
import { SerialQueue, atomicWrite, readJson, writeJson, redact } from "./storage.js"
import { buildProfile, parseProfile, downloadProfile } from "./profile.js"
import { MihomoClient } from "./client.js"
import { Installer } from "./installer.js"
import { SubscriptionCache } from "./subscriptions.js"
import { Platform } from "../platforms/index.js"
import { SystemProxy } from "../platforms/system.js"
import {
  execFile,
  launchCore,
  terminateCore,
  processIdentity,
  listCoreProcesses,
  sameProcess,
  pause,
} from "./process.js"
import net from "node:net"
import { isDeepStrictEqual } from "node:util"

async function fileText(file) {
  try {
    return await fs.readFile(file, "utf8")
  } catch (error) {
    if (error.code === "ENOENT") return null
    throw error
  }
}

async function portAvailable(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once("error", () =>
      reject(new Error(`本机端口 ${port} 已被占用，拒绝连接或覆盖其他核心`)),
    )
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => server.close(resolve))
  })
}

export function canReloadProfile(previous, next) {
  if (!previous || !next) return false
  const runtimeOptions = text => {
    const profile = YAML.parse(text)
    for (const key of [
      "proxies",
      "proxy-groups",
      "proxy-providers",
      "rules",
      "rule-providers",
      "sub-rules",
    ])
      delete profile[key]
    return profile
  }
  return isDeepStrictEqual(runtimeOptions(previous), runtimeOptions(next))
}

export class ProxyManager {
  constructor({
    root,
    store = new ConfigStore(root),
    platform = new Platform(),
    installer,
    processes = {
      identity: processIdentity,
      list: listCoreProcesses,
      launch: launchCore,
      stop: terminateCore,
    },
    clientFactory = (port, secret) => new MihomoClient(port, secret),
    validator,
    downloader = downloadProfile,
  } = {}) {
    this.store = store
    this.platform = platform
    this.installer = installer || new Installer(store)
    this.processes = processes
    this.clientFactory = clientFactory
    this.downloader = downloader
    this.subscriptions = new SubscriptionCache(store)
    this.subscriptionRetries = new Map()
    this.subscriptionUsage = new Map()
    this.validator =
      validator ||
      (async (binary, file) => {
        await execFile(binary, ["-t", "-d", store.data, "-f", file], { timeout: 30000 })
      })
    this.system = new SystemProxy(store.paths.proxy, platform)
    this.queue = new SerialQueue()
    this.state = null
    this.leases = new Set()
    this.lastError = ""
    this.lastUpdate = 0
    this.failedRestarts = 0
    this.initialized = null
  }

  initialize() {
    this.initialized ??= this.queue
      .run(async () => {
        const config = await this.store.load()
        this.state = await readJson(this.store.paths.state)
        if (!(await this.alive())) {
          const result = await this.system.restore(config)
          if (result.conflicts.length)
            this.lastError = "发现残留系统代理记录，但设置已被修改；保留现场"
        }
      })
      .catch(error => {
        this.initialized = null
        throw error
      })
    return this.initialized
  }

  async client(config = this.state?.config) {
    config ||= await this.store.load()
    return this.clientFactory(config.core.controllerPort, await this.store.secret())
  }

  async alive() {
    if (!this.state?.identity) return false
    const current = await this.processes.identity(this.state.identity.pid)
    if (!current) return false
    if (!sameProcess(current, this.state.identity))
      throw new Error("记录的 PID 已属于其他进程，拒绝接管；请核对本地运行记录")
    return true
  }

  async requireClient() {
    if (!(await this.alive())) throw new Error("本插件核心未运行，请先执行 #代理核心启动")
    const client = await this.client()
    await client.version()
    return client
  }

  async otherCores() {
    const ownedPid = (await this.alive()) ? this.state.identity.pid : null
    const items = (await this.processes.list?.()) || []
    return items.filter(item => item.pid !== ownedPid)
  }

  async assertNoOtherCores() {
    const items = await this.otherCores()
    if (items.length)
      throw new Error(
        `检测到其他程序运行的代理核心：${items
          .slice(0, 8)
          .map(item => `${item.name || "mihomo"}（PID ${item.pid}）`)
          .join("、")}。请先在原程序中停止核心；本插件不会自动接管或关闭它。`,
      )
  }

  async prepare(config, source) {
    validateConfig(config)
    const binary = await this.installer.ensure(config)
    if (config.takeover === "system") await this.platform.system(config)
    if (config.takeover === "tun") await this.platform.checkTun(binary, config)
    const selected = activeSubscription(config)
    let text = source,
      fetched = false
    if (source === undefined) {
      if (selected) {
        text = await this.subscriptions.cached(selected)
        if (text === null) {
          text = await this.fetchSubscription(selected.url, selected.userAgent || config.subscription.userAgent)
          fetched = true
        }
      } else text = await fileText(this.store.paths.local)
    }
    const runtime = YAML.stringify(
      buildProfile(text === null ? null : parseProfile(text), config, await this.store.secret()),
      { lineWidth: 0 },
    )
    const candidate = path.join(this.store.data, "runtime", "candidate.yaml")
    await atomicWrite(candidate, runtime)
    try {
      await this.validator(binary, candidate)
    } catch (error) {
      throw new Error(`mihomo 配置校验失败：${redact(error.stderr || error.message).slice(0, 800)}`)
    }
    return { binary, runtime, source: text, selected, fetched }
  }

  async launch(config, binary) {
    await this.assertNoOtherCores()
    await Promise.all([
      portAvailable(config.core.mixedPort),
      portAvailable(config.core.controllerPort),
    ])
    const elevated =
      process.platform === "win32" && config.takeover === "tun" && config.core.windowsElevate
    const identity = await this.processes.launch(
      binary,
      ["-d", this.store.data, "-f", this.store.paths.runtime],
      this.store.paths.log,
      { elevated, dataDir: this.store.data },
    )
    this.state = { identity, elevated, config: structuredClone(config), startedAt: Date.now() }
    await writeJson(this.store.paths.state, this.state)
    const client = await this.client(config)
    const deadline = Date.now() + config.core.startupTimeoutSeconds * 1000
    while (Date.now() < deadline) {
      if (!(await this.alive())) throw new Error("核心启动后退出，请查看本地核心日志")
      try {
        await client.version()
        return client
      } catch {}
      await pause(200)
    }
    throw new Error("核心控制接口未在启动超时内就绪，请查看本地核心日志")
  }

  async confirmTakeover(config, client) {
    if (config.takeover === "system") return this.system.enable(config)
    if (config.takeover !== "tun") return
    const runtime = await client.configs()
    if (!runtime.tun?.enable) throw new Error("核心没有启用 TUN")
    for (let attempt = 0; attempt < 10; attempt++) {
      const result = await this.platform.inspectTun("ProxyPlugin")
      if (result.interface && result.routes !== false) return
      await pause(300)
    }
    throw new Error("TUN 网卡或路由未检测到，拒绝报告接管成功")
  }

  async restoreSystem(config) {
    const result = await this.system.restore(config)
    if (result.conflicts.length)
      throw new Error(
        `系统代理发生冲突，未修改：${result.conflicts.join(", ")}；请在本机检查后恢复`,
      )
    return result
  }

  async stopProcess() {
    if (await this.alive())
      await this.processes.stop(this.state.identity, {
        elevated: this.state.elevated,
        dataDir: this.store.data,
      })
    this.state = null
    await fs.unlink(this.store.paths.state).catch(error => {
      if (error.code !== "ENOENT") throw error
    })
  }

  async apply(
    config,
    {
      source,
      backup = true,
      recovery = false,
      local = false,
      cacheUpdated = false,
      allowReload = false,
    } = {},
  ) {
    // 在下载、改配置、恢复代理或停止已有核心之前检查，避免发现冲突时已改变现场。
    await this.assertNoOtherCores()
    const prepared = await this.prepare(config, source)
    const oldStoredConfig = await this.store.load()
    const oldConfig = this.state?.config || (await this.store.load())
    const oldRuntime = await fileText(this.store.paths.runtime)
    const oldSource = await fileText(this.store.paths.profile)
    const oldLocal = await fileText(this.store.paths.local)
    const cacheSnapshot = prepared.selected
      ? await this.subscriptions.snapshot(prepared.selected)
      : null
    const wasRunning = await this.alive()
    const oldBinary = this.state?.identity?.executable
    const oldState = this.state ? structuredClone(this.state) : null
    const normalizePath = value => (process.platform === "win32" ? value?.toLowerCase() : value)
    const reload =
      allowReload &&
      wasRunning &&
      oldConfig.takeover === config.takeover &&
      isDeepStrictEqual(oldConfig.system, config.system) &&
      normalizePath(oldBinary) === normalizePath(prepared.binary) &&
      canReloadProfile(oldRuntime, prepared.runtime)
    let changed = false
    try {
      if (reload) {
        const client = await this.client(oldConfig)
        changed = true
        await client.reload(path.join(this.store.data, "runtime", "candidate.yaml"))
        await client.version()
        await atomicWrite(this.store.paths.runtime, prepared.runtime)
      } else {
        await this.restoreSystem(oldConfig)
        changed = true
        await this.stopProcess()
        await atomicWrite(this.store.paths.runtime, prepared.runtime)
        const client = await this.launch(config, prepared.binary)
        await this.confirmTakeover(config, client)
      }
      if (prepared.selected)
        await this.subscriptions.save(prepared.selected, prepared.source, {
          updated: cacheUpdated || prepared.fetched,
          usage: this.subscriptionUsage.get(prepared.selected.url),
        })
      if (prepared.source === null)
        await fs.unlink(this.store.paths.profile).catch(error => {
          if (error.code !== "ENOENT") throw error
        })
      else await atomicWrite(this.store.paths.profile, prepared.source)
      if (local) {
        if (prepared.source === null)
          await fs.unlink(this.store.paths.local).catch(error => {
            if (error.code !== "ENOENT") throw error
          })
        else await atomicWrite(this.store.paths.local, prepared.source)
      }
      await this.store.save(config)
      if (reload) {
        this.state = { ...oldState, config: structuredClone(config) }
        await writeJson(this.store.paths.state, this.state)
      }
      if (backup && oldRuntime) {
        await atomicWrite(this.store.paths.backup, oldRuntime)
        await writeJson(path.join(this.store.data, "backups", "last-good.json"), {
          config: oldConfig,
          source: oldSource,
        })
      }
      if (!recovery) this.failedRestarts = 0
      this.lastError = ""
      return { running: true, takeover: config.takeover, reloaded: reload }
    } catch (error) {
      if (!changed) throw error
      let rollbackError
      try {
        if (reload) {
          await atomicWrite(this.store.paths.runtime, oldRuntime)
          await (await this.client(oldConfig)).reload(this.store.paths.runtime)
        } else {
          await this.restoreSystem(config)
          await this.stopProcess()
        }
        if (cacheSnapshot) await this.subscriptions.restore(prepared.selected, cacheSnapshot)
        if (oldRuntime !== null) await atomicWrite(this.store.paths.runtime, oldRuntime)
        else
          await fs.unlink(this.store.paths.runtime).catch(err => {
            if (err.code !== "ENOENT") throw err
          })
        if (oldSource === null)
          await fs.unlink(this.store.paths.profile).catch(err => {
            if (err.code !== "ENOENT") throw err
          })
        else await atomicWrite(this.store.paths.profile, oldSource)
        if (local) {
          if (oldLocal === null)
            await fs.unlink(this.store.paths.local).catch(error => {
              if (error.code !== "ENOENT") throw error
            })
          else await atomicWrite(this.store.paths.local, oldLocal)
        }
        await this.store.save(oldStoredConfig)
        if (reload) {
          this.state = oldState
          await writeJson(this.store.paths.state, this.state)
        } else if (wasRunning && oldRuntime && oldBinary) {
          const client = await this.launch(oldConfig, oldBinary)
          await this.confirmTakeover(oldConfig, client)
        }
      } catch (failure) {
        rollbackError = failure
      }
      this.lastError = redact(error.message)
      throw new Error(
        `${redact(error.message)}；${rollbackError ? `回滚失败：${redact(rollbackError.message)}，请执行本地恢复脚本` : "已恢复上一状态"}`,
      )
    }
  }

  start() {
    return this.queue.run(async () => {
      if (await this.alive()) {
        await (await this.client()).version()
        return { already: true }
      }
      return this.apply(await this.store.load())
    })
  }

  stop() {
    return this.queue.run(async () => {
      const config = this.state?.config || (await this.store.load())
      await this.restoreSystem(config)
      await this.stopProcess()
      this.failedRestarts = 0
      return { stopped: true }
    })
  }

  restart() {
    return this.queue.run(async () => this.apply(await this.store.load()))
  }

  takeover(mode) {
    return this.queue.run(async () => {
      const config = await this.store.load()
      config.takeover = mode
      if (mode === "off" && !(await this.alive())) {
        await this.restoreSystem(config)
        await this.store.save(config)
        return { running: false, takeover: "off" }
      }
      return this.apply(config)
    })
  }

  setMode(mode) {
    return this.queue.run(async () => {
      if (!["rule", "global", "direct"].includes(mode)) throw new Error("路由模式无效")
      const client = await this.requireClient()
      const previous = (await client.configs()).mode
      const original = await this.store.load()
      const config = structuredClone(original)
      const originalRuntime = await fileText(this.store.paths.runtime)
      config.mode = mode
      await client.mode(mode)
      try {
        if (originalRuntime) {
          const runtime = YAML.parse(originalRuntime)
          runtime.mode = mode
          await atomicWrite(this.store.paths.runtime, YAML.stringify(runtime, { lineWidth: 0 }))
        }
        await this.store.save(config)
      } catch (error) {
        await client.mode(previous)
        if (originalRuntime) await atomicWrite(this.store.paths.runtime, originalRuntime)
        await this.store.save(original)
        throw error
      }
      this.state.config.mode = mode
      await writeJson(this.store.paths.state, this.state)
      return mode
    })
  }

  check() {
    return this.queue.run(async () => {
      await this.prepare(await this.store.load())
      return true
    })
  }

  async commitSubscription(config, entry, text, updated = true) {
    validateConfig(config)
    const running = await this.alive()
    let appliedResult
    if (entry.active && running)
      appliedResult = await this.apply(config, {
        source: text,
        cacheUpdated: updated,
        allowReload: true,
      })
    else {
      const original = await this.store.load()
      const oldSource = await fileText(this.store.paths.profile)
      const snapshot = await this.subscriptions.snapshot(entry)
      const candidate = structuredClone(config)
      if (!entry.active) candidate.takeover = "off"
      await this.prepare(candidate, text)
      try {
        await this.subscriptions.save(entry, text, {
          updated,
          usage: this.subscriptionUsage.get(entry.url),
        })
        if (entry.active) {
          if (oldSource) await atomicWrite(this.store.paths.profileBackup, oldSource)
          await atomicWrite(this.store.paths.profile, text)
        }
        await this.store.save(config)
      } catch (error) {
        await this.subscriptions.restore(entry, snapshot)
        if (entry.active) {
          if (oldSource === null)
            await fs.unlink(this.store.paths.profile).catch(failure => {
              if (failure.code !== "ENOENT") throw failure
            })
          else await atomicWrite(this.store.paths.profile, oldSource)
        }
        await this.store.save(original)
        throw error
      }
    }
    const metadata = await this.subscriptions.metadata(entry)
    return {
      name: entry.name,
      active: entry.active,
      nodes: metadata?.nodes,
      updatedAt: metadata?.updatedAt,
      running,
      applied: entry.active && running,
      reloaded: appliedResult?.reloaded || false,
    }
  }

  findSubscription(config, key) {
    const items = config.subscription.items
    const value = String(key).trim()
    const entry =
      items.find(item => item.id === value || item.name === value) ||
      (/^\d+$/.test(value) ? items[Number(value) - 1] : null)
    if (!entry) throw new Error("没有找到订阅，请使用 #代理订阅 查看名称或序号")
    return entry
  }

  fetchSubscription(url, userAgent) {
    this.subscriptionUsage.delete(url)
    return this.downloader(url, userAgent, usage => this.subscriptionUsage.set(url, usage))
  }

  listSubscriptions({ local = false } = {}) {
    const read = async () => {
      const config = await this.store.load()
      const applied = activeSubscription(this.state?.config)
      const running = !local && (await this.alive())
      const records = await this.subscriptions.metadataList(config.subscription.items)
      return config.subscription.items.map((entry, index) => {
        const metadata = records[index]
        return {
          id: entry.id,
          name: entry.name,
          index: index + 1,
          active: entry.active,
          applied: running && applied?.id === entry.id,
          cached: !!metadata,
          nodes: metadata?.nodes,
          updatedAt: metadata?.updatedAt,
          usage: metadata?.usage,
        }
      })
    }
    return local ? read() : this.queue.run(read)
  }

  subscriptionSettings(key) {
    return this.queue.run(async () => {
      const config = await this.store.load()
      const entry = this.findSubscription(config, key)
      return {
        ...entry,
        defaults: {
          userAgent: config.subscription.userAgent,
          autoUpdateHours: config.subscription.autoUpdateHours,
        },
      }
    })
  }

  editSubscription(key, settings) {
    return this.queue.run(async () => {
      if (!settings || typeof settings !== "object" || Array.isArray(settings))
        throw new Error("订阅设置必须为对象")
      const config = await this.store.load()
      const entry = this.findSubscription(config, key)
      const previous = { ...entry }
      for (const field of ["name", "url", "userAgent", "autoUpdateHours"])
        if (Object.hasOwn(settings, field)) entry[field] = settings[field]
      validateConfig(config)
      const normalized = this.findSubscription(config, previous.id)
      if (normalized.url !== previous.url || normalized.userAgent !== previous.userAgent) {
        const text = await this.fetchSubscription(normalized.url, normalized.userAgent || config.subscription.userAgent)
        return this.commitSubscription(config, normalized, text)
      }
      await this.store.save(config)
      return { name: normalized.name, applied: false }
    })
  }

  async upsertSubscription(url, name) {
    const config = await this.store.load()
    const target = validateUrl(url)
    let entry = config.subscription.items.find(item => item.url === target)
    if (!entry) {
      let generated = name || new URL(target).hostname
      if (!name) {
        const base = generated
        for (
          let suffix = 2;
          config.subscription.items.some(
            item => item.name.toLowerCase() === generated.toLowerCase(),
          );
          suffix++
        )
          generated = `${base} ${suffix}`
      }
      entry = {
        id: config.subscription.items.some(item => item.id === subscriptionId(target))
          ? randomBytes(10).toString("hex")
          : subscriptionId(target),
        name: generated,
        url: target,
        active: config.subscription.items.length === 0,
      }
      config.subscription.items.push(entry)
    } else if (name) entry.name = name
    validateConfig(config)
    const text = await this.fetchSubscription(entry.url, entry.userAgent || config.subscription.userAgent)
    return this.commitSubscription(config, entry, text)
  }

  addSubscription(url, name) {
    return this.queue.run(() => this.upsertSubscription(url, name))
  }

  updateSubscription(key) {
    return this.queue.run(async () => {
      if (typeof key === "string" && /^https?:\/\//i.test(key)) return this.upsertSubscription(key)
      const config = await this.store.load()
      const entry =
        key === undefined ? activeSubscription(config) : this.findSubscription(config, key)
      if (!entry) throw new Error("没有启用的订阅，请先添加或切换订阅")
      return this.commitSubscription(
        config,
        entry,
        await this.fetchSubscription(entry.url, entry.userAgent || config.subscription.userAgent),
      )
    })
  }

  updateAllSubscriptions() {
    return this.queue.run(async () => {
      const entries = (await this.store.load()).subscription.items
      if (!entries.length) throw new Error("还没有订阅")
      const results = []
      for (const item of entries) {
        try {
          const config = await this.store.load()
          const entry = this.findSubscription(config, item.id)
          const text = await this.fetchSubscription(entry.url, entry.userAgent || config.subscription.userAgent)
          results.push({ ok: true, ...(await this.commitSubscription(config, entry, text)) })
        } catch (error) {
          results.push({ ok: false, name: item.name, error: redact(error.message) })
        }
      }
      return results
    })
  }

  selectSubscription(key) {
    return this.queue.run(async () => {
      const config = await this.store.load()
      const entry = this.findSubscription(config, key)
      const applied = activeSubscription(this.state?.config)
      if (
        entry.active &&
        applied?.id === entry.id &&
        applied?.url === entry.url &&
        (await this.alive())
      )
        return {
          name: entry.name,
          active: true,
          running: true,
          applied: true,
          already: true,
          reloaded: false,
        }
      for (const item of config.subscription.items) item.active = item.id === entry.id
      const cached = await this.subscriptions.cached(entry)
      const text =
        cached ?? (await this.fetchSubscription(entry.url, entry.userAgent || config.subscription.userAgent))
      return this.commitSubscription(config, entry, text, cached === null)
    })
  }

  renameSubscription(key, name) {
    return this.queue.run(async () => {
      const config = await this.store.load()
      const entry = this.findSubscription(config, key)
      entry.name = name
      await this.store.save(config)
      return entry.name
    })
  }

  removeSubscription(key) {
    return this.queue.run(async () => {
      const config = await this.store.load()
      const entry = this.findSubscription(config, key)
      if (entry.active && (await this.alive()))
        throw new Error("当前订阅正在使用，请先切换另一条订阅或停止核心，再删除")
      config.subscription.items = config.subscription.items.filter(item => item.id !== entry.id)
      if (entry.active && config.subscription.items.length) {
        const replacement = config.subscription.items[0]
        replacement.active = true
        const cached = await this.subscriptions.cached(replacement)
        const text =
          cached ?? (await this.fetchSubscription(replacement.url, replacement.userAgent || config.subscription.userAgent))
        await this.commitSubscription(config, replacement, text, cached === null)
      } else {
        await this.store.save(config)
        if (entry.active)
          await fs.unlink(this.store.paths.profile).catch(error => {
            if (error.code !== "ENOENT") throw error
          })
      }
      await this.subscriptions.remove(entry)
      return entry.name
    })
  }

  // 锅巴调用方持有同一管理队列，保存目标配置，不重启正在运行的核心。
  async saveSettings(config) {
    validateConfig(config)
    const original = await this.store.load()
    if (
      !original.subscription.items.length &&
      config.subscription.items.length &&
      !activeSubscription(config) &&
      !(await fileText(this.store.paths.local))
    )
      config.subscription.items[0].active = true
    const previous = activeSubscription(original)
    if (
      previous &&
      !config.subscription.items.some(item => item.id === previous.id) &&
      !activeSubscription(config) &&
      (await this.alive())
    )
      throw new Error("请先选择另一条订阅或停止核心，再删除当前订阅")
    await this.store.save(config)
    if (previous && !activeSubscription(config) && !(await this.alive()))
      await fs.unlink(this.store.paths.profile).catch(error => {
        if (error.code !== "ENOENT") throw error
      })
  }

  importFile(file) {
    return this.queue.run(async () => {
      const text = await fs.readFile(path.resolve(this.store.root, file), "utf8")
      const config = await this.store.load()
      for (const entry of config.subscription.items) entry.active = false
      await this.apply(config, { source: text, local: true })
      return true
    })
  }

  rollback() {
    return this.queue.run(async () => {
      const previous = await readJson(path.join(this.store.data, "backups", "last-good.json"))
      if (!previous) throw new Error("没有可回滚的运行配置")
      const selected = activeSubscription(previous.config)
      previous.config.subscription = (await this.store.load()).subscription
      for (const entry of previous.config.subscription.items)
        entry.active = entry.id === selected?.id
      return this.apply(previous.config, {
        source: previous.source,
        backup: false,
        local: !activeSubscription(previous.config),
      })
    })
  }

  status({ light = false } = {}) {
    return this.queue.run(async () => {
      const config = await this.store.load()
      const running = await this.alive()
      let version = null,
        runtime = null,
        apiError = null
      if (running && !light) {
        const client = await this.client()
        try {
          version = await client.version()
          runtime = await client.configs()
        } catch (error) {
          apiError = redact(error.message)
        }
      }
      if (light)
        return {
          platform: `${process.platform}/${process.arch}`,
          config,
          running,
          version: null,
          runtime: running
            ? { mode: this.state.config.mode, "mixed-port": this.state.config.core.mixedPort }
            : null,
          appliedConfig: running ? this.state.config : null,
          applied: running ? this.state.config.takeover : "off",
          system: {},
          tun: {},
          lastError: this.lastError,
          otherCores: [],
          apiError: null,
        }
      const system = await this.system
        .status(config)
        .catch(error => ({ owned: false, reason: error.message }))
      const tun = await this.platform
        .inspectTun("ProxyPlugin")
        .catch(error => ({ interface: null, routes: null, reason: error.message }))
      const otherCores = await this.otherCores().catch(error => ({ error: redact(error.message) }))
      return {
        platform: `${process.platform}/${process.arch}`,
        config,
        running,
        version,
        runtime,
        apiError,
        appliedConfig: running ? this.state.config : null,
        applied: running ? this.state.config.takeover : "off",
        system,
        tun,
        lastError: this.lastError,
        otherCores,
      }
    })
  }

  nodes(groupName) {
    return this.queue.run(async () => {
      const { proxies } = await (await this.requireClient()).proxies()
      if (!groupName) return Object.values(proxies || {}).filter(item => Array.isArray(item.all))
      const group = proxies?.[groupName]
      if (!group?.all) throw new Error("没有找到该代理组")
      return group
    })
  }

  connections() {
    return this.queue.run(async () => {
      if (!(await this.alive()))
        return { running: false, connections: [], uploadTotal: null, downloadTotal: null }
      const data = await (await this.requireClient()).connections()
      const connections = (data.connections || []).map(item => ({
        id: item.id,
        start: item.start,
        upload: item.upload,
        download: item.download,
        chains: item.chains || [],
        rule: item.rule,
        rulePayload: item.rulePayload,
        metadata: {
          host: item.metadata?.host,
          destinationIP: item.metadata?.destinationIP,
          destinationPort: item.metadata?.destinationPort,
          sourceIP: item.metadata?.sourceIP,
          sourcePort: item.metadata?.sourcePort,
          network: item.metadata?.network,
          type: item.metadata?.type,
          process: item.metadata?.process,
        },
      }))
      return {
        running: true,
        connections,
        uploadTotal: data.uploadTotal,
        downloadTotal: data.downloadTotal,
      }
    })
  }

  closeConnection(id) {
    return this.queue.run(async () => {
      if (typeof id !== "string" || !id.trim() || id.length > 256) throw new Error("连接标识无效")
      await (await this.requireClient()).closeConnection(id)
      return { closed: true }
    })
  }

  closeAllConnections() {
    return this.queue.run(async () => {
      await (await this.requireClient()).closeAllConnections()
      return { closed: true }
    })
  }

  logs() {
    return this.queue.run(async () => {
      const parts = await Promise.all(
        [this.store.paths.log, this.store.paths.log + ".stderr"].map(async file => {
          let handle
          try {
            handle = await fs.open(file, "r")
            const size = (await handle.stat()).size
            const length = Math.min(size, 128 * 1024)
            const buffer = Buffer.alloc(length)
            const { bytesRead } = await handle.read(buffer, 0, length, Math.max(0, size - length))
            const text = buffer.subarray(0, bytesRead).toString("utf8")
            const lines = text.split(/\r?\n/)
            if (size > length) lines.shift()
            return {
              source: path.basename(file),
              lines: lines.filter(Boolean).slice(-300).map(redact),
            }
          } catch (error) {
            if (error.code === "ENOENT") return { source: path.basename(file), lines: [] }
            throw error
          } finally {
            await handle?.close()
          }
        }),
      )
      return { files: parts }
    })
  }

  async ruleSource() {
    if (await this.alive())
      return { text: await fileText(this.store.paths.profile), source: "运行配置" }
    const config = await this.store.load()
    const selected = activeSubscription(config)
    return {
      text: selected
        ? await this.subscriptions.cached(selected)
        : await fileText(this.store.paths.local),
      source: selected?.name || "本地配置",
    }
  }

  async savedSource() {
    const config = await this.store.load()
    const selected = activeSubscription(config)
    return {
      config,
      text: selected ? await this.subscriptions.cached(selected) : await fileText(this.store.paths.local),
      source: `${selected?.name || "本地配置"}（已保存）`,
    }
  }

  async savedProfile() {
    const saved = await this.savedSource()
    if (!this.savedProfileCache || this.savedProfileCache.text !== saved.text)
      this.savedProfileCache = { text: saved.text, profile: saved.text ? parseProfile(saved.text) : null }
    return { ...saved, profile: this.savedProfileCache.profile }
  }

  rules({ local = false } = {}) {
    const read = async () => {
      const { profile, source } = local
        ? await this.savedProfile()
        : await this.ruleSource().then(({ text, source }) => ({ profile: text ? parseProfile(text) : null, source }))
      if (!profile) return { rules: [], providers: [], groups: [], source, available: false }
      return {
        rules: profile.rules || [],
        providers: Object.keys(profile["rule-providers"] || {}),
        groups: (profile["proxy-groups"] || []).map(group => group.name),
        source,
        available: true,
      }
    }
    return local ? read() : this.queue.run(read)
  }

  saveRules(rules) {
    return this.queue.run(async () => {
      if (
        !Array.isArray(rules) ||
        !rules.length ||
        rules.length > 10000 ||
        rules.some(rule => typeof rule !== "string" || !rule.trim() || /[\r\n\0]/.test(rule))
      )
        throw new Error("规则应为 1–10000 条非空字符串，每行一条")
      const config = await this.store.load()
      const selected = activeSubscription(config)
      if (await this.alive()) {
        const applied = activeSubscription(this.state.config)
        if (applied?.id !== selected?.id || applied?.url !== selected?.url)
          throw new Error("目标订阅与运行配置不同，请先应用订阅再编辑规则")
      }
      const { text } = await this.ruleSource()
      if (!text) throw new Error("请先导入或下载配置")
      const profile = parseProfile(text)
      profile.rules = rules.map(rule => rule.trim())
      const source = YAML.stringify(profile, { lineWidth: 0 })
      if (selected) await this.commitSubscription(config, selected, source, false)
      else if (await this.alive()) await this.apply(config, { source, local: true })
      else {
        const candidate = structuredClone(config)
        candidate.takeover = "off"
        await this.prepare(candidate, source)
        await atomicWrite(this.store.paths.local, source)
      }
      return { saved: true, running: await this.alive() }
    })
  }

  select(group, keyword) {
    return this.queue.run(async () => {
      if (
        typeof group !== "string" ||
        !group.trim() ||
        typeof keyword !== "string" ||
        !keyword.trim()
      )
        throw new Error("请选择代理组和节点")
      if (!(await this.alive())) throw new Error("本插件核心未运行，请先执行 #代理核心启动")
      const client = await this.client()
      const proxyGroup = await client.proxy(group)
      const members = proxyGroup?.all
      if (!members) throw new Error("没有找到该代理组")
      const exact = members.find(name => name === keyword)
      const matches = exact
        ? [exact]
        : members.filter(name => name.toLowerCase().includes(keyword.toLowerCase()))
      if (matches.length !== 1)
        throw new Error(matches.length ? "匹配到多个节点，请使用完整名称" : "没有匹配节点")
      if (!["Selector", "URLTest", "Fallback"].includes(proxyGroup.type))
        throw new Error("该代理组不支持手动选择")
      if (proxyGroup.now === matches[0]) return matches[0]
      await client.select(group, matches[0])
      return matches[0]
    })
  }

  speed(group, { includeCurrent = false } = {}) {
    return this.queue.run(async () => {
      const client = await this.requireClient()
      const { proxies } = await client.proxies()
      const proxyGroup = proxies?.[group]
      const members = proxyGroup?.all
      if (!members) throw new Error("没有找到该代理组")
      const names = members
        .filter(name => !["DIRECT", "REJECT", "PASS"].includes(name) && !proxies[name]?.all)
        .slice(0, 100)
      let cursor = 0
      const results = []
      await Promise.all(
        Array.from({ length: Math.min(6, names.length) }, async () => {
          while (cursor < names.length) {
            const name = names[cursor++]
            try {
              const { delay } = await client.delay(name)
              results.push({ name, delay: delay > 0 ? delay : null })
            } catch {
              results.push({ name, delay: null })
            }
          }
        }),
      )
      results.sort((a, b) => (a.delay ?? Infinity) - (b.delay ?? Infinity))
      return includeCurrent ? { current: proxyGroup.now, results } : results
    })
  }

  async attach() {
    await this.initialize()
    const token = Symbol("Proxy-Plugin lease")
    this.leases.add(token)
    if (!this.timer) {
      this.timer = setInterval(
        () =>
          this.queue
            .run(() => this.tick())
            .catch(error => {
              this.lastError = redact(error.message)
            }),
        5000,
      )
      this.timer.unref()
    }
    return token
  }

  async detach(token) {
    this.leases.delete(token)
    if (!this.leases.size) {
      clearInterval(this.timer)
      this.timer = null
      await this.queue.tail
    }
  }

  async tick() {
    const config = await this.store.load()
    if (Date.now() - (this.lastCheck || 0) < config.health.intervalSeconds * 1000) return
    this.lastCheck = Date.now()
    const alive = await this.alive()
    if (this.state && !alive) {
      while (this.failedRestarts < config.health.restartAttempts) {
        this.failedRestarts++
        try {
          await this.apply(config, { backup: false, recovery: true })
          return
        } catch (error) {
          this.lastError = redact(error.message)
        }
      }
      await this.restoreSystem(config)
      await this.stopProcess()
      this.lastError = "核心持续异常，已停止重试并解除系统代理；请检查本地日志"
    }
    if (alive) {
      try {
        await (await this.client()).version()
      } catch (error) {
        this.lastError = `核心仍存活但控制接口不可用：${redact(error.message)}`
      }
      if (Date.now() - this.state.startedAt >= 60000) this.failedRestarts = 0
    }
    // 每次检查最多刷新一条过期订阅，避免整批下载长时间占用命令队列。
    for (const entry of config.subscription.items) {
      const hours = entry.autoUpdateHours ?? config.subscription.autoUpdateHours
      if (hours <= 0) continue
      const metadata = await this.subscriptions.metadata(entry)
      const last = Math.max(metadata?.updatedAt || 0, this.subscriptionRetries.get(entry.id) || 0)
      if (Date.now() - last < hours * 3600e3) continue
      this.subscriptionRetries.set(entry.id, Date.now())
      const text = await this.fetchSubscription(entry.url, entry.userAgent || config.subscription.userAgent)
      const applied = activeSubscription(this.state?.config)
      if (alive && entry.active && applied?.id !== entry.id) {
        const candidate = structuredClone(config)
        candidate.takeover = "off"
        await this.prepare(candidate, text)
        await this.subscriptions.save(entry, text, { usage: this.subscriptionUsage.get(entry.url) })
      } else await this.commitSubscription(config, entry, text)
      break
    }
  }
}

export function getManager() {
  return (globalThis.__proxyPluginManagerV1 ??= new ProxyManager())
}
