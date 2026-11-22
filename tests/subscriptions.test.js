import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { ConfigStore, defaults, validateConfig } from "../lib/config.js"
import { getManager } from "../lib/manager.js"
import { supportGuoba } from "../guoba.support.js"
import { tempRoot } from "./helpers.js"

test("旧版单 URL 不自动迁移到多订阅列表", async t => {
  const store = new ConfigStore(await tempRoot(t))
  await fs.mkdir(path.dirname(store.file), { recursive: true })
  await fs.writeFile(
    store.file,
    "subscription:\n  url: https://example.com/yaml?token=private\n  autoUpdateHours: 6\n",
  )
  const config = await store.load()
  assert.deepEqual(config.subscription.items, [])
  assert.equal(config.subscription.autoUpdateHours, 6)
  assert.equal(config.subscription.url, undefined)
  await store.save(config)
  const second = await store.load()
  assert.deepEqual(second.subscription.items, [])
  assert.equal(second.subscription.url, undefined)
})

test("重复地址和同时启用多条配置被拒绝", () => {
  const config = structuredClone(defaults)
  config.subscription.items = [
    { name: "A", url: "https://a.example/yaml", active: true },
    { name: "B", url: "https://b.example/yaml", active: true },
  ]
  assert.throws(() => validateConfig(config), /一次只能启用/)
  config.subscription.items[1].active = false
  config.subscription.items[1].url = config.subscription.items[0].url
  assert.throws(() => validateConfig(config), /不能重复/)
})

test("独立订阅请求和更新配置保存、继承及参数校验", async t => {
  const store = new ConfigStore(await tempRoot(t))
  const config = await store.load()
  config.subscription.items = [{ name: "A", url: "https://a.example/yaml", userAgent: "mihomo/test", autoUpdateHours: 0.5 }]
  await store.save(config)
  const item = (await store.load()).subscription.items[0]
  assert.equal(item.userAgent, "mihomo/test")
  assert.equal(item.autoUpdateHours, 0.5)
  for (const invalid of [{ userAgent: "bad\r\nheader" }, { userAgent: 12 }, { autoUpdateHours: -1 }, { autoUpdateHours: "1" }, { autoUpdateHours: 8761 }]) {
    const candidate = structuredClone(config)
    Object.assign(candidate.subscription.items[0], invalid)
    assert.throws(() => validateConfig(candidate), /User-Agent|更新周期/)
  }
  config.subscription.items[0].userAgent = null
  config.subscription.items[0].autoUpdateHours = null
  await store.save(config)
  assert.equal((await store.load()).subscription.items[0].userAgent, undefined)
  assert.equal((await store.load()).subscription.items[0].autoUpdateHours, undefined)
})

test("锅巴以可新增的列表保存多订阅，第一次保存默认启用第一条", async t => {
  const previous = globalThis.__proxyPluginManagerV1
  const manager = getManager()
  const originalStore = manager.store
  const store = new ConfigStore(await tempRoot(t))
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
  const schema = support.configInfo.schemas.find(item => item.field === "subscription.items")
  assert.equal(schema.component, "GSubForm")
  assert.equal(schema.componentProps.multiple, true)
  const result = await support.configInfo.setConfigData(
    {
      "subscription.items": [
        { name: "A", url: "https://a.example/yaml", active: false },
        { name: "B", url: "https://b.example/yaml", active: false },
      ],
    },
    { Result },
  )
  assert.equal(result.ok, true)
  const config = await store.load()
  assert.equal(config.subscription.items.length, 2)
  assert.equal(config.subscription.items[0].active, true)
  const invalid = await support.configInfo.setConfigData(
    { "subscription.items": config.subscription.items.map(item => ({ ...item, active: true })) },
    { Result },
  )
  assert.equal(invalid.ok, false)
  assert.deepEqual((await store.load()).subscription.items, config.subscription.items)
})

test("Web UI 状态 action 不暴露订阅地址，也不修改运行时配置", async t => {
  const previous = globalThis.__proxyPluginManagerV1
  const liveStatus = {
    config: {
      subscription: {
        items: [{ id: "a", name: "A", active: true, url: "https://example.com/?token=secret" }],
      },
    },
    appliedConfig: {
      subscription: {
        items: [{ id: "a", name: "A", active: true, url: "https://example.com/?token=secret" }],
      },
    },
  }
  const manager = {
    async initialize() {},
    async status() {
      return liveStatus
    },
  }
  globalThis.__proxyPluginManagerV1 = manager
  t.after(() => {
    globalThis.__proxyPluginManagerV1 = previous
  })
  const response = await supportGuoba().configInfo.actions.status()
  assert.equal(response.config.subscription.items[0].url, undefined)
  assert.equal(JSON.stringify(response).includes("token=secret"), false)
  assert.equal(liveStatus.config.subscription.items[0].url, "https://example.com/?token=secret")
})
