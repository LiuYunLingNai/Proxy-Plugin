import fs from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"
import YAML from "yaml"
import { isIP } from "node:net"
import { atomicWrite } from "./storage.js"

export const defaults = {
  core: {
    path: "",
    version: "latest",
    mixedPort: 17890,
    controllerPort: 19090,
    autoStart: false,
    windowsElevate: false,
    startupTimeoutSeconds: 30,
    logLevel: "info",
  },
  takeover: "off",
  mode: "rule",
  runtime: {},
  tun: { stack: "system", strictRoute: false },
  system: {
    linuxDesktop: "auto",
    bypass:
      "localhost;127.*;10.*;192.168.*;172.16.*;172.17.*;172.18.*;172.19.*;172.2?.*;172.30.*;172.31.*;<local>",
  },
  subscription: { items: [], userAgent: "clash.meta", autoUpdateHours: 0 },
  download: { mirrors: [""], timeoutSeconds: 120 },
  health: { intervalSeconds: 15, restartAttempts: 2 },
  webui: { enabled: true, mountToYunzai: true, host: "127.0.0.1", port: 19100, publicUrl: "" },
}

export function merge(base, extra) {
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) return structuredClone(base)
  const result = structuredClone(base)
  for (const [key, value] of Object.entries(extra)) {
    result[key] =
      value && typeof value === "object" && !Array.isArray(value)
        ? merge(result[key] || {}, value)
        : value
  }
  return result
}

export function validateConfig(config) {
  normalizeSubscriptions(config)
  if (config.runtime === undefined) config.runtime = {}
  validateRuntimeOptions(config.runtime)
  config.webui = validateWebUi(config.webui ?? structuredClone(defaults.webui))
  for (const key of ["mixedPort", "controllerPort"]) {
    if (!Number.isInteger(config.core[key]) || config.core[key] < 1024 || config.core[key] > 65535)
      throw new Error(`core.${key} 必须为 1024–65535 的整数`)
  }
  if (config.core.mixedPort === config.core.controllerPort)
    throw new Error("代理端口和控制端口不能相同")
  if (config.webui.enabled && !config.webui.mountToYunzai && [config.core.mixedPort, config.core.controllerPort].includes(config.webui.port))
    throw new Error("WebUI 独立端口不能与代理端口或控制端口相同")
  if (!["off", "system", "tun"].includes(config.takeover))
    throw new Error("takeover 必须为 off/system/tun")
  if (!["rule", "global", "direct"].includes(config.mode))
    throw new Error("mode 必须为 rule/global/direct")
  if (!["system", "gvisor", "mixed"].includes(config.tun.stack))
    throw new Error("TUN stack 必须为 system/gvisor/mixed")
  if (!["auto", "gnome", "kde"].includes(config.system.linuxDesktop))
    throw new Error("linuxDesktop 必须为 auto/gnome/kde")
  if (!["silent", "error", "warning", "info", "debug"].includes(config.core.logLevel))
    throw new Error("logLevel 无效")
  for (const [value, label, min, max] of [
    [config.core.startupTimeoutSeconds, "启动超时", 3, 120],
    [config.download.timeoutSeconds, "下载超时", 5, 300],
    [config.health.intervalSeconds, "健康检查间隔", 5, 3600],
    [config.health.restartAttempts, "重试次数", 0, 5],
    [config.subscription.autoUpdateHours, "订阅更新周期", 0, 8760],
  ]) {
    if (!Number.isFinite(value) || value < min || value > max)
      throw new Error(`${label} 超出允许范围`)
  }
  for (const value of [config.core.autoStart, config.core.windowsElevate, config.tun.strictRoute]) {
    if (typeof value !== "boolean") throw new Error("开关配置必须为布尔值")
  }
  if (!Number.isInteger(config.health.restartAttempts)) throw new Error("重试次数必须为整数")
  if (typeof config.core.path !== "string" || /[\r\n\0]/.test(config.core.path))
    throw new Error("核心路径无效")
  if (typeof config.system.bypass !== "string" || /[\r\n\0]/.test(config.system.bypass))
    throw new Error("绕过列表无效")
  if (!Array.isArray(config.download.mirrors) || !config.download.mirrors.length)
    throw new Error("下载源不能为空")
  for (const mirror of config.download.mirrors) {
    if (typeof mirror !== "string") throw new Error("下载源必须是 URL 前缀字符串；空字符串表示直连")
    if (mirror) {
      const url = new URL(validateUrl(mirror))
      if (!mirror.endsWith("/") || url.search || url.hash)
        throw new Error("镜像前缀须以 / 结尾，且不能包含查询参数或片段")
    }
  }
  return config
}

export function validateWebUi(options) {
  if (!options || typeof options !== "object" || Array.isArray(options))
    throw new Error("WebUI 设置必须为对象")
  if (typeof options.enabled !== "boolean" || typeof options.mountToYunzai !== "boolean")
    throw new Error("WebUI 开关必须为布尔值")
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535)
    throw new Error("WebUI 端口须为 1024–65535 的整数")
  if (typeof options.host !== "string" || (!isIP(options.host) && options.host !== "localhost"))
    throw new Error("WebUI 监听地址须为 IP 地址或 localhost")
  if (typeof options.publicUrl !== "string" || /[\r\n\0]/.test(options.publicUrl) || options.publicUrl !== options.publicUrl.trim())
    throw new Error("WebUI 访问地址须为不含换行或首尾空格的字符串")
  if (options.publicUrl) {
    const url = new URL(validateUrl(options.publicUrl))
    if (url.search || url.hash) throw new Error("WebUI 访问地址不能包含查询参数或片段")
  }
  return options
}

export function validateRuntimeOptions(options) {
  if (!options || typeof options !== "object" || Array.isArray(options))
    throw new Error("核心选项应为对象")
  const booleans = ["ipv6", "sniffing", "tcp-concurrent"]
  for (const [key, value] of Object.entries(options)) {
    if (booleans.includes(key) && typeof value === "boolean") continue
    if (key === "find-process-mode" && ["off", "strict", "always"].includes(value)) continue
    if (
      key === "interface-name" &&
      typeof value === "string" &&
      value.length <= 128 &&
      !/[\r\n\0]/.test(value)
    )
      continue
    throw new Error(`无效的核心选项 ${key}`)
  }
  return options
}

export function subscriptionId(url) {
  return crypto.createHash("sha256").update(validateUrl(url)).digest("hex").slice(0, 20)
}

export function normalizeSubscriptions(config) {
  const subscription = config.subscription
  if (!subscription || typeof subscription !== "object" || Array.isArray(subscription))
    throw new Error("订阅配置必须为对象")
  delete subscription.url
  if (!Array.isArray(subscription.items) || subscription.items.length > 50)
    throw new Error("订阅列表必须为数组，最多 50 条")
  if (typeof subscription.userAgent !== "string" || !/^[\x20-\x7e]{1,256}$/.test(subscription.userAgent))
    throw new Error("订阅 User-Agent 须为 1–256 字的可打印英文字符")
  const names = new Set(),
    urls = new Set(),
    ids = new Set()
  subscription.items = subscription.items.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new Error("订阅条目必须为对象")
    if (
      typeof item.name !== "string" ||
      !item.name.trim() ||
      item.name.length > 64 ||
      /[\r\n\0]/.test(item.name)
    )
      throw new Error("每条订阅需要 1–64 字的名称，且不能含换行")
    if (typeof item.url !== "string" || !item.url) throw new Error("每条订阅需要 HTTP/HTTPS 地址")
    const url = validateUrl(item.url)
    const id = item.id || subscriptionId(url)
    if (typeof id !== "string" || !/^[a-f0-9]{20}$/.test(id)) throw new Error("订阅标识无效")
    const name = item.name.trim()
    if (names.has(name.toLowerCase()) || urls.has(url) || ids.has(id))
      throw new Error("订阅名称、地址和标识不能重复")
    names.add(name.toLowerCase())
    urls.add(url)
    ids.add(id)
    if (item.active !== undefined && typeof item.active !== "boolean")
      throw new Error("订阅启用开关必须为布尔值")
    const overrides = {}
    if (item.userAgent !== undefined && item.userAgent !== null && item.userAgent !== "") {
      if (typeof item.userAgent !== "string" || !/^[\x20-\x7e]{1,256}$/.test(item.userAgent))
        throw new Error("订阅 User-Agent 须为 1–256 字的可打印英文字符")
      overrides.userAgent = item.userAgent
    }
    if (item.autoUpdateHours !== undefined && item.autoUpdateHours !== null) {
      if (!Number.isFinite(item.autoUpdateHours) || item.autoUpdateHours < 0 || item.autoUpdateHours > 8760)
        throw new Error("订阅独立更新周期须为 0–8760 小时")
      overrides.autoUpdateHours = item.autoUpdateHours
    }
    return { id, name, url, active: item.active === true, ...overrides }
  })
  if (subscription.items.filter(item => item.active).length > 1)
    throw new Error("一次只能启用一份完整配置；请先取消原订阅的启用开关")
  return config
}

export function activeSubscription(config) {
  if (config?.subscription?.items)
    return config.subscription.items.find(item => item.active) || null
  return null
}

export function validateUrl(value) {
  const url = new URL(value)
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("只支持不带用户名密码的 HTTP/HTTPS 地址")
  return url.href
}

export class ConfigStore {
  constructor(root = process.cwd()) {
    this.root = path.resolve(root)
    this.file = path.join(this.root, "config", "Proxy-Plugin.yaml")
    this.data = path.join(this.root, "data", "Proxy-Plugin")
    this.paths = {
      profile: path.join(this.data, "profiles", "active.yaml"),
      local: path.join(this.data, "profiles", "local.yaml"),
      runtime: path.join(this.data, "runtime", "config.yaml"),
      backup: path.join(this.data, "backups", "config.yaml"),
      profileBackup: path.join(this.data, "backups", "profile.yaml"),
      state: path.join(this.data, "runtime", "state.json"),
      proxy: path.join(this.data, "recovery", "system-proxy.json"),
      secret: path.join(this.data, "secret"),
      log: path.join(this.data, "logs", "mihomo.log"),
    }
  }

  async load() {
    let text
    try {
      text = await fs.readFile(this.file, "utf8")
    } catch (error) {
      if (error.code !== "ENOENT") throw error
      const config = structuredClone(defaults)
      await this.save(config)
      return config
    }
    const parsed = YAML.parse(text)
    if (parsed !== null && (typeof parsed !== "object" || Array.isArray(parsed)))
      throw new Error("插件设置必须是 YAML 对象")
    return validateConfig(merge(defaults, parsed))
  }

  async save(config) {
    validateConfig(config)
    await atomicWrite(this.file, YAML.stringify(config))
  }

  async secret() {
    try {
      const secret = (await fs.readFile(this.paths.secret, "utf8")).trim()
      if (secret.length < 32) throw new Error("控制密钥格式不正确，请检查 data/Proxy-Plugin/secret")
      return secret
    } catch (error) {
      if (error.code !== "ENOENT") throw error
      const secret = crypto.randomBytes(32).toString("hex")
      await atomicWrite(this.paths.secret, secret + "\n")
      return secret
    }
  }
}
