import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import fs from "node:fs/promises"
import { SystemProxy } from "../platforms/system.js"
import { defaults } from "../lib/config.js"
import { tempRoot, fakePlatform } from "./helpers.js"

test("接管前保存 PAC 和代理设置，重复启用后仍恢复最初值", async t => {
  const root = await tempRoot(t)
  const before = {
    flags: 13,
    server: "old:8080",
    bypass: "local",
    pac: "https://example.com/proxy.pac",
  }
  const platform = fakePlatform(before)
  const proxy = new SystemProxy(path.join(root, "proxy.json"), platform)
  const config = structuredClone(defaults)
  await proxy.enable(config)
  config.core.mixedPort++
  await proxy.enable(config)
  await proxy.restore(config)
  assert.deepEqual(platform.value, before)
})

test("第三方只修改代理地址时，也不能恢复开关或其他字段", async t => {
  const root = await tempRoot(t)
  const platform = fakePlatform()
  const proxy = new SystemProxy(path.join(root, "proxy.json"), platform)
  await proxy.enable(defaults)
  platform.value.server = "another-client:7890"
  const current = structuredClone(platform.value)
  const writes = platform.writes
  const result = await proxy.restore(defaults)
  assert.deepEqual(result.conflicts, ["server"])
  assert.deepEqual(platform.value, current)
  assert.equal(platform.writes, writes)
  await assert.rejects(proxy.enable(defaults), /已被其他程序修改/)
  assert.ok(await fs.stat(path.join(root, "proxy.json")))
})

test("部分写入失败时使用预先持久化记录撤销本次写入", async t => {
  const root = await tempRoot(t)
  const platform = fakePlatform()
  const before = structuredClone(platform.value)
  const proxy = new SystemProxy(path.join(root, "proxy.json"), platform)
  platform.failWrite = true
  await assert.rejects(proxy.enable(defaults), /已撤销本次写入/)
  assert.deepEqual(platform.value, before)
  await assert.rejects(fs.stat(path.join(root, "proxy.json")), { code: "ENOENT" })
})
