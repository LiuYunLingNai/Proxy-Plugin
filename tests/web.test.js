import test from "node:test"
import assert from "node:assert/strict"
import express from "express"
import { once } from "node:events"
import { ProxyWebServer, WEB_PREFIX } from "../lib/web-server.js"
import ProxyPlugin from "../apps/proxy.js"
import { defaults, ConfigStore, validateConfig } from "../lib/config.js"
import { createWebActions } from "../lib/web-actions.js"
import { SerialQueue } from "../lib/storage.js"
import { tempRoot } from "./helpers.js"
import { supportGuoba } from "../guoba.support.js"

async function unusedPort() {
  const server = express().listen(0, "127.0.0.1")
  await once(server, "listening")
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

test("独立 WebUI 无需云崽 HTTP 服务，复用监听、鉴权并在最后卸载时释放端口", async t => {
  const web = new ProxyWebServer({ actions: { status: async () => ({ running: false }) } })
  const options = { ...defaults.webui, mountToYunzai: false, port: await unusedPort() }
  const [lease, second] = await Promise.all([web.attachConfigured(options), web.attachConfigured(options)])
  t.after(() => Promise.all([...web.leases].map(item => web.release(item))))
  assert.equal(web.leases.size, 2)
  const hostApp = express()
  assert.equal(hostApp.skip_auth, undefined)
  const base = web.accessBase("https://yunzai.example:2536") + WEB_PREFIX + "/"
  const read = url => fetch(url, { headers: { Connection: "close" } })
  assert.equal(base, `http://127.0.0.1:${options.port}${WEB_PREFIX}/`)
  assert.equal((await read(base)).status, 200)
  const body = await (await read(base)).text()
  const asset = body.match(/src="([^"]+\.js)"/)?.[1]
  assert.ok(asset)
  assert.equal((await read(new URL(asset, base))).status, 200)
  const request = headers => fetch(base + "api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json", Connection: "close", ...headers },
    body: JSON.stringify({ action: "status" }),
  })
  assert.equal((await request({})).status, 401)
  const { token } = web.createSession()
  assert.equal((await request({ Authorization: `Bearer ${token}` })).status, 200)
  assert.equal((await request({ Authorization: `Bearer ${token}`, Origin: "https://foreign.example" })).status, 403)
  await web.release(lease)
  assert.equal((await read(base)).status, 200)
  web.revoke()
  assert.equal((await request({ Authorization: `Bearer ${token}` })).status, 401)
  await web.release(second)
  assert.equal(web.server, null)
  assert.equal(web.app, null)
  const restored = await web.attachConfigured(options)
  assert.equal((await read(base)).status, 200)
  await web.release(restored)
  const reused = express().listen(options.port, options.host)
  await once(reused, "listening")
  await new Promise(resolve => reused.close(resolve))
})

test("挂载模式忽略独立端口，关闭 WebUI 不挂载，访问地址可覆盖默认链接", async t => {
  const web = new ProxyWebServer({ actions: {} })
  const occupied = express().listen(0, "127.0.0.1")
  await once(occupied, "listening")
  t.after(() => new Promise(resolve => occupied.close(resolve)))
  const app = express()
  assert.equal(await web.attachConfigured({ ...defaults.webui, enabled: false }, app), null)
  assert.equal(app.skip_auth, undefined)
  assert.equal(web.server, null)
  assert.throws(() => web.accessBase("http://localhost:2536"), /未启用/)
  const lease = await web.attachConfigured({ ...defaults.webui, port: occupied.address().port, publicUrl: "https://proxy.example/base/" }, app)
  assert.equal(web.server, null)
  assert.equal(web.app, app)
  assert.equal(web.accessBase("http://localhost:2536"), "https://proxy.example/base")
  await web.release(lease)
  assert.equal(app.skip_auth.includes(WEB_PREFIX + "/"), false)
})

test("独立端口占用失败不残留挂载或 lease，可修改端口后重试", async t => {
  const occupied = express().listen(0, "127.0.0.1")
  await once(occupied, "listening")
  t.after(() => new Promise(resolve => occupied.close(resolve)))
  const web = new ProxyWebServer({ actions: { status: async () => ({ running: false }) } })
  await assert.rejects(web.attachConfigured({ ...defaults.webui, mountToYunzai: false, port: occupied.address().port }), /已被占用/)
  assert.equal(web.app, null)
  assert.equal(web.leases.size, 0)
  assert.equal(web.server, null)
  assert.throws(() => web.accessBase(), /已被占用/)
  const lease = await web.attachConfigured({ ...defaults.webui, mountToYunzai: false, port: await unusedPort(), publicUrl: "https://standalone.example" })
  assert.equal(web.accessBase(), "https://standalone.example")
  const { token } = web.createSession()
  const request = origin => fetch(`http://127.0.0.1:${web.server.address().port}${WEB_PREFIX}/api/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: "status" }),
  })
  assert.equal((await request("https://standalone.example")).status, 200)
  assert.equal((await request("https://foreign.example")).status, 403)
  await web.release(lease)
})

test("锅巴和 WebUI 保存服务配置，拒绝非法值且不覆盖已有设置", async t => {
  const store = new ConfigStore(await tempRoot(t))
  const manager = {
    initialize: async () => {},
    store,
    queue: new SerialQueue(),
    saveSettings: config => store.save(config),
  }
  const previous = globalThis.__proxyPluginManagerV1
  globalThis.__proxyPluginManagerV1 = manager
  t.after(() => { globalThis.__proxyPluginManagerV1 = previous })
  const actions = createWebActions(() => manager)
  const config = await store.load()
  const fields = {
    "webui.enabled": true,
    "webui.mountToYunzai": false,
    "webui.port": 19123,
    "webui.host": "0.0.0.0",
    "webui.publicUrl": "https://proxy.example",
  }
  await actions.saveSettings(fields)
  assert.deepEqual((await actions.settings()).webui, {
    enabled: true, mountToYunzai: false, host: "0.0.0.0", port: 19123, publicUrl: "https://proxy.example",
  })
  const saved = await store.load()
  for (const invalid of [
    { "webui.port": 0 }, { "webui.port": "19100" }, { "webui.port": 65536 }, { "webui.port": 19100.5 },
    { "webui.port": config.core.mixedPort }, { "webui.port": config.core.controllerPort },
    { "webui.enabled": "true" }, { "webui.mountToYunzai": 0 },
    { "webui.host": "https://127.0.0.1" }, { "webui.host": "127.0.0.1\n" },
    { "webui.publicUrl": "https://user:pass@example.com" }, { "webui.publicUrl": "file:///tmp/ui" },
    { "webui.publicUrl": "https://example.com/#token=secret" },
  ]) {
    await assert.rejects(actions.saveSettings(invalid))
    assert.deepEqual(await store.load(), saved)
  }
  const support = supportGuoba()
  for (const field of Object.keys(fields)) assert.ok(support.configInfo.schemas.some(item => item.field === field))
  const Result = { ok: (_, message) => ({ ok: true, message }), error: message => ({ ok: false, message }) }
  const result = await support.configInfo.setConfigData({ "webui.enabled": false, "webui.mountToYunzai": true }, { Result })
  assert.equal(result.ok, true)
  assert.match(result.message, /重启云崽/)
  assert.equal((await store.load()).webui.enabled, false)
  assert.equal((await store.load()).webui.mountToYunzai, true)
  assert.doesNotThrow(() => validateConfig({ ...config, webui: { ...defaults.webui, host: "::1" } }))
})

test("插件自己的 WebUI 入口提供静态页面，API 校验令牌、过期及撤销", async t => {
  let now = 1000
  let called = 0
  const web = new ProxyWebServer({
    actions: {
      status: async () => {
        called++
        return { running: false }
      },
    },
    now: () => now,
  })
  const app = express()
  const lease = web.attach(app)
  const secondLease = web.attach(app)
  app.use((req, res) => res.status(418).send("宿主兜底"))
  const server = app.listen(0, "127.0.0.1")
  await once(server, "listening")
  t.after(() => {
    server.closeAllConnections()
    return new Promise(resolve => server.close(resolve))
  })
  const base = `http://127.0.0.1:${server.address().port}${WEB_PREFIX}/`
  const html = await fetch(base)
  assert.equal(html.status, 200)
  const body = await html.text()
  assert.ok(body.includes('id="root"'))
  const asset = body.match(/src="([^"]+\.js)"/)?.[1]
  assert.ok(asset)
  assert.equal((await fetch(new URL(asset, base))).status, 200)
  const request = (token, action = "status", origin) =>
    fetch(base + "api/action", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(origin ? { Origin: origin } : {}),
      },
      body: JSON.stringify({ action }),
    })
  assert.equal((await request()).status, 401)
  assert.equal(called, 0)
  const { token } = web.createSession(1)
  assert.equal((await request(token)).status, 200)
  assert.equal(called, 1)
  assert.equal((await request(token, "constructor")).status, 400)
  assert.equal((await request(token, "status", "https://another.example")).status, 403)
  now += 60001
  assert.equal((await request(token)).status, 401)
  const next = web.createSession()
  assert.equal(web.revoke(), 1)
  assert.equal((await request(next.token)).status, 401)
  web.detach(lease)
  assert.equal((await fetch(base)).status, 200)
  web.detach(secondLease)
  assert.equal(app.skip_auth.includes(WEB_PREFIX + "/"), false)
  assert.equal((await fetch(base)).status, 418)
  const restoredLease = web.attach(app)
  assert.equal((await fetch(base)).status, 200)
  web.detach(restoredLease)
})

test("正常插件 init 挂载 WebUI，主人命令生成链接并可下线撤销", async t => {
  const previousManager = globalThis.__proxyPluginManagerV1
  const previousWeb = globalThis.__proxyPluginWebServerV1
  const previousBot = globalThis.Bot
  const app = express()
  const web = new ProxyWebServer({ actions: {} })
  let detached = false
  globalThis.__proxyPluginManagerV1 = {
    initialize: async () => {},
    attach: async () => Symbol("manager"),
    detach: async () => {
      detached = true
    },
    store: { load: async () => ({ core: { autoStart: false } }) },
  }
  globalThis.__proxyPluginWebServerV1 = web
  globalThis.Bot = { express: app, url: "http://127.0.0.1:2536" }
  t.after(() => {
    globalThis.__proxyPluginManagerV1 = previousManager
    globalThis.__proxyPluginWebServerV1 = previousWeb
    globalThis.Bot = previousBot
  })
  const plugin = new ProxyPlugin()
  const cleanup = []
  plugin.addCleanup = (dispose, restore) => cleanup.push({ dispose, restore })
  await plugin.init()
  const replies = []
  await plugin.dispatch({
    isMaster: true,
    msg: "#代理web 60",
    reply: async text => replies.push(text),
  })
  assert.ok(replies[0].includes("http://127.0.0.1:2536/proxy-plugin/#token="))
  assert.equal(web.sessions.size, 1)
  await plugin.dispatch({
    isMaster: true,
    msg: "#代理下线",
    reply: async text => replies.push(text),
  })
  assert.equal(web.sessions.size, 0)
  for (const item of cleanup) await item.dispose()
  assert.equal(detached, true)
  assert.equal(web.app, null)
  for (const item of cleanup) await item.restore()
  assert.equal(web.app, app)
  for (const item of cleanup) await item.dispose()
})

test("插件独立模式无 Bot HTTP 依赖，链接使用独立端口，关闭模式返回明确提示", async t => {
  const previous = {
    manager: globalThis.__proxyPluginManagerV1,
    web: globalThis.__proxyPluginWebServerV1,
    bot: globalThis.Bot,
  }
  const config = structuredClone(defaults)
  config.webui.mountToYunzai = false
  config.webui.port = await unusedPort()
  const web = new ProxyWebServer({ actions: {} })
  globalThis.__proxyPluginManagerV1 = {
    initialize: async () => {},
    attach: async () => Symbol("manager"),
    detach: async () => {},
    store: { load: async () => config },
  }
  globalThis.__proxyPluginWebServerV1 = web
  globalThis.Bot = undefined
  t.after(async () => {
    await Promise.all([...web.leases].map(item => web.release(item)))
    globalThis.__proxyPluginManagerV1 = previous.manager
    globalThis.__proxyPluginWebServerV1 = previous.web
    globalThis.Bot = previous.bot
  })
  const plugin = new ProxyPlugin()
  const cleanup = []
  plugin.addCleanup = (dispose, restore) => cleanup.push({ dispose, restore })
  await plugin.init()
  const replies = []
  const event = { isMaster: true, msg: "#代理web", reply: async text => replies.push(text) }
  await plugin.dispatch(event)
  assert.ok(replies.at(-1).includes(`http://127.0.0.1:${config.webui.port}/proxy-plugin/#token=`))
  for (const item of cleanup) await item.dispose()
  config.webui.enabled = false
  for (const item of cleanup) await item.restore()
  assert.equal(web.server, null)
  await plugin.dispatch(event)
  assert.match(replies.at(-1), /未启用/)
  for (const item of cleanup) await item.dispose()
})

test("完整配置导入可越过宿主默认 JSON 大小限制，仍使用插件鉴权", async t => {
  const web = new ProxyWebServer({
    actions: { checkConfigDocument: async args => ({ length: args.content.length }) },
  })
  const app = express()
  app.use(express.json())
  web.attach(app)
  const server = app.listen(0, "127.0.0.1")
  await once(server, "listening")
  t.after(() => {
    server.closeAllConnections()
    return new Promise(resolve => server.close(resolve))
  })
  const session = web.createSession()
  const content = "a".repeat(256 * 1024)
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}${WEB_PREFIX}/api/config/check`,
    {
      method: "POST",
      headers: { "Content-Type": "text/plain", Authorization: `Bearer ${session.token}` },
      body: content,
    },
  )
  assert.equal(response.status, 200)
  assert.equal((await response.json()).result.length, content.length)
})
