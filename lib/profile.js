import fs from "node:fs/promises"
import YAML from "yaml"
import { merge, validateUrl } from "./config.js"

export function parseProfile(text) {
  if (Buffer.byteLength(text) > 8 * 1024 * 1024) throw new Error("配置超过 8 MiB")
  const profile = YAML.parse(text, { maxAliasCount: 100 })
  if (!profile || typeof profile !== "object" || Array.isArray(profile))
    throw new Error("请提供 mihomo YAML 配置")
  if (
    !Array.isArray(profile.proxies) &&
    !profile["proxy-providers"] &&
    !Array.isArray(profile["proxy-groups"])
  )
    throw new Error("配置中没有 proxies、proxy-providers 或 proxy-groups；初版不支持分享链接转换")
  return profile
}

export function buildProfile(profile, config, secret) {
  const result = structuredClone(
    profile || {
      proxies: [],
      "proxy-groups": [{ name: "PROXY", type: "select", proxies: ["DIRECT"] }],
      rules: [
        "IP-CIDR,127.0.0.0/8,DIRECT,no-resolve",
        "IP-CIDR,10.0.0.0/8,DIRECT,no-resolve",
        "IP-CIDR,172.16.0.0/12,DIRECT,no-resolve",
        "IP-CIDR,192.168.0.0/16,DIRECT,no-resolve",
        "MATCH,PROXY",
      ],
    },
  )
  for (const key of [
    "port",
    "socks-port",
    "redir-port",
    "tproxy-port",
    "external-controller-tls",
    "external-controller-unix",
    "external-controller-pipe",
    "external-ui",
    "external-ui-url",
    "external-ui-name",
    "listeners",
    "authentication",
  ])
    delete result[key]
  Object.assign(result, {
    ...config.runtime,
    "mixed-port": config.core.mixedPort,
    "allow-lan": false,
    "bind-address": "127.0.0.1",
    "external-controller": `127.0.0.1:${config.core.controllerPort}`,
    secret,
    mode: config.mode,
    "log-level": config.core.logLevel,
  })
  if (Object.hasOwn(config.runtime || {}, "sniffing")) {
    result.sniffer = { ...result.sniffer, enable: config.runtime.sniffing }
    delete result.sniffing
  }
  result.profile = { ...result.profile, "store-selected": true, "store-fake-ip": true }
  result.tun = {
    ...(result.tun || {}),
    device: "ProxyPlugin",
    enable: config.takeover === "tun",
    stack: config.tun.stack,
    "auto-route": true,
    "auto-detect-interface": true,
    "strict-route": config.tun.strictRoute,
    "dns-hijack": ["any:53"],
  }
  if (config.takeover === "tun") {
    result.dns = merge(
      {
        enable: true,
        "enhanced-mode": "fake-ip",
        "fake-ip-range": "198.18.0.1/16",
        "default-nameserver": ["223.5.5.5", "119.29.29.29"],
        nameserver: ["https://dns.alidns.com/dns-query", "https://doh.pub/dns-query"],
      },
      result.dns,
    )
    result.dns.enable = true
  }
  return result
}

export async function readProfile(file) {
  try {
    return parseProfile(await fs.readFile(file, "utf8"))
  } catch (error) {
    if (error.code === "ENOENT") return null
    throw error
  }
}

export async function downloadProfile(url, userAgent, onUsage) {
  validateUrl(url)
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30000),
    headers: { "User-Agent": userAgent },
    redirect: "follow",
  })
  if (!response.ok) throw new Error(`订阅下载失败：HTTP ${response.status}`)
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.byteLength
    if (size > 8 * 1024 * 1024) throw new Error("订阅超过 8 MiB")
    chunks.push(Buffer.from(chunk))
  }
  const text = Buffer.concat(chunks).toString("utf8")
  parseProfile(text)
  const header = response.headers.get("subscription-userinfo")
  if (header && onUsage) {
    const usage = {}
    for (const part of header.split(";")) {
      const [key, value] = part.split("=").map(field => field.trim())
      const number = Number(value)
      if (
        ["upload", "download", "total", "expire"].includes(key) &&
        value &&
        Number.isFinite(number) &&
        number >= 0
      )
        usage[key] = number
    }
    onUsage(usage)
  }
  return text
}
