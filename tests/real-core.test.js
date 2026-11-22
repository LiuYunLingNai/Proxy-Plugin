import test from "node:test"
import assert from "node:assert/strict"
import net from "node:net"
import { ProxyManager } from "../lib/manager.js"
import { ConfigStore } from "../lib/config.js"
import { tempRoot } from "./helpers.js"
import path from "node:path"
import fs from "node:fs/promises"
import { fileURLToPath } from "node:url"
import YAML from "yaml"
import { buildProfile } from "../lib/profile.js"
import { atomicWrite } from "../lib/storage.js"
import { powershell, processIdentity, launchCore, terminateCore } from "../lib/process.js"
import { Dashboard } from "../lib/dashboard.js"

async function freePort() {
  const server = net.createServer()
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

test(
  "真实 mihomo：配置校验、本机端口启动、API 和进程停止（不修改系统代理或 TUN）",
  {
    skip: !process.env.PROXY_PLUGIN_REAL_TEST && !process.env.MIHOMO_TEST_PATH,
  },
  async t => {
    const store = new ConfigStore(await tempRoot(t))
    const config = await store.load()
    config.core.mixedPort = await freePort()
    do {
      config.core.controllerPort = await freePort()
    } while (config.core.controllerPort === config.core.mixedPort)
    if (process.env.MIHOMO_TEST_PATH) config.core.path = process.env.MIHOMO_TEST_PATH
    config.takeover = "off"
    await store.save(config)
    const manager = new ProxyManager({
      store,
      processes: {
        identity: processIdentity,
        launch: launchCore,
        stop: terminateCore,
        list: async () => [],
      },
    })
    t.after(() => manager.stop())
    await manager.initialize()
    await manager.start()
    assert.equal((await manager.client()).base, `http://127.0.0.1:${config.core.controllerPort}`)
    assert.ok((await (await manager.client()).version()).version)
    assert.equal((await (await manager.client()).configs()).tun?.enable, false)
    await manager.setMode("direct")
    assert.equal((await (await manager.client()).configs()).mode, "direct")
    const dashboard = new Dashboard(manager)
    assert.equal((await dashboard.proxies()).running, true)
    assert.ok(Array.isArray((await dashboard.providers("proxies")).providers))
    assert.ok(Array.isArray((await dashboard.providers("rules")).providers))
    assert.ok(Array.isArray((await dashboard.runtimeRules()).rules))
    await dashboard.flush("dns")
    await dashboard.saveCoreOptions({ ipv6: true, sniffing: true, "tcp-concurrent": true })
    const general = await (await manager.client()).configs()
    assert.equal(general.ipv6, true)
    assert.equal(general.sniffing, true)
    assert.equal(general["tcp-concurrent"], true)
    const abort = new AbortController()
    const traffic = await (await manager.client()).stream("traffic", abort.signal)
    const reader = traffic.body.getReader()
    const sample = await reader.read()
    assert.equal(typeof JSON.parse(new TextDecoder().decode(sample.value).trim()).up, "number")
    abort.abort()
    const pid = manager.state.identity.pid
    const beforeReload = Date.now()
    await manager.queue.run(() =>
      manager.apply(manager.state.config, {
        source:
          "proxies: []\nproxy-groups: [{name: PROXY, type: select, proxies: [DIRECT]}]\nrules: ['MATCH,PROXY']\n",
        allowReload: true,
      }),
    )
    assert.equal(manager.state.identity.pid, pid)
    console.log(`mihomo 配置热重载 ${Date.now() - beforeReload} ms（包含配置校验及落盘）`)
    await manager.queue.run(() =>
      manager.apply(manager.state.config, {
        source:
          "proxies: []\nproxy-groups: [{name: PROXY, type: select, proxies: [DIRECT, REJECT]}]\nrules: ['MATCH,PROXY']\n",
        allowReload: true,
      }),
    )
    const selectionStart = Date.now()
    assert.equal(await manager.select("PROXY", "REJECT"), "REJECT")
    console.log(`mihomo 节点切换 ${Date.now() - selectionStart} ms（包含进程归属检查）`)
    assert.equal((await (await manager.client()).proxy("PROXY")).now, "REJECT")
    await manager.stop()
    assert.equal(manager.state, null)
  },
)

test(
  "Windows 原生隐藏启动器：带空格路径、PID 回传及按身份停止",
  {
    skip:
      process.platform !== "win32" ||
      (!process.env.PROXY_PLUGIN_REAL_TEST && !process.env.MIHOMO_TEST_PATH),
  },
  async t => {
    const store = new ConfigStore(path.join(await tempRoot(t), "space folder"))
    const config = await store.load()
    config.core.mixedPort = await freePort()
    do {
      config.core.controllerPort = await freePort()
    } while (config.core.controllerPort === config.core.mixedPort)
    await atomicWrite(
      store.paths.runtime,
      YAML.stringify(buildProfile(null, config, await store.secret())),
    )
    await fs.mkdir(path.dirname(store.paths.log), { recursive: true })
    const resultFile = path.join(store.data, "runtime", "launcher-result.json")
    const args = [
      fileURLToPath(new URL("./fake-core.mjs", import.meta.url)),
      "-d",
      store.data,
      "-f",
      store.paths.runtime,
    ]
    let identity
    t.after(async () => {
      if (identity)
        await powershell("core-process.ps1", "stop", { identity, resultFile, elevate: false })
    })
    await powershell("core-process.ps1", "start", {
      binary: process.execPath,
      args,
      log: store.paths.log,
      resultFile,
      elevate: false,
    })
    const result = JSON.parse((await fs.readFile(resultFile, "utf8")).replace(/^\uFEFF/, ""))
    identity = result.identity
    assert.ok(identity?.pid)
    assert.equal(identity.executable.toLowerCase(), process.execPath.toLowerCase())
    await powershell("core-process.ps1", "stop", { identity, resultFile, elevate: false })
    identity = null
  },
)
