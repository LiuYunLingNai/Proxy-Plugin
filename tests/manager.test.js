import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import net from "node:net"
import http from "node:http"
import YAML from "yaml"
import { ProxyManager, canReloadProfile } from "../lib/manager.js"
import { ConfigStore } from "../lib/config.js"
import { execFile, pause } from "../lib/process.js"
import { tempRoot, fakePlatform } from "./helpers.js"
import { atomicWrite } from "../lib/storage.js"
import { Dashboard } from "../lib/dashboard.js"
import { MihomoClient } from "../lib/client.js"
import { createWebActions } from "../lib/web-actions.js"

async function freePort() {
  const server = net.createServer()
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

async function managerFixture(t, { downloader } = {}) {
  const root = await tempRoot(t)
  const store = new ConfigStore(root)
  const config = await store.load()
  config.core.mixedPort = await freePort()
  do {
    config.core.controllerPort = await freePort()
  } while (config.core.controllerPort === config.core.mixedPort)
  config.core.startupTimeoutSeconds = 3
  await store.save(config)
  const platform = fakePlatform()
  const records = new Map()
  const foreign = []
  const children = new Set()
  let serial = 0
  const processes = {
    async launch(binary, args) {
      const child = spawn(
        process.execPath,
        [fileURLToPath(new URL("./fake-core.mjs", import.meta.url)), ...args],
        { windowsHide: true, stdio: "ignore" },
      )
      children.add(child)
      await new Promise((resolve, reject) => {
        child.once("spawn", resolve)
        child.once("error", reject)
      })
      const identity = { pid: child.pid, executable: process.execPath, birth: String(++serial) }
      records.set(child.pid, identity)
      child.once("exit", () => records.delete(child.pid))
      return identity
    },
    async identity(pid) {
      return records.get(pid) || null
    },
    async list() {
      return [
        ...foreign,
        ...[...records.values()].map(identity => ({ ...identity, name: "mihomo.exe" })),
      ]
    },
    async stop(identity) {
      const child = [...children].find(child => child.pid === identity.pid)
      if (!child || child.exitCode !== null || child.signalCode !== null) return
      const done = new Promise(resolve => child.once("exit", resolve))
      child.kill()
      await done
    },
  }
  t.after(async () => {
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null)
        await processes.stop(records.get(child.pid) || { pid: child.pid })
  })
  const installer = {
    calls: 0,
    async ensure() {
      this.calls++
      return process.execPath
    },
  }
  const manager = new ProxyManager({
    store,
    platform,
    processes,
    installer,
    validator: async (binary, file) => {
      if (YAML.parse(await fs.readFile(file, "utf8")).__invalid) throw new Error("invalid profile")
    },
    downloader,
  })
  await manager.initialize()
  return { manager, platform, store, records, foreign, installer }
}

test("真实子进程与本地 API：重复启动、模式持久化、系统代理切换和停止恢复", async t => {
  const { manager, platform, store } = await managerFixture(t)
  const before = structuredClone(platform.value)
  await manager.start()
  const firstPid = manager.state.identity.pid
  assert.equal((await manager.start()).already, true)
  assert.equal(manager.state.identity.pid, firstPid)
  await manager.setMode("global")
  assert.equal((await store.load()).mode, "global")
  assert.equal(YAML.parse(await fs.readFile(store.paths.runtime, "utf8")).mode, "global")
  await manager.takeover("system")
  assert.equal((await manager.status()).system.owned, true)
  await manager.takeover("off")
  assert.deepEqual(platform.value, before)
  assert.equal((await manager.status()).running, true)
  await manager.stop()
  assert.equal(manager.state, null)
})

test("外部核心使用其他端口时也拒绝新启动，并在下载或修改设置之前返回", async t => {
  const { manager, platform, store, foreign, installer } = await managerFixture(t)
  foreign.push({ pid: 987654, name: "mihomo.exe", executable: "external/mihomo.exe" })
  await assert.rejects(manager.start(), /其他程序运行.*987654/)
  assert.equal(installer.calls, 0)
  assert.equal(platform.writes, 0)
  assert.equal(manager.state, null)
  await assert.rejects(fs.stat(store.paths.runtime), { code: "ENOENT" })
  assert.equal((await manager.status()).otherCores[0].pid, 987654)
})

test("本插件运行期间出现外部核心，重启或切换接管时保留原核心和设置", async t => {
  const { manager, platform, store, foreign } = await managerFixture(t)
  await manager.start()
  const pid = manager.state.identity.pid
  const runtime = await fs.readFile(store.paths.runtime, "utf8")
  foreign.push({ pid: 987655, name: "clash-meta.exe" })
  await assert.rejects(manager.takeover("system"), /其他程序运行/)
  assert.equal(manager.state.identity.pid, pid)
  assert.equal(await fs.readFile(store.paths.runtime, "utf8"), runtime)
  assert.equal(platform.writes, 0)
  assert.equal((await store.load()).takeover, "off")
})

test("未知程序占用代理端口时仍拒绝启动", async t => {
  const { manager, store } = await managerFixture(t)
  const config = await store.load()
  const server = net.createServer()
  await new Promise(resolve => server.listen(config.core.mixedPort, "127.0.0.1", resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  await assert.rejects(manager.start(), /端口.*已被占用/)
  assert.equal(manager.state, null)
})

test("配置校验失败不会停止当前核心或覆盖有效配置", async t => {
  const { manager, store } = await managerFixture(t)
  await manager.start()
  const pid = manager.state.identity.pid
  const runtime = await fs.readFile(store.paths.runtime, "utf8")
  const input = path.join(store.root, "invalid.yaml")
  await fs.writeFile(input, "proxies: []\n__invalid: true\n")
  await assert.rejects(manager.importFile(input), /配置校验失败/)
  assert.equal(manager.state.identity.pid, pid)
  assert.equal(await fs.readFile(store.paths.runtime, "utf8"), runtime)
})

test("配置校验区分超时与退出错误，并返回脱敏后的核心输出", async t => {
  const { manager, store } = await managerFixture(t)
  const config = await store.load()
  config.core.validationTimeoutSeconds = 75
  await store.save(config)
  let seconds
  manager.validator = (_, __, timeout) => {
    seconds = timeout
    return execFile(process.execPath, ["-e", 'console.log("开始下载 GeoSite.dat"); setInterval(() => {}, 1000)'], { timeout: 500 })
  }
  await assert.rejects(manager.check(), /配置校验超时（75 秒）[\s\S]*开始下载 GeoSite\.dat/)
  assert.equal(seconds, 75)
  manager.validator = () => execFile(process.execPath, [
    "-e",
    'console.log("规则无法加载 https://example.com/?token=hidden-secret，vless://hidden-node"); process.exitCode = 1',
  ])
  await assert.rejects(manager.check(), error => {
    assert.match(error.message, /配置校验失败：规则无法加载/)
    assert.doesNotMatch(error.message, /hidden-secret|hidden-node|配置校验超时/)
    return true
  })
})

test("新核心启动失败后重新启动旧配置并恢复系统代理", async t => {
  const { manager, store } = await managerFixture(t)
  await manager.takeover("system")
  const runtime = await fs.readFile(store.paths.runtime, "utf8")
  const input = path.join(store.root, "fails.yaml")
  await fs.writeFile(input, "proxies: []\n__failStart: true\n")
  await assert.rejects(manager.importFile(input), /已恢复上一状态/)
  assert.equal((await manager.status()).running, true)
  assert.equal((await manager.status()).system.owned, true)
  assert.equal(await fs.readFile(store.paths.runtime, "utf8"), runtime)
})

test("TUN 网卡未出现时回滚，目标设置不会误报开启", async t => {
  const { manager, platform, store } = await managerFixture(t)
  await manager.start()
  platform.tun = { interface: false, routes: false }
  await assert.rejects(manager.takeover("tun"), /TUN 网卡或路由未检测到/)
  assert.equal((await store.load()).takeover, "off")
  assert.equal((await manager.status()).running, true)
})

test("PID 被复用时拒绝停止其他进程", async t => {
  const { manager, records } = await managerFixture(t)
  await manager.start()
  const identity = manager.state.identity
  records.set(identity.pid, { ...identity, birth: "reused" })
  await assert.rejects(manager.stop(), /PID 已属于其他进程/)
  records.set(identity.pid, identity)
})

test("订阅持久化配置保持在核心未运行状态，错误订阅不覆盖已有内容", async t => {
  const { manager, store } = await managerFixture(t)
  await atomicWrite(store.paths.profile, "proxies: []\n")
  const server = http.createServer((request, response) => response.end("not yaml"))
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  t.after(() => {
    server.closeAllConnections()
    return new Promise(resolve => server.close(resolve))
  })
  await assert.rejects(
    manager.updateSubscription(`http://127.0.0.1:${server.address().port}/subscription`),
  )
  assert.equal(await fs.readFile(store.paths.profile, "utf8"), "proxies: []\n")
  assert.equal(manager.state, null)
})

test("核心异常退出后重启，连续启动失败时有重试上限", async t => {
  const { manager, store } = await managerFixture(t)
  await manager.start()
  await manager.processes.stop(manager.state.identity)
  await manager.queue.run(() => manager.tick())
  assert.equal((await manager.status()).running, true)
  await atomicWrite(store.paths.local, "proxies: []\n__failStart: true\n")
  await manager.processes.stop(manager.state.identity)
  manager.lastCheck = 0
  await manager.queue.run(() => manager.tick())
  assert.equal(manager.state, null)
  assert.equal(manager.failedRestarts, 2)
  assert.match(manager.lastError, /停止重试/)
})

function subscriptionProfiles() {
  const versions = new Map(),
    failures = new Set(),
    requests = []
  const downloader = async url => {
    requests.push(url)
    if (failures.has(url)) throw new Error("download failed https://secret.example/?token=private")
    const name = new URL(url).hostname.split(".")[0]
    const version = versions.get(url) || 1
    return YAML.stringify({
      proxies: [
        {
          name: `${name}-${version}`,
          type: "ss",
          server: "example.com",
          port: 443,
          cipher: "aes-128-gcm",
          password: "test",
        },
      ],
      "proxy-groups": [{ name, type: "select", proxies: [`${name}-${version}`] }],
      rules: [`MATCH,${name}`],
      ...(version === -1 ? { __failStart: true } : {}),
    })
  }
  return { downloader, versions, failures, requests }
}

test("保存多条订阅、离线切换并在启动时使用所选缓存", async t => {
  const profiles = subscriptionProfiles()
  const { manager, store } = await managerFixture(t, profiles)
  await manager.addSubscription("https://a.example/yaml", "机场 A")
  await manager.addSubscription("https://b.example/yaml", "机场 B")
  assert.deepEqual(
    (await manager.listSubscriptions()).map(item => [item.name, item.active]),
    [
      ["机场 A", true],
      ["机场 B", false],
    ],
  )
  const b = (await store.load()).subscription.items[1]
  const time = (await manager.subscriptions.metadata(b)).updatedAt
  await manager.selectSubscription("2")
  assert.equal(manager.state, null)
  assert.equal((await manager.subscriptions.metadata(b)).updatedAt, time)
  await manager.start()
  assert.equal(profiles.requests.length, 2)
  assert.deepEqual(YAML.parse(await fs.readFile(store.paths.runtime, "utf8")).rules, ["MATCH,b"])
  assert.equal((await manager.listSubscriptions())[1].applied, true)
})

test("本地规则、配置与订阅读取不等待管理队列、不探测核心，文件更新后刷新解析缓存", async t => {
  const profiles = subscriptionProfiles()
  const { manager, store } = await managerFixture(t, profiles)
  await manager.addSubscription("https://a.example/yaml", "A")
  const actions = createWebActions(() => manager)
  let release
  let entered
  const started = new Promise(resolve => { entered = resolve })
  const gate = new Promise(resolve => { release = resolve })
  const blocked = manager.queue.run(async () => {
    entered()
    await gate
  })
  t.after(() => release())
  await started
  const identity = manager.processes.identity
  manager.state = { identity: { pid: 123 }, config: await store.load() }
  manager.processes.identity = async () => { throw new Error("本地读取不应探测核心") }
  let timer
  try {
    const reads = Promise.all([
      actions.rules({ local: true }),
      actions.configDocument({ local: true }),
      actions.coreOptions({ local: true }),
      actions.subscriptions({ local: true }),
    ])
    const [rules, document, options, subscriptions] = await Promise.race([
      reads,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("本地读取被管理队列阻塞")), 2000) }),
    ])
    assert.deepEqual(rules.rules, ["MATCH,a"])
    assert.match(document.source, /A.*已保存/)
    assert.equal(YAML.parse(document.content).proxies[0].name, "a-1")
    assert.equal(options.options["log-level"], "info")
    assert.equal(subscriptions[0].name, "A")
    assert.equal(subscriptions[0].cached, true)
    assert.equal(subscriptions[0].url, undefined)
    assert.equal(subscriptions[0].applied, false)
    const first = await manager.savedProfile()
    assert.equal((await manager.savedProfile()).profile, first.profile)
    const entry = (await store.load()).subscription.items[0]
    const profile = YAML.parse(document.content)
    profile.rules = ["DOMAIN,edited.example,DIRECT", "MATCH,a"]
    await manager.subscriptions.save(entry, YAML.stringify(profile))
    assert.deepEqual((await actions.rules({ local: true })).rules, profile.rules)
    assert.notEqual((await manager.savedProfile()).profile, first.profile)
    const config = await store.load()
    config.runtime.ipv6 = true
    await store.save(config)
    assert.equal((await actions.coreOptions({ local: true })).options.ipv6, true)
  } finally {
    clearTimeout(timer)
    manager.state = null
    manager.processes.identity = identity
    release()
    await blocked
  }
})

test("添加和更新备用订阅不重启核心或替换当前规则", async t => {
  const profiles = subscriptionProfiles()
  const { manager, store } = await managerFixture(t, profiles)
  await manager.addSubscription("https://a.example/yaml", "A")
  await manager.start()
  const pid = manager.state.identity.pid
  const source = await fs.readFile(store.paths.runtime, "utf8")
  await manager.addSubscription("https://b.example/yaml", "B")
  profiles.versions.set("https://b.example/yaml", 2)
  await manager.updateSubscription("B")
  assert.equal(manager.state.identity.pid, pid)
  assert.equal(await fs.readFile(store.paths.runtime, "utf8"), source)
  const b = (await store.load()).subscription.items[1]
  assert.equal(YAML.parse(await manager.subscriptions.cached(b)).proxies[0].name, "b-2")
})

test("切换运行参数相同的缓存订阅使用热重载，保留进程与系统代理", async t => {
  const profiles = subscriptionProfiles()
  const { manager, store, platform } = await managerFixture(t, profiles)
  await manager.addSubscription("https://a.example/yaml", "A")
  await manager.addSubscription("https://b.example/yaml", "B")
  await manager.takeover("system")
  const pid = manager.state.identity.pid
  const writes = platform.writes
  const result = await manager.selectSubscription("B")
  assert.equal(result.reloaded, true)
  assert.equal(manager.state.identity.pid, pid)
  assert.equal(platform.writes, writes)
  assert.equal(profiles.requests.length, 2)
  assert.deepEqual((await (await manager.client()).configs()).rules, ["MATCH,b"])
  assert.equal((await store.load()).subscription.items[1].active, true)
  assert.equal((await manager.selectSubscription("B")).already, true)
})

test("热重载失败恢复原配置与订阅选择，保持原进程", async t => {
  const profiles = subscriptionProfiles()
  const { manager, store } = await managerFixture(t, profiles)
  await manager.addSubscription("https://a.example/yaml", "A")
  await manager.addSubscription("https://b.example/yaml", "B")
  const config = await store.load()
  await manager.start()
  const pid = manager.state.identity.pid
  manager.clientFactory = (port, secret) => {
    const client = new MihomoClient(port, secret)
    const reload = client.reload.bind(client)
    client.reload = async file => {
      if (file.endsWith("candidate.yaml")) throw new Error("模拟重载拒绝")
      return reload(file)
    }
    return client
  }
  await assert.rejects(manager.selectSubscription("B"), /已恢复上一状态/)
  assert.equal(manager.state.identity.pid, pid)
  assert.equal(
    (await store.load()).subscription.items[0].active,
    config.subscription.items[0].active,
  )
  assert.deepEqual((await (await manager.client()).configs()).rules, ["MATCH,a"])
})

test("热重载只允许代理与规则变化，DNS/TUN 等变化使用重启", () => {
  const old = YAML.stringify({ dns: { enable: true }, tun: { enable: true }, rules: ["MATCH,a"] })
  assert.equal(
    canReloadProfile(
      old,
      YAML.stringify({
        dns: { enable: true },
        tun: { enable: true },
        rules: ["MATCH,b"],
        proxies: [],
      }),
    ),
    true,
  )
  assert.equal(
    canReloadProfile(
      old,
      YAML.stringify({ dns: { enable: false }, tun: { enable: true }, rules: ["MATCH,b"] }),
    ),
    false,
  )
})

test("热重载已应用但设置落盘失败时恢复旧运行配置", async t => {
  const profiles = subscriptionProfiles()
  const { manager, store } = await managerFixture(t, profiles)
  await manager.addSubscription("https://a.example/yaml", "A")
  await manager.addSubscription("https://b.example/yaml", "B")
  await manager.start()
  const pid = manager.state.identity.pid
  const originalSave = store.save.bind(store)
  let failOnce = true
  store.save = async config => {
    if (failOnce && config.subscription.items[1].active) {
      failOnce = false
      throw new Error("模拟写入失败")
    }
    await originalSave(config)
  }
  await assert.rejects(manager.selectSubscription("B"), /已恢复上一状态/)
  assert.equal(manager.state.identity.pid, pid)
  assert.deepEqual((await (await manager.client()).configs()).rules, ["MATCH,a"])
  assert.equal((await store.load()).subscription.items[0].active, true)
})

test("切换失败恢复原核心和选择，同时保留所有已添加订阅", async t => {
  const profiles = subscriptionProfiles()
  const { manager, store } = await managerFixture(t, profiles)
  await manager.addSubscription("https://a.example/yaml", "A")
  await manager.start()
  profiles.versions.set("https://b.example/yaml", -1)
  await manager.addSubscription("https://b.example/yaml", "B")
  const source = await fs.readFile(store.paths.runtime, "utf8")
  await assert.rejects(manager.selectSubscription("B"), /已恢复上一状态/)
  assert.deepEqual(
    (await store.load()).subscription.items.map(item => [item.name, item.active]),
    [
      ["A", true],
      ["B", false],
    ],
  )
  assert.equal(await fs.readFile(store.paths.runtime, "utf8"), source)
  assert.equal((await manager.status()).running, true)
})

test("更新全部时单条失败不影响其他订阅，失败项保留旧缓存", async t => {
  const profiles = subscriptionProfiles()
  const { manager, store } = await managerFixture(t, profiles)
  await manager.addSubscription("https://a.example/yaml", "A")
  await manager.addSubscription("https://b.example/yaml", "B")
  const a = (await store.load()).subscription.items[0]
  const previous = await manager.subscriptions.cached(a)
  profiles.failures.add("https://a.example/yaml")
  profiles.versions.set("https://b.example/yaml", 2)
  const results = await manager.updateAllSubscriptions()
  assert.deepEqual(
    results.map(item => item.ok),
    [false, true],
  )
  assert.ok(!results[0].error.includes("private"))
  assert.equal(await manager.subscriptions.cached(a), previous)
  assert.equal((await store.load()).subscription.items.length, 2)
})

test("改名保留缓存，重复名称被拒绝，运行中的当前订阅不能误删", async t => {
  const profiles = subscriptionProfiles()
  const { manager, store } = await managerFixture(t, profiles)
  await manager.addSubscription("https://a.example/yaml", "A")
  await manager.addSubscription("https://b.example/yaml", "B")
  const a = (await store.load()).subscription.items[0]
  const previous = await manager.subscriptions.cached(a)
  await manager.renameSubscription("A", "备用 A")
  assert.equal(await manager.subscriptions.cached(a), previous)
  await assert.rejects(manager.renameSubscription("B", "备用 A"), /不能重复/)
  await manager.start()
  await assert.rejects(manager.removeSubscription("备用 A"), /正在使用/)
  await manager.selectSubscription("B")
  await manager.removeSubscription("备用 A")
  assert.deepEqual(
    (await manager.listSubscriptions()).map(item => item.name),
    ["B"],
  )
})

test("订阅编辑支持地址与独立 UA，备用项保留运行状态，失败不改设置或缓存", async t => {
  const profiles = subscriptionProfiles()
  const requests = []
  const { manager, store, platform } = await managerFixture(t, {
    downloader: async (url, userAgent) => {
      requests.push({ url, userAgent })
      return profiles.downloader(url)
    },
  })
  const actions = createWebActions(() => manager)
  await manager.addSubscription("https://a.example/yaml", "A")
  await manager.addSubscription("https://b.example/yaml", "B")
  await manager.start()
  const pid = manager.state.identity.pid
  const writes = platform.writes
  const original = (await store.load()).subscription.items[1]
  const detail = await actions.subscriptionSettings({ key: original.id })
  assert.equal(detail.url, original.url)
  assert.equal(detail.defaults.userAgent, "clash.meta")
  assert.equal((await manager.listSubscriptions())[1].url, undefined)
  const beforeMetadata = await manager.subscriptions.metadata(original)
  await actions.subscriptionEdit({ key: original.id, name: "备用 B", autoUpdateHours: 0.5 })
  assert.equal(requests.length, 2)
  assert.deepEqual(await manager.subscriptions.metadata(original), beforeMetadata)
  assert.equal(manager.state.identity.pid, pid)
  await actions.subscriptionEdit({ key: original.id, url: "https://c.example/yaml", userAgent: "mihomo/custom" })
  const edited = (await store.load()).subscription.items[1]
  assert.equal(edited.id, original.id)
  assert.equal(edited.name, "备用 B")
  assert.equal(edited.autoUpdateHours, 0.5)
  assert.equal(YAML.parse(await manager.subscriptions.cached(edited)).proxies[0].name, "c-1")
  assert.equal(await manager.subscriptions.cached(original), null)
  assert.deepEqual(requests.at(-1), { url: edited.url, userAgent: "mihomo/custom" })
  assert.equal(manager.state.identity.pid, pid)
  assert.equal(platform.writes, writes)
  const saved = await store.load()
  const cache = await manager.subscriptions.snapshot(edited)
  await assert.rejects(actions.subscriptionEdit({ key: original.id, url: "https://a.example/yaml" }), /不能重复/)
  profiles.failures.add("https://failure.example/yaml")
  await assert.rejects(actions.subscriptionEdit({ key: original.id, name: "下载失败", url: "https://failure.example/yaml" }), /download failed/)
  const downloader = manager.downloader
  manager.downloader = async () => "proxies: []\n__invalid: true"
  await assert.rejects(actions.subscriptionEdit({ key: original.id, url: "https://invalid.example/yaml" }), /invalid profile/)
  manager.downloader = downloader
  assert.deepEqual(await store.load(), saved)
  assert.deepEqual(await manager.subscriptions.snapshot(edited), cache)
  assert.equal(manager.state.identity.pid, pid)
  await manager.selectSubscription(original.id)
  const selected = await actions.subscriptionEdit({ key: original.id, url: "https://d.example/yaml" })
  assert.equal(selected.applied, true)
  assert.equal(selected.reloaded, true)
  assert.equal(manager.state.identity.pid, pid)
  assert.deepEqual((await (await manager.client()).configs()).rules, ["MATCH,d"])
  await manager.addSubscription("https://b.example/yaml", "新 B")
  assert.equal((await store.load()).subscription.items.length, 3)
  assert.notEqual((await store.load()).subscription.items[2].id, original.id)
  await actions.subscriptionEdit({ key: original.id, userAgent: null, autoUpdateHours: null })
  assert.equal(requests.at(-1).userAgent, "clash.meta")
  assert.equal((await store.load()).subscription.items[1].autoUpdateHours, undefined)
})

test("全局更新关闭时独立周期仍生效，独立 0 可关闭继承，定时与批量更新使用独立 UA", async t => {
  const profiles = subscriptionProfiles()
  const agents = []
  const { manager, store } = await managerFixture(t, {
    downloader: async (url, userAgent) => {
      agents.push(userAgent)
      return profiles.downloader(url)
    },
  })
  await manager.addSubscription("https://a.example/yaml", "A")
  await manager.addSubscription("https://b.example/yaml", "B")
  await manager.editSubscription("A", { autoUpdateHours: 0 })
  await manager.editSubscription("B", { autoUpdateHours: 0.5, userAgent: "mihomo/timer" })
  const index = JSON.parse(await fs.readFile(manager.subscriptions.index, "utf8"))
  for (const metadata of Object.values(index)) metadata.updatedAt = Date.now() - 3600e3
  await atomicWrite(manager.subscriptions.index, JSON.stringify(index))
  const before = profiles.requests.length
  await manager.queue.run(() => manager.tick())
  assert.equal(profiles.requests.length, before + 1)
  assert.equal(profiles.requests.at(-1), "https://b.example/yaml")
  assert.equal(agents.at(-1), "mihomo/timer")
  const config = await store.load()
  config.subscription.autoUpdateHours = 0.5
  await store.save(config)
  manager.lastCheck = 0
  await manager.queue.run(() => manager.tick())
  assert.equal(profiles.requests.length, before + 1)
  await manager.updateAllSubscriptions()
  assert.deepEqual(agents.slice(-2), ["clash.meta", "mihomo/timer"])
})

test("本地配置与订阅独立保存，删除最后订阅后不重新使用已删除节点", async t => {
  const profiles = subscriptionProfiles()
  const { manager, store } = await managerFixture(t, profiles)
  await manager.addSubscription("https://a.example/yaml", "A")
  const local = path.join(store.root, "local.yaml")
  await fs.writeFile(local, "proxies: []\nproxy-groups: []\nrules: ['MATCH,DIRECT']\n")
  await manager.importFile(local)
  assert.equal((await store.load()).subscription.items[0].active, false)
  await manager.selectSubscription("A")
  assert.ok(await fs.stat(store.paths.local))
  await manager.stop()
  await manager.removeSubscription("A")
  await manager.start()
  assert.equal((await store.load()).subscription.items.length, 0)
  assert.deepEqual(YAML.parse(await fs.readFile(store.paths.runtime, "utf8")).proxies, [])
})

test("定时更新每次刷新一条，备用订阅刷新不改当前核心", async t => {
  const profiles = subscriptionProfiles()
  const { manager, store } = await managerFixture(t, profiles)
  await manager.addSubscription("https://a.example/yaml", "A")
  await manager.addSubscription("https://b.example/yaml", "B")
  await manager.start()
  const config = await store.load()
  config.subscription.autoUpdateHours = 1
  await store.save(config)
  const index = JSON.parse(await fs.readFile(manager.subscriptions.index, "utf8"))
  for (const metadata of Object.values(index)) metadata.updatedAt = Date.now() - 2 * 3600e3
  await atomicWrite(manager.subscriptions.index, JSON.stringify(index))
  profiles.versions.set("https://a.example/yaml", 2)
  profiles.versions.set("https://b.example/yaml", 2)
  await manager.queue.run(() => manager.tick())
  const pid = manager.state.identity.pid
  manager.lastCheck = 0
  await manager.queue.run(() => manager.tick())
  assert.equal(manager.state.identity.pid, pid)
  assert.equal(profiles.requests.length, 4)
  assert.equal(YAML.parse(await fs.readFile(store.paths.runtime, "utf8")).proxies[0].name, "a-2")
})

test("修改订阅 URL 后不会继续复用旧地址缓存", async t => {
  const profiles = subscriptionProfiles()
  const { manager, store } = await managerFixture(t, profiles)
  await manager.addSubscription("https://a.example/yaml", "A")
  const config = await store.load()
  config.subscription.items[0].url = "https://b.example/yaml"
  await manager.queue.run(() => manager.saveSettings(config))
  await manager.start()
  assert.equal(profiles.requests.at(-1), "https://b.example/yaml")
  assert.equal(YAML.parse(await fs.readFile(store.paths.runtime, "utf8")).proxies[0].name, "b-1")
})

test("连接接口返回必要字段并能断开，核心停止时返回空状态", async t => {
  const { manager } = await managerFixture(t)
  assert.equal((await manager.connections()).running, false)
  await manager.start()
  const data = await manager.connections()
  assert.equal(data.running, true)
  assert.equal(data.connections[0].metadata.host, "example.com")
  assert.equal(data.connections[0].metadata.uid, undefined)
  assert.equal(data.connections[0].metadata.processPath, undefined)
  assert.equal((await manager.closeConnection("connection-test")).closed, true)
  assert.equal((await manager.closeAllConnections()).closed, true)
})

test("节点切换只读取目标组并提交选择，不读取完整快照或再次探活", async t => {
  const { manager } = await managerFixture(t)
  await manager.start()
  const calls = []
  manager.clientFactory = (port, secret) => {
    const client = new MihomoClient(port, secret)
    const request = client.request.bind(client)
    client.request = async (route, options) => {
      calls.push([route, options?.method || "GET"])
      return request(route, options)
    }
    return client
  }
  assert.equal(await manager.select("Test", "B"), "B")
  assert.deepEqual(calls, [
    ["/proxies/Test", "GET"],
    ["/proxies/Test", "PUT"],
  ])
  calls.length = 0
  assert.equal(await manager.select("Test", "B"), "B")
  assert.deepEqual(calls, [["/proxies/Test", "GET"]])
  await assert.rejects(manager.select("Test", "missing"), /没有匹配节点/)
  assert.equal((await (await manager.client()).proxy("Test")).now, "B")
})

test("测速报告包含组内选择，普通测速接口仍返回节点数组", async t => {
  const { manager } = await managerFixture(t)
  await manager.start()
  await manager.select("Test", "B")
  const report = await manager.speed("Test", { includeCurrent: true })
  assert.equal(report.current, "B")
  assert.deepEqual(report.results.map(item => item.name).sort(), ["A", "B", "ProviderNode"])
  assert.ok(report.results.every(item => item.delay === 25))
  assert.ok(Array.isArray(await manager.speed("Test")))
  assert.equal((await manager.nodes("Test")).now, "B")
})

test("编辑运行订阅规则保留缓存与定时更新记录，校验失败不覆盖配置", async t => {
  const profiles = subscriptionProfiles()
  const { manager, store } = await managerFixture(t, profiles)
  await manager.addSubscription("https://a.example/yaml", "A")
  const entry = (await store.load()).subscription.items[0]
  const updatedAt = (await manager.subscriptions.metadata(entry)).updatedAt
  await manager.start()
  await manager.saveRules(["DOMAIN-SUFFIX,example.com,DIRECT", "MATCH,a"])
  assert.deepEqual((await manager.rules()).rules, ["DOMAIN-SUFFIX,example.com,DIRECT", "MATCH,a"])
  assert.equal((await manager.subscriptions.metadata(entry)).updatedAt, updatedAt)
  await assert.rejects(manager.saveRules(["MATCH,a\nwrong"]), /规则应为/)
  assert.deepEqual((await manager.rules()).rules, ["DOMAIN-SUFFIX,example.com,DIRECT", "MATCH,a"])
  await manager.stop()
  await manager.start()
  assert.deepEqual(YAML.parse(await fs.readFile(store.paths.runtime, "utf8")).rules, [
    "DOMAIN-SUFFIX,example.com,DIRECT",
    "MATCH,a",
  ])
})

test("本地规则离线保存并在启动时应用，日志只返回有限脱敏内容", async t => {
  const { manager, store } = await managerFixture(t)
  await atomicWrite(store.paths.local, "proxies: []\nrules: ['MATCH,DIRECT']\n")
  await manager.saveRules(["DOMAIN,example.com,DIRECT", "MATCH,DIRECT"])
  assert.equal(manager.state, null)
  assert.deepEqual((await manager.rules()).rules, ["DOMAIN,example.com,DIRECT", "MATCH,DIRECT"])
  await atomicWrite(
    store.paths.log,
    "time=now level=info url=https://private.example/?token=secret\npassword=hidden\n",
  )
  await atomicWrite(store.paths.log + ".stderr", "permission denied\n")
  const logs = await manager.logs()
  assert.equal(logs.files.length, 2)
  assert.equal(JSON.stringify(logs).includes("private.example"), false)
  assert.equal(JSON.stringify(logs).includes("hidden"), false)
})

test("官方核心面板接口支持提供者节点、组测速、规则启停与 DNS 工具", async t => {
  const { manager } = await managerFixture(t)
  await manager.start()
  const service = new Dashboard(manager)
  const snapshot = await service.proxies()
  assert.equal(snapshot.proxies.ProviderNode.provider, "airport")
  assert.equal(JSON.stringify(snapshot).includes("private"), false)
  assert.equal((await service.delay({ name: "ProviderNode", timeout: 5000 })).delay, 42)
  assert.equal((await service.groupDelay({ group: "Test" })).ProviderNode, 42)
  assert.equal((await service.resetGroup("Auto")).reset, true)
  await assert.rejects(service.resetGroup("Test"), /不支持/)
  assert.equal((await service.providers("rules")).providers[0].ruleCount, 12)
  assert.equal((await service.updateProvider("proxies", "airport")).updated, true)
  assert.equal((await service.updateProvider("proxies", "airport", true)).updated, true)
  assert.equal((await service.disableRule(0, true)).disabled, true)
  await assert.rejects(service.disableRule(99, true), /不支持/)
  assert.equal((await service.dns({ name: "example.com", type: "A" })).Answer[0].data, "1.2.3.4")
  assert.equal((await service.flush("dns")).flushed, true)
  assert.equal((await service.flush("fakeip")).flushed, true)
})

test("完整 YAML 编辑和核心选项持久化，校验失败保留原运行配置", async t => {
  const { manager, store } = await managerFixture(t)
  await manager.start()
  const service = new Dashboard(manager)
  await service.saveConfigDocument("proxies: []\nrules: ['MATCH,DIRECT']\n")
  const before = (await service.configDocument()).content
  await assert.rejects(service.saveConfigDocument("proxies: []\n__invalid: true\n"), /配置校验失败/)
  assert.equal((await service.configDocument()).content, before)
  await service.saveCoreOptions({
    ipv6: true,
    sniffing: true,
    "tcp-concurrent": true,
    "log-level": "debug",
  })
  const runtime = YAML.parse(await fs.readFile(store.paths.runtime, "utf8"))
  assert.equal(runtime.ipv6, true)
  assert.equal(runtime.sniffer.enable, true)
  assert.equal(runtime["log-level"], "debug")
  assert.equal((await store.load()).runtime.ipv6, true)
  await assert.rejects(service.saveCoreOptions({ "external-controller": "0.0.0.0:9090" }), /无效/)
})

test("核心版本切换下载失败或校验失败时保留现有配置", async t => {
  const { manager, store } = await managerFixture(t)
  await manager.start()
  const original = await store.load()
  class FailedInstaller {
    async ensure() {
      throw new Error("下载失败")
    }
  }
  await assert.rejects(
    new Dashboard(manager, { InstallerClass: FailedInstaller }).switchVersion("v1.2.3"),
    /下载失败/,
  )
  assert.deepEqual(await store.load(), original)
  const input = "proxies: []\n__invalid: true\n"
  await atomicWrite(store.paths.local, input)
  class TestInstaller {
    async ensure() {
      return process.execPath
    }
  }
  await assert.rejects(
    new Dashboard(manager, { InstallerClass: TestInstaller }).switchVersion("v1.2.3"),
    /配置校验失败/,
  )
  assert.deepEqual(await store.load(), original)
  assert.equal(await manager.alive(), true)
})

test("联动更新先还原系统代理并停止核心，完成后恢复原运行状态", async t => {
  const { manager, store, platform } = await managerFixture(t)
  await manager.takeover("system")
  const runningPid = manager.state.identity.pid
  const stages = []
  manager.installer.latest = async config => {
    assert.equal(await manager.alive(), false)
    assert.equal(platform.value.server, "previous:8080")
    stages.push("mihomo")
    return { ...config.core, path: process.execPath, version: "v1.99.0" }
  }
  const update = async () => {
    assert.equal(await manager.alive(), false)
    assert.equal(platform.value.server, "previous:8080")
    stages.push("plugin")
  }
  assert.deepEqual(await manager.updateTogether(update), { running: true, version: "v1.99.0" })
  assert.deepEqual(stages, ["plugin", "mihomo"])
  assert.notEqual(manager.state.identity.pid, runningPid)
  assert.equal((await manager.status()).system.owned, true)
  assert.equal((await store.load()).core.version, "v1.99.0")

  await manager.stop()
  assert.deepEqual(await manager.updateTogether(update), { running: false, version: "v1.99.0" })
  assert.equal(await manager.alive(), false)
  assert.equal(platform.value.server, "previous:8080")
})

test("联动更新失败会恢复更新前实际运行配置，并保留尚未应用的设置", async t => {
  const { manager, store, platform } = await managerFixture(t)
  await manager.takeover("system")
  const runningPid = manager.state.identity.pid
  const pending = await store.load()
  pending.mode = "global"
  pending.takeover = "off"
  await store.save(pending)
  manager.installer.latest = async () => { throw new Error("模拟核心下载失败") }
  await assert.rejects(manager.updateTogether(async () => {}), /模拟核心下载失败.*已恢复更新前的 mihomo/)
  assert.equal(await manager.alive(), true)
  assert.notEqual(manager.state.identity.pid, runningPid)
  assert.equal(manager.state.config.takeover, "system")
  assert.equal((await (await manager.client()).configs()).mode, "rule")
  assert.equal(platform.value.server, `127.0.0.1:${pending.core.mixedPort}`)
  assert.deepEqual(await store.load(), pending)
})

test("版本切换使用独立目录，成功后更新核心路径和版本", async t => {
  const { manager, store } = await managerFixture(t)
  await manager.start()
  let destination
  class TestInstaller {
    constructor(store) {
      destination = store.data
    }
    async ensure() {
      return process.execPath
    }
  }
  await new Dashboard(manager, { InstallerClass: TestInstaller }).switchVersion("v1.2.3")
  assert.ok(destination.includes("versions"))
  assert.equal((await store.load()).core.version, "v1.2.3")
  assert.equal((await store.load()).core.path, process.execPath)
  assert.equal(await manager.alive(), true)
})

test("订阅响应用量保存到独立缓存并出现在列表中", async t => {
  const usage = { upload: 100, download: 200, total: 3000, expire: 1800000000 }
  let providesUsage = true
  const { manager } = await managerFixture(t, {
    downloader: async (url, agent, onUsage) => {
      if (providesUsage && url.endsWith("/sub")) onUsage(usage)
      return "proxies: []\nrules: ['MATCH,DIRECT']\n"
    },
  })
  await manager.addSubscription("https://example.com/sub", "流量订阅")
  await manager.addSubscription("https://example.com/other", "独立订阅")
  assert.deepEqual((await manager.listSubscriptions({ local: true })).map(entry => entry.usage), [usage, undefined])
  await manager.start()
  assert.deepEqual((await manager.listSubscriptions())[0].usage, usage)
  providesUsage = false
  await manager.updateSubscription("流量订阅")
  assert.equal((await manager.listSubscriptions())[0].usage, undefined)
})
