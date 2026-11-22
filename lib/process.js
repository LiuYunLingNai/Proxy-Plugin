import { execFile as exec, spawn } from "node:child_process"
import { promisify } from "node:util"
import fs from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"
import { fileURLToPath } from "node:url"

const execAsync = promisify(exec)
export const scriptsDir = fileURLToPath(new URL("../scripts/", import.meta.url))
export const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

export async function execFile(file, args = [], options = {}) {
  try {
    return await execAsync(file, args, {
      windowsHide: true,
      timeout: 15000,
      maxBuffer: 2 * 1024 * 1024,
      ...options,
    })
  } catch (error) {
    // execFile 默认错误会包含完整参数；系统代理快照和启动器 payload 不应进入聊天或日志。
    const message = `${path.basename(file)} 执行失败（${error.code || error.signal || "unknown"}）${error.stderr?.trim() ? `：${error.stderr.trim().slice(0, 1500)}` : ""}`
    const failure = new Error(message, { cause: error })
    failure.stderr = error.stderr
    throw failure
  }
}

export async function powershell(script, action, payload = {}, options = {}) {
  const { stdout } = await execFile(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(scriptsDir, script),
      "-Action",
      action,
      "-Payload",
      Buffer.from(JSON.stringify(payload)).toString("base64"),
    ],
    options,
  )
  return stdout.trim() ? JSON.parse(stdout.replace(/^\uFEFF/, "").trim()) : null
}

export async function processIdentity(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null
  if (process.platform === "win32") return powershell("core-process.ps1", "identity", { pid })
  if (process.platform !== "linux") throw new Error("初版仅支持 Windows 和 Linux")
  try {
    const [stat, executable, command] = await Promise.all([
      fs.readFile(`/proc/${pid}/stat`, "utf8"),
      fs.readlink(`/proc/${pid}/exe`),
      fs.readFile(`/proc/${pid}/cmdline`),
    ])
    const fields = stat
      .slice(stat.lastIndexOf(")") + 2)
      .trim()
      .split(/\s+/)
    return {
      pid,
      executable,
      birth: fields[19],
      args: command.toString().split("\0").filter(Boolean),
    }
  } catch (error) {
    if (["ENOENT", "ESRCH"].includes(error.code)) return null
    throw new Error(`无法确认核心进程身份：${error.code || error.message}`)
  }
}

export function isCoreName(value) {
  const name = path.win32
    .basename(path.posix.basename(String(value).replace(/ \(deleted\)$/, "")))
    .replace(/\.exe$/i, "")
  if (/^mihomo-party(?:[-_.].*)?$/i.test(name)) return false
  return /^(?:mihomo(?:[-_.].*)?|clash(?:[-_.](?:meta|core)(?:[-_.].*)?)?)$/i.test(name)
}

export async function listCoreProcesses() {
  if (process.platform === "win32") {
    const result = await powershell("core-process.ps1", "list")
    const items = Array.isArray(result) ? result : result ? [result] : []
    return items.filter(item => isCoreName(item.name) || isCoreName(item.executable))
  }
  if (process.platform !== "linux") throw new Error("初版仅支持 Windows 和 Linux")
  return scanLinuxCoreProcesses()
}

export async function scanLinuxCoreProcesses(procRoot = "/proc") {
  const directories = (await fs.readdir(procRoot, { withFileTypes: true })).filter(
    entry => entry.isDirectory() && /^\d+$/.test(entry.name),
  )
  const result = []
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(16, directories.length) }, async () => {
      while (cursor < directories.length) {
        const pid = Number(directories[cursor++].name)
        const [comm, executable] = await Promise.all([
          fs.readFile(path.join(procRoot, String(pid), "comm"), "utf8").catch(() => ""),
          fs.readlink(path.join(procRoot, String(pid), "exe")).catch(() => ""),
        ])
        const name = comm.trim()
        if (isCoreName(name) || isCoreName(executable))
          result.push({ pid, name, executable: executable || null })
      }
    }),
  )
  return result.sort((a, b) => a.pid - b.pid)
}

export function sameProcess(a, b) {
  if (!a || !b || a.pid !== b.pid || String(a.birth) !== String(b.birth)) return false
  const normalize = value => (process.platform === "win32" ? value?.toLowerCase() : value)
  // 普通用户查询提升后的 Windows 进程时路径可能被系统隐藏，PID + 创建时刻仍可防止复用。
  if (process.platform === "win32" && !a.executable && b.executable) return true
  return !!a.executable && normalize(a.executable) === normalize(b.executable)
}

export async function launchCore(binary, args, log, { elevated = false, dataDir } = {}) {
  await fs.mkdir(path.dirname(log), { recursive: true })
  if (process.platform === "win32" && elevated) {
    const resultFile = path.join(dataDir, "runtime", `launch-${crypto.randomUUID()}.json`)
    await fs.mkdir(path.dirname(resultFile), { recursive: true })
    try {
      await powershell(
        "core-process.ps1",
        "start",
        { binary, args, log, resultFile, elevate: true },
        { timeout: 180000 },
      )
      const result = JSON.parse((await fs.readFile(resultFile, "utf8")).replace(/^\uFEFF/, ""))
      if (result.error) throw new Error(result.error)
      return result.identity
    } finally {
      await fs.unlink(resultFile).catch(() => {})
    }
  }
  const handle = await fs.open(log, "a", 0o600)
  let child
  try {
    child = spawn(binary, args, {
      detached: true,
      windowsHide: true,
      stdio: ["ignore", handle.fd, handle.fd],
      cwd: dataDir,
    })
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve)
      child.once("error", reject)
    })
    child.unref()
  } finally {
    await handle.close()
  }
  let identity
  try {
    for (let i = 0; i < 10; i++) {
      identity = await processIdentity(child.pid)
      if (identity) break
      await pause(100)
    }
    if (!identity) throw new Error("核心启动后立即退出，请查看本地核心日志")
  } catch (error) {
    // 尚未持久化身份时，只终止刚创建且仍由 ChildProcess 句柄跟踪的子进程。
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once("exit", resolve))
      child.kill()
      await Promise.race([exited, pause(3000)])
    }
    throw error
  }
  return identity
}

export async function terminateCore(identity, { elevated = false, dataDir } = {}) {
  if (process.platform === "win32" && elevated) {
    const resultFile = path.join(dataDir, "runtime", `stop-${crypto.randomUUID()}.json`)
    try {
      await powershell(
        "core-process.ps1",
        "stop",
        { identity, elevate: true, resultFile },
        { timeout: 180000 },
      )
      const result = JSON.parse((await fs.readFile(resultFile, "utf8")).replace(/^\uFEFF/, ""))
      if (result.error) throw new Error(result.error)
      return
    } finally {
      await fs.unlink(resultFile).catch(() => {})
    }
  }
  const current = await processIdentity(identity.pid)
  if (!current) return
  if (!sameProcess(current, identity)) throw new Error("PID 已属于其他进程，拒绝停止")
  try {
    process.kill(identity.pid, "SIGTERM")
  } catch (error) {
    if (error.code !== "ESRCH") throw error
  }
  for (let i = 0; i < 50; i++) {
    if (!sameProcess(await processIdentity(identity.pid), identity)) return
    await pause(100)
  }
  throw new Error("核心未在 5 秒内退出；保留进程记录，请检查本地日志后重试")
}
