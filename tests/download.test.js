import test from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import path from "node:path"
import { Installer, downloadFromMirrors, versionStore } from "../lib/installer.js"
import { ConfigStore, defaults, validateConfig } from "../lib/config.js"
import { getManager } from "../lib/manager.js"
import { supportGuoba } from "../guoba.support.js"
import { tempRoot } from "./helpers.js"
import { atomicWrite, writeJson } from "../lib/storage.js"

async function downloadServer(t, version = "v1.0") {
  const requests = []
  const server = http.createServer((request, response) => {
    requests.push(request.url)
    if (request.url.startsWith("/bad/")) {
      response.writeHead(403)
      response.end("unavailable")
    } else if (request.url.startsWith("/html/")) response.end("<html>not release metadata</html>")
    else response.end(JSON.stringify({ tag_name: version, assets: [] }))
  })
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  t.after(() => {
    server.closeAllConnections()
    return new Promise(resolve => server.close(resolve))
  })
  return { base: `http://127.0.0.1:${server.address().port}`, requests }
}

test("镜像失败后按配置顺序尝试直连", async t => {
  const { base, requests } = await downloadServer(t)
  const buffer = await downloadFromMirrors(`${base}/release`, [`${base}/bad/`, ""], 2000, 4096)
  assert.equal(JSON.parse(buffer).tag_name, "v1.0")
  assert.equal(requests.length, 2)
  assert.ok(requests[0].startsWith("/bad/"))
  assert.equal(requests[1], "/release")
})

test("版本信息返回 HTML 时验证失败并回退到下一个镜像", async t => {
  const { base, requests } = await downloadServer(t)
  const buffer = await downloadFromMirrors(
    "https://api.github.com/example",
    [`${base}/html/`, `${base}/good/`],
    2000,
    4096,
    text => JSON.parse(text),
  )
  assert.equal(JSON.parse(buffer).tag_name, "v1.0")
  assert.equal(requests.length, 2)
  assert.ok(requests[1].startsWith("/good/https://api.github.com/"))
})

test("未选择直连时不会自行添加直连请求", async t => {
  const { base, requests } = await downloadServer(t)
  await assert.rejects(
    downloadFromMirrors(`${base}/release`, [`${base}/bad/`], 2000, 4096),
    /下载源均失败/,
  )
  assert.equal(requests.length, 1)
})

test("更新核心强制刷新最新版本信息，并复用该版本已安装的二进制", async t => {
  const version = "v1.99.0"
  const { base, requests } = await downloadServer(t, version)
  const store = new ConfigStore(await tempRoot(t))
  const config = await store.load()
  config.core.version = "v1.98.0"
  config.download.mirrors = [`${base}/mirror/`]
  await writeJson(path.join(store.data, "runtime", "release.json"), {
    request: "latest", at: Date.now(), tag_name: "v1.98.0", assets: [],
  })
  const binary = path.join(versionStore(store, version).data, "bin", process.platform === "win32" ? "mihomo.exe" : "mihomo")
  await atomicWrite(binary, "cached core")
  const core = await new Installer(store).latest(config)
  assert.equal(core.version, version)
  assert.equal(path.resolve(core.path), path.resolve(binary))
  assert.equal(requests.length, 1)
  assert.match(requests[0], /\/mirror\/https:\/\/api\.github\.com\/repos\/MetaCubeX\/mihomo\/releases\/latest$/)
  assert.equal(config.core.version, "v1.98.0")
})

test("锅巴保存下载源顺序，错误前缀被拒绝且不覆盖有效配置", async t => {
  const previous = globalThis.__proxyPluginManagerV1
  const store = new ConfigStore(await tempRoot(t))
  const manager = getManager()
  // 仅此测试工作线程中的单例使用隔离目录，不访问真实机器人配置。
  const originalStore = manager.store
  manager.store = store
  t.after(() => {
    manager.store = originalStore
    globalThis.__proxyPluginManagerV1 = previous
  })
  await store.load()
  const Result = {
    ok: (_, message) => ({ ok: true, message }),
    error: message => ({ ok: false, message }),
  }
  const support = supportGuoba()
  assert.equal(
    support.configInfo.schemas.find(item => item.field === "download.mirrors").componentProps.mode,
    "tags",
  )
  const mirrors = ["https://gh-proxy.com/", "https://ghfast.top/", ""]
  assert.equal(
    (await support.configInfo.setConfigData({ "download.mirrors": mirrors }, { Result })).ok,
    true,
  )
  assert.deepEqual((await store.load()).download.mirrors, mirrors)
  assert.equal(
    (
      await support.configInfo.setConfigData(
        { "download.mirrors": ["https://example.com"] },
        { Result },
      )
    ).ok,
    false,
  )
  assert.deepEqual((await store.load()).download.mirrors, mirrors)
})

test("下载源拒绝非字符串及包含查询参数的前缀", () => {
  const config = structuredClone(defaults)
  config.download.mirrors = [null]
  assert.throws(() => validateConfig(config), /字符串/)
  config.download.mirrors = ["https://example.com/?token=test/"]
  assert.throws(() => validateConfig(config), /查询参数/)
})
