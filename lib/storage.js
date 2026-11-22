import fs from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"

export async function atomicWrite(file, content, mode = 0o600) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${crypto.randomUUID()}.tmp`
  try {
    await fs.writeFile(temporary, content, { mode })
    await fs.rename(temporary, file)
  } finally {
    await fs.unlink(temporary).catch(() => {})
  }
}

export async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"))
  } catch (error) {
    if (error.code === "ENOENT") return fallback
    throw new Error(`运行记录无法读取：${path.basename(file)}，${error.message}`)
  }
}

export function writeJson(file, value) {
  return atomicWrite(file, JSON.stringify(value, null, 2) + "\n")
}

export function redact(text) {
  return String(text)
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[URL 已隐藏]")
    .replace(
      /(authorization|secret|password|uuid|token|private-key)\s*[:=]\s*[^\s,]+/gi,
      "$1: [已隐藏]",
    )
}

export class SerialQueue {
  tail = Promise.resolve()
  run(fn) {
    const result = this.tail.then(fn, fn)
    this.tail = result.catch(() => {})
    return result
  }
}
