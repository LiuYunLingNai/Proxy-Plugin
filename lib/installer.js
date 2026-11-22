import fs from "node:fs/promises"
import path from "node:path"
import zlib from "node:zlib"
import crypto from "node:crypto"
import { execFile, scriptsDir, pause } from "./process.js"
import { atomicWrite, readJson, writeJson } from "./storage.js"

async function fetchOnce(url, timeout, limit) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    headers: { "User-Agent": "Yunzai-Proxy-Plugin" },
  })
  if (!response.ok) {
    const error = new Error(`下载返回 HTTP ${response.status}`)
    error.retryable = response.status >= 500 || response.status === 429
    throw error
  }
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.byteLength
    if (size > limit) throw new Error("下载文件超过大小限制")
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

async function fetchBuffer(url, timeout, limit = 160 * 1024 * 1024) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fetchOnce(url, timeout, limit)
    } catch (error) {
      const retryable =
        error.retryable ||
        error instanceof TypeError ||
        ["TimeoutError", "AbortError"].includes(error.name)
      if (!retryable || attempt === 2) throw error
      await pause(500 * (attempt + 1))
    }
  }
}

export async function downloadFromMirrors(url, mirrors, timeout, limit, validate = () => {}) {
  let failure
  for (const mirror of mirrors) {
    try {
      const buffer = await fetchBuffer(mirror ? mirror + url : url, timeout, limit)
      await validate(buffer)
      return buffer
    } catch (error) {
      failure = error
    }
  }
  throw new Error(`GitHub 下载源均失败：${failure?.message || "未配置下载源"}`)
}

export function chooseAsset(assets, platform, arch, tag) {
  const os = { win32: "windows", linux: "linux" }[platform]
  const cpu = { x64: "amd64", arm64: "arm64" }[arch]
  if (!os || !cpu) throw new Error(`初版不支持 ${platform}/${arch}`)
  const extension = os === "windows" ? ".zip" : ".gz"
  const prefix = `mihomo-${os}-${cpu}`
  const names =
    cpu === "amd64"
      ? [
          `${prefix}-compatible-${tag}${extension}`,
          `${prefix}-v1-${tag}${extension}`,
          `${prefix}-${tag}${extension}`,
        ]
      : [`${prefix}-${tag}${extension}`]
  const asset = names.map(name => assets.find(asset => asset.name === name)).find(Boolean)
  if (!asset) throw new Error(`该版本未找到适合 ${os}/${cpu} 的核心，请手动配置 core.path`)
  return asset
}

export class Installer {
  constructor(store) {
    this.store = store
  }
  async ensure(config) {
    const binary = config.core.path
      ? path.resolve(this.store.root, config.core.path)
      : path.join(this.store.data, "bin", process.platform === "win32" ? "mihomo.exe" : "mihomo")
    if (
      await fs.access(binary).then(
        () => true,
        () => false,
      )
    )
      return fs.realpath(binary)
    if (config.core.path) throw new Error("core.path 指向的核心文件不存在")
    const cacheFile = path.join(this.store.data, "runtime", "release.json")
    let release = await readJson(cacheFile)
    const version = config.core.version || "latest"
    if (!release || Date.now() - release.at > 6 * 3600e3 || release.request !== version) {
      const suffix = version === "latest" ? "latest" : `tags/${encodeURIComponent(version)}`
      const text = await downloadFromMirrors(
        `https://api.github.com/repos/MetaCubeX/mihomo/releases/${suffix}`,
        config.download.mirrors,
        20000,
        4 * 1024 * 1024,
        buffer => {
          const document = JSON.parse(buffer.toString())
          if (typeof document.tag_name !== "string" || !Array.isArray(document.assets))
            throw new Error("下载源未返回有效的 GitHub Release 信息")
        },
      )
      release = { ...JSON.parse(text.toString()), at: Date.now(), request: version }
      await writeJson(cacheFile, release)
    }
    const asset = chooseAsset(
      release.assets || [],
      process.platform,
      process.arch,
      release.tag_name,
    )
    let buffer
    try {
      buffer = await downloadFromMirrors(
        asset.browser_download_url,
        config.download.mirrors,
        config.download.timeoutSeconds * 1000,
        undefined,
        buffer => {
          if (asset.digest?.startsWith("sha256:")) {
            const digest = crypto.createHash("sha256").update(buffer).digest("hex")
            if (digest !== asset.digest.slice(7)) throw new Error("核心下载 SHA256 校验失败")
          }
        },
      )
    } catch (error) {
      throw new Error(`核心下载失败：${error.message}；可手动指定 core.path`)
    }
    if (process.platform === "win32") {
      const binDirectory = path.join(this.store.data, "bin")
      await fs.mkdir(binDirectory, { recursive: true })
      const directory = await fs.mkdtemp(path.join(binDirectory, "extract-"))
      const archive = path.join(directory, "mihomo.zip")
      await fs.writeFile(archive, buffer)
      await execFile(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          path.join(scriptsDir, "expand-archive.ps1"),
          "-Archive",
          archive,
          "-Destination",
          directory,
        ],
        { timeout: 60000 },
      )
      const files = await fs.readdir(directory)
      const executable = files.find(name => /^mihomo.*\.exe$/i.test(name))
      if (!executable) throw new Error("核心压缩包没有 mihomo 可执行文件")
      await atomicWrite(binary, await fs.readFile(path.join(directory, executable)))
      for (const name of files.filter(name => /\.dll$/i.test(name))) {
        await atomicWrite(
          path.join(path.dirname(binary), name),
          await fs.readFile(path.join(directory, name)),
        )
      }
      await fs.unlink(archive)
    } else {
      await atomicWrite(
        binary,
        zlib.gunzipSync(buffer, { maxOutputLength: 160 * 1024 * 1024 }),
        0o755,
      )
      await fs.chmod(binary, 0o755)
    }
    return fs.realpath(binary)
  }
}
