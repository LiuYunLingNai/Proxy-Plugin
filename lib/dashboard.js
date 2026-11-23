import fs from "node:fs/promises"
import { atomicWrite } from "./storage.js"
import { activeSubscription, validateRuntimeOptions } from "./config.js"
import { parseProfile } from "./profile.js"
import { Installer, downloadFromMirrors, versionStore } from "./installer.js"

export function safeProxy(proxy, provider) {
  return {
    name: proxy.name,
    type: proxy.type,
    now: proxy.now,
    all: proxy.all,
    alive: proxy.alive,
    udp: proxy.udp,
    xudp: proxy.xudp,
    hidden: proxy.hidden,
    history: (proxy.history || []).slice(-10),
    provider,
  }
}

function providerInfo(provider, kind) {
  return {
    name: provider.name,
    type: provider.type,
    vehicleType: provider.vehicleType,
    updatedAt: provider.updatedAt,
    ruleCount: provider.ruleCount,
    behavior: provider.behavior,
    format: provider.format,
    subscriptionInfo: provider.subscriptionInfo,
    proxies:
      kind === "proxies"
        ? (provider.proxies || []).map(proxy => safeProxy(proxy, provider.name))
        : undefined,
  }
}

export class Dashboard {
  constructor(manager, { InstallerClass = Installer } = {}) {
    this.manager = manager
    this.InstallerClass = InstallerClass
  }

  async providers(kind) {
    if (!["proxies", "rules"].includes(kind)) throw new Error("提供者类型无效")
    const manager = this.manager
    if (!(await manager.alive())) return { running: false, providers: [] }
    const client = await manager.requireClient()
    const data = kind === "proxies" ? await client.proxyProviders() : await client.ruleProviders()
    return {
      running: true,
      providers: Object.entries(data.providers || {}).map(([name, provider]) =>
        providerInfo({ ...provider, name }, kind),
      ),
    }
  }

  async proxies() {
    const manager = this.manager
    if (!(await manager.alive()))
      return { running: false, groups: [], proxies: {}, providerError: null }
    const data = await (await manager.requireClient()).proxies()
    const proxies = Object.fromEntries(
      Object.entries(data.proxies || {}).map(([name, proxy]) => [
        name,
        safeProxy({ ...proxy, name }),
      ]),
    )
    let providerError = null
    try {
      const providers = await this.providers("proxies")
      for (const provider of providers.providers)
        for (const proxy of provider.proxies) {
          if (!proxies[proxy.name]) proxies[proxy.name] = proxy
        }
    } catch (error) {
      providerError = error.message
    }
    return {
      running: true,
      groups: Object.values(proxies).filter(proxy => Array.isArray(proxy.all)),
      proxies,
      providerError,
    }
  }

  async updateProvider(kind, name, health = false) {
    const available = await this.providers(kind)
    if (!available.providers.some(item => item.name === name)) throw new Error("提供者不存在")
    const client = await this.manager.requireClient()
    if (health) await client.healthProvider(name)
    else await client.updateProvider(kind, name)
    return { updated: true }
  }

  testOptions(options = {}) {
    const url = options.url || "https://www.gstatic.com/generate_204"
    const parsed = new URL(url)
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password)
      throw new Error("测速地址须为 HTTP/HTTPS URL")
    const timeout = options.timeout ?? 5000
    if (!Number.isInteger(timeout) || timeout < 500 || timeout > 20000)
      throw new Error("测速超时须为 500–20000 毫秒")
    return { url, timeout }
  }

  async delay(args) {
    const { url, timeout } = this.testOptions(args)
    const snapshot = await this.proxies()
    const proxy = snapshot.proxies[args.name]
    if (!proxy) throw new Error("节点不存在")
    const client = await this.manager.requireClient()
    return proxy.provider
      ? client.providerDelay(proxy.provider, proxy.name, url, timeout)
      : client.delay(proxy.name, timeout, url)
  }

  async groupDelay(args) {
    const { url, timeout } = this.testOptions(args)
    const snapshot = await this.proxies()
    if (!snapshot.groups.some(group => group.name === args.group)) throw new Error("代理组不存在")
    return (await this.manager.requireClient()).groupDelay(args.group, url, timeout)
  }

  async resetGroup(group) {
    const snapshot = await this.proxies()
    if (
      !snapshot.groups.some(
        item => item.name === group && ["URLTest", "Fallback"].includes(item.type),
      )
    )
      throw new Error("该组不支持恢复自动选择")
    await (await this.manager.requireClient()).unfixGroup(group)
    return { reset: true }
  }

  async runtimeRules({ saved = false } = {}) {
    if (!(await this.manager.alive())) return { running: false, rules: [] }
    if (saved) {
      const [stored, applied] = await Promise.all([this.manager.savedSource(), this.manager.ruleSource()])
      if (stored.text !== applied.text) return { running: true, rules: [] }
    }
    return { running: true, ...(await (await this.manager.requireClient()).runtimeRules()) }
  }

  async disableRule(index, disabled) {
    const data = await this.runtimeRules()
    const rule = data.rules.find(item => item.index === index)
    if (!Number.isInteger(index) || typeof disabled !== "boolean" || !rule?.extra)
      throw new Error("该规则或核心版本不支持启停")
    await (await this.manager.requireClient()).disableRule(index, disabled)
    return { disabled }
  }

  async coreOptions({ local = false } = {}) {
    if (local) {
      const { config, profile } = await this.manager.savedProfile()
      const saved = {
        ipv6: profile?.ipv6 ?? false,
        sniffing: profile?.sniffer?.enable ?? false,
        "tcp-concurrent": profile?.["tcp-concurrent"] ?? false,
        "find-process-mode": profile?.["find-process-mode"] ?? "strict",
        "interface-name": profile?.["interface-name"] ?? "",
        ...config.runtime,
        "log-level": config.core.logLevel,
      }
      return { options: saved, source: "已保存的核心选项" }
    }
    const config = await this.manager.store.load()
    if (!(await this.manager.alive()))
      return { running: false, options: { ...config.runtime, "log-level": config.core.logLevel } }
    const data = await (await this.manager.requireClient()).configs()
    const keys = [
      "ipv6",
      "sniffing",
      "tcp-concurrent",
      "find-process-mode",
      "interface-name",
      "log-level",
    ]
    return {
      running: true,
      options: Object.fromEntries(
        keys.filter(key => data[key] !== undefined).map(key => [key, data[key]]),
      ),
    }
  }

  async saveCoreOptions(options) {
    const manager = this.manager
    if (!options || typeof options !== "object" || Array.isArray(options))
      throw new Error("核心选项应为对象")
    const patch = { ...options }
    const logLevel = patch["log-level"]
    delete patch["log-level"]
    validateRuntimeOptions(patch)
    if (
      logLevel !== undefined &&
      !["silent", "error", "warning", "info", "debug"].includes(logLevel)
    )
      throw new Error("日志等级无效")
    const original = await manager.store.load()
    const config = structuredClone(original)
    config.runtime = { ...config.runtime, ...patch }
    if (logLevel !== undefined) config.core.logLevel = logLevel
    const running = await manager.alive()
    if (running) await manager.apply(config)
    else await manager.store.save(config)
    return { saved: true, running }
  }

  async configDocument({ local = false } = {}) {
    const { text, source } = local ? await this.manager.savedSource() : await this.manager.ruleSource()
    return { source, content: text || "", available: !!text }
  }

  async saveConfigDocument(content, apply = true) {
    const manager = this.manager
    parseProfile(content)
    const config = await manager.store.load()
    const selected = activeSubscription(config)
    if (await manager.alive()) {
      const applied = activeSubscription(manager.state.config)
      if (applied?.id !== selected?.id || applied?.url !== selected?.url)
        throw new Error("请先应用目标订阅，再编辑运行配置")
    }
    if (!apply) {
      await manager.prepare({ ...config, takeover: "off" }, content)
      return { valid: true }
    }
    if (selected) await manager.commitSubscription(config, selected, content, false)
    else if (await manager.alive()) await manager.apply(config, { source: content, local: true })
    else {
      await manager.prepare({ ...config, takeover: "off" }, content)
      const previous = await fs.readFile(manager.store.paths.local, "utf8").catch(error => {
        if (error.code === "ENOENT") return null
        throw error
      })
      if (previous) await atomicWrite(manager.store.paths.profileBackup, previous)
      await atomicWrite(manager.store.paths.local, content)
    }
    return { saved: true, running: await manager.alive() }
  }

  async dns(args) {
    if (
      typeof args.name !== "string" ||
      args.name.length > 253 ||
      !/^[a-z0-9._-]+$/i.test(args.name)
    )
      throw new Error("域名无效")
    if (!["A", "AAAA", "CNAME", "MX", "TXT", "NS", "HTTPS", "SVCB"].includes(args.type))
      throw new Error("DNS 类型无效")
    return (await this.manager.requireClient()).dnsQuery(args.name, args.type)
  }

  async flush(kind) {
    if (!["dns", "fakeip"].includes(kind)) throw new Error("缓存类型无效")
    await (await this.manager.requireClient()).flushCache(kind)
    return { flushed: true }
  }

  async versions() {
    const config = await this.manager.store.load()
    const buffer = await downloadFromMirrors(
      "https://api.github.com/repos/MetaCubeX/mihomo/releases?per_page=15",
      config.download.mirrors,
      20000,
      4 * 1024 * 1024,
    )
    const releases = JSON.parse(buffer.toString())
    if (!Array.isArray(releases)) throw new Error("版本信息格式无效")
    return releases
      .filter(item => !item.draft)
      .map(item => ({
        version: item.tag_name,
        publishedAt: item.published_at,
        prerelease: item.prerelease,
      }))
  }

  async switchVersion(version) {
    const manager = this.manager
    const destination = versionStore(manager.store, version)
    await manager.assertNoOtherCores()
    const config = await manager.store.load()
    const downloadConfig = structuredClone(config)
    downloadConfig.core.path = ""
    downloadConfig.core.version = version
    const binary = await new this.InstallerClass(destination).ensure(downloadConfig)
    config.core.path = binary
    config.core.version = version
    if (await manager.alive()) await manager.apply(config)
    else {
      await manager.prepare({ ...config, takeover: "off" })
      await manager.store.save(config)
    }
    return { switched: true, version }
  }
}
