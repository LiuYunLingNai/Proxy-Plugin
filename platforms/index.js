import os from "node:os"
import fs from "node:fs/promises"
import { execFile, powershell } from "../lib/process.js"

function variantString(value) {
  return `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")}'`
}

export function parseGVariant(text, kind) {
  const value = text.trim().replace(/^@\w+\s+/, "")
  const decode = token =>
    token
      .slice(1, -1)
      .replace(/\\([\\'"nrt])/g, (_, char) => ({ n: "\n", r: "\r", t: "\t" })[char] || char)
  if (kind === "array") {
    if (!value.startsWith("[") || !value.endsWith("]"))
      throw new Error("GNOME 绕过列表格式无法识别")
    return (value.match(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g) || []).map(decode)
  }
  if (kind === "boolean") {
    if (!["true", "false"].includes(value)) throw new Error("GNOME 布尔值无法识别")
    return value === "true"
  }
  if (kind === "number") {
    const number = Number(value.replace(/^(?:u?int\d+|byte)\s+/, ""))
    if (!Number.isFinite(number)) throw new Error("GNOME 端口值无法识别")
    return number
  }
  if (!/^(['"])[\s\S]*\1$/.test(value)) throw new Error("GNOME 字符串无法识别")
  return decode(value)
}

function linuxBypass(value) {
  const mapping = { "127.*": "127.0.0.0/8", "10.*": "10.0.0.0/8", "192.168.*": "192.168.0.0/16" }
  const entries = value
    .split(/[;,]/)
    .map(s => s.trim())
    .filter(s => s && s !== "<local>")
  return [...new Set(entries.map(s => mapping[s] || s))]
}

class WindowsSystem {
  context = `windows:${process.env.USERDOMAIN || ""}:${os.userInfo().username}`
  read() {
    return powershell("system-proxy.ps1", "read")
  }
  write(value) {
    return powershell("system-proxy.ps1", "write", value)
  }
  enabled(value) {
    return !!(value.flags & 14)
  }
  desired(config) {
    return {
      flags: 3,
      server: `127.0.0.1:${config.core.mixedPort}`,
      bypass: config.system.bypass,
      pac: "",
    }
  }
}

const gnomeKeys = {
  mode: ["org.gnome.system.proxy", "mode"],
  same: ["org.gnome.system.proxy", "use-same-proxy"],
  auth: ["org.gnome.system.proxy.http", "use-authentication"],
  bypass: ["org.gnome.system.proxy", "ignore-hosts"],
  httpHost: ["org.gnome.system.proxy.http", "host"],
  httpPort: ["org.gnome.system.proxy.http", "port"],
  httpsHost: ["org.gnome.system.proxy.https", "host"],
  httpsPort: ["org.gnome.system.proxy.https", "port"],
  socksHost: ["org.gnome.system.proxy.socks", "host"],
  socksPort: ["org.gnome.system.proxy.socks", "port"],
}

class GnomeSystem {
  context = `linux:${process.getuid()}:gnome`
  enabled(value) {
    return value.mode !== "none"
  }
  async read() {
    const entries = await Promise.all(
      Object.entries(gnomeKeys).map(async ([key, args]) => {
        const { stdout } = await execFile("gsettings", ["get", ...args])
        const kind =
          key === "bypass"
            ? "array"
            : ["same", "auth"].includes(key)
              ? "boolean"
              : key.endsWith("Port")
                ? "number"
                : "string"
        return [key, parseGVariant(stdout, kind)]
      }),
    )
    return Object.fromEntries(entries)
  }
  async write(value) {
    // mode 最后设置，避免地址未准备好时桌面立即开始使用。
    for (const key of [...Object.keys(value).filter(key => key !== "mode"), "mode"]) {
      if (!(key in value)) continue
      const variant = Array.isArray(value[key])
        ? `[${value[key].map(variantString).join(", ")}]`
        : typeof value[key] === "string"
          ? variantString(value[key])
          : String(value[key])
      const { stderr } = await execFile("gsettings", ["set", ...gnomeKeys[key], variant])
      if (/failed|error|cannot/i.test(stderr))
        throw new Error("GNOME 代理写入失败，请检查 D-Bus 会话")
    }
  }
  desired(config) {
    return {
      mode: "manual",
      same: false,
      auth: false,
      bypass: linuxBypass(config.system.bypass),
      httpHost: "127.0.0.1",
      httpPort: config.core.mixedPort,
      httpsHost: "127.0.0.1",
      httpsPort: config.core.mixedPort,
      socksHost: "127.0.0.1",
      socksPort: config.core.mixedPort,
    }
  }
}

const kdeKeys = [
  "ProxyType",
  "httpProxy",
  "httpsProxy",
  "socksProxy",
  "NoProxyFor",
  "ReversedException",
]
class KdeSystem {
  constructor(version) {
    this.version = version
    this.context = `linux:${process.getuid()}:kde`
  }
  enabled(value) {
    return value.ProxyType !== null && value.ProxyType !== "0"
  }
  async read() {
    const result = {}
    for (const key of kdeKeys) {
      const { stdout } = await execFile(`kreadconfig${this.version}`, [
        "--file",
        "kioslaverc",
        "--group",
        "Proxy Settings",
        "--key",
        key,
        "--default",
        "__PROXY_PLUGIN_ABSENT__",
      ])
      result[key] = stdout.trim() === "__PROXY_PLUGIN_ABSENT__" ? null : stdout.trim()
    }
    return result
  }
  async write(value) {
    for (const [key, entry] of Object.entries(value)) {
      const args = ["--file", "kioslaverc", "--group", "Proxy Settings", "--key", key]
      await execFile(
        `kwriteconfig${this.version}`,
        entry === null ? [...args, "--delete"] : [...args, entry],
      )
    }
    await execFile("dbus-send", [
      "--session",
      "--type=signal",
      "/KIO/Scheduler",
      "org.kde.KIO.Scheduler.reparseSlaveConfiguration",
      "string:",
    ])
  }
  desired(config) {
    return {
      ProxyType: "1",
      httpProxy: `http://127.0.0.1:${config.core.mixedPort}`,
      httpsProxy: `http://127.0.0.1:${config.core.mixedPort}`,
      socksProxy: `socks://127.0.0.1:${config.core.mixedPort}`,
      NoProxyFor: linuxBypass(config.system.bypass).join(","),
      ReversedException: "false",
    }
  }
}

export class Platform {
  async system(config) {
    if (process.platform === "win32") return new WindowsSystem()
    if (process.platform !== "linux") throw new Error("初版仅支持 Windows 和 Linux")
    if (process.getuid() === 0)
      throw new Error(
        "当前云崽以 root 运行，不能代替桌面用户设置代理；请使用 TUN 或在目标用户会话运行",
      )
    const runtime = process.env.XDG_RUNTIME_DIR
    const bus =
      process.env.DBUS_SESSION_BUS_ADDRESS ||
      (runtime &&
        (await fs.access(`${runtime}/bus`).then(
          () => true,
          () => false,
        )))
    if (!bus) throw new Error("未发现桌面 D-Bus 会话；无桌面 Linux 请使用 TUN")
    const desktop =
      config.system.linuxDesktop === "auto"
        ? (process.env.XDG_CURRENT_DESKTOP || process.env.DESKTOP_SESSION || "").toLowerCase()
        : config.system.linuxDesktop
    if (/gnome|cinnamon|unity/.test(desktop)) return new GnomeSystem()
    if (/kde|plasma/.test(desktop)) {
      for (const version of [6, 5]) {
        try {
          await execFile(`kreadconfig${version}`, ["--version"])
          await execFile(`kwriteconfig${version}`, ["--version"])
          return new KdeSystem(version)
        } catch {}
      }
      throw new Error("KDE 缺少 kreadconfig/kwriteconfig")
    }
    throw new Error("未识别桌面环境，可在锅巴指定 gnome/kde；无桌面环境请使用 TUN")
  }

  async checkTun(binary, config) {
    if (process.platform === "win32") {
      const result = await powershell("core-process.ps1", "admin")
      if (!result.admin && !config.core.windowsElevate)
        throw new Error("Windows TUN 需要核心获得管理员权限；可在锅巴开启“Windows 核心 UAC 提权”")
      return
    }
    if (process.platform !== "linux") throw new Error("初版仅支持 Windows 和 Linux")
    await fs.access("/dev/net/tun").catch(() => {
      throw new Error("缺少 /dev/net/tun，请检查内核 TUN 模块或容器设备映射")
    })
    if (process.getuid() === 0) return
    const status = await fs.readFile("/proc/self/status", "utf8")
    const effective = BigInt("0x" + (status.match(/^CapEff:\s*(\w+)/m)?.[1] || "0"))
    if (effective & (1n << 12n)) return
    const { stdout } = await execFile("getcap", [binary]).catch(() => ({ stdout: "" }))
    if (!/cap_net_admin[^\n]*[=+]\w*e/.test(stdout))
      throw new Error(
        "Linux 核心缺少 CAP_NET_ADMIN；请由管理员配置核心权限或使用具备权限的启动环境",
      )
  }

  async inspectTun(device) {
    if (process.platform === "win32") return powershell("core-process.ps1", "tun", { device })
    if (process.platform !== "linux") return { interface: null, routes: null }
    const exists = await fs.access(`/sys/class/net/${device}`).then(
      () => true,
      () => false,
    )
    if (!exists) return { interface: false, routes: false }
    try {
      const { stdout } = await execFile("ip", ["-json", "route", "show", "table", "all"])
      return { interface: true, routes: JSON.parse(stdout).some(route => route.dev === device) }
    } catch {
      return { interface: true, routes: null }
    }
  }
}
