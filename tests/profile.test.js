import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import template from "art-template"
import { buildProfile, parseProfile } from "../lib/profile.js"
import { defaults, validateConfig } from "../lib/config.js"
import { chooseAsset } from "../lib/installer.js"
import { sameProcess, isCoreName } from "../lib/process.js"
import { splitArgs } from "../apps/proxy.js"
import ProxyPlugin from "../apps/proxy.js"
import { parseGVariant } from "../platforms/index.js"

test("保留原分组、规则和 provider，强制收紧控制接口并明确关闭 TUN", () => {
  const input = {
    proxies: [{ name: "香港 01", type: "ss", server: "example.com", port: 443 }],
    "proxy-groups": [{ name: "我的分组", type: "select", proxies: ["香港 01"] }],
    "proxy-providers": { subscription: { type: "http", url: "https://example.com" } },
    rules: ["DOMAIN-SUFFIX,example.com,DIRECT", "MATCH,我的分组"],
    "external-controller": "0.0.0.0:9090",
    "external-controller-unix": "/tmp/controller",
    "external-ui-url": "https://example.com/ui.zip",
    "allow-lan": true,
    listeners: [{ name: "extra", type: "http", port: 8888 }],
    tun: { enable: true },
  }
  const output = buildProfile(input, structuredClone(defaults), "secret")
  assert.deepEqual(output.rules, input.rules)
  assert.deepEqual(output["proxy-groups"], input["proxy-groups"])
  assert.deepEqual(output["proxy-providers"], input["proxy-providers"])
  assert.equal(output["external-controller"], "127.0.0.1:19090")
  assert.equal(output["allow-lan"], false)
  assert.equal(output.tun.enable, false)
  assert.equal(output.listeners, undefined)
  assert.equal(output["external-controller-unix"], undefined)
  assert.equal(input.tun.enable, true)
})

test("TUN 强制开启 DNS，同时保留用户 nameserver 和 fake-ip-filter", () => {
  const config = structuredClone(defaults)
  config.takeover = "tun"
  const output = buildProfile(
    { proxies: [], dns: { enable: false, nameserver: ["1.1.1.1"], "fake-ip-filter": ["+.lan"] } },
    config,
    "secret",
  )
  assert.equal(output.tun.enable, true)
  assert.equal(output.tun.device, "ProxyPlugin")
  assert.equal(output.dns.enable, true)
  assert.deepEqual(output.dns.nameserver, ["1.1.1.1"])
  assert.deepEqual(output.dns["fake-ip-filter"], ["+.lan"])
})

test("拒绝分享链接及错误设置", () => {
  assert.throws(() => parseProfile("vmess://not-a-yaml-profile"))
  assert.throws(() => parseProfile("- a\n- b"))
  const config = structuredClone(defaults)
  config.core.mixedPort = config.core.controllerPort
  assert.throws(() => validateConfig(config), /不能相同/)
})

test("选择 x64 基线核心，不意外选到更高指令集", () => {
  const assets = ["mihomo-windows-amd64-v3-v1.2.zip", "mihomo-windows-amd64-v1-v1.2.zip"].map(
    name => ({ name }),
  )
  assert.equal(chooseAsset(assets, "win32", "x64", "v1.2").name, assets[1].name)
})

test("PID 相同但创建时刻改变时拒绝确认进程归属", () => {
  assert.equal(
    sameProcess(
      { pid: 10, birth: "1", executable: "core" },
      { pid: 10, birth: "2", executable: "core" },
    ),
    false,
  )
})

test("识别跨平台常见核心名，并排除桌面客户端进程", () => {
  for (const name of [
    "mihomo.exe",
    "/usr/local/bin/mihomo",
    "C:\\tools\\mihomo-windows-amd64.exe",
    "clash-meta",
    "clash.core.exe",
    "/usr/bin/mihomo (deleted)",
  ])
    assert.equal(isCoreName(name), true, name)
  for (const name of ["node.exe", "clash-verge.exe", "mihomo-party.exe", "not-mihomo"])
    assert.equal(isCoreName(name), false, name)
})

test("命令中的组名和节点名支持空格", () => {
  assert.deepEqual(splitArgs('"🚀 代理" "香港 01"'), ["🚀 代理", "香港 01"])
})

test("非主人不会进入管理服务或执行任何操作", async () => {
  const instance = new ProxyPlugin()
  assert.equal(
    await instance.dispatch({
      isMaster: false,
      msg: "#代理核心启动",
      reply() {
        throw new Error("不应回复或调用")
      },
    }),
    false,
  )
})

test("三个帮助指令独立匹配并动态渲染，无需初始化核心", async t => {
  const previousManager = globalThis.__proxyPluginManagerV1
  globalThis.__proxyPluginManagerV1 = {
    initialize() { throw new Error("帮助图不应初始化核心") },
  }
  t.after(() => {
    globalThis.__proxyPluginManagerV1 = previousManager
  })
  const plugin = new ProxyPlugin()
  const image = { type: "image", file: Buffer.from("rendered") }
  const runtime = {
    puppeteer: {
      async screenshot(name, data) {
        const source = await fs.readFile(data.tplFile, "utf8")
        rendered.set(name, template.render(source, data))
        assert.equal(data.imgType, "png")
        return image
      },
    },
  }
  const rendered = new Map()
  for (const command of ["#代理帮助", "#节点管理", "#订阅管理"]) {
    const rule = plugin.rule.find(item => new RegExp(item.reg).test(command))
    assert.equal(rule?.permission, "master")
    assert.doesNotMatch(command + " 说明", new RegExp(rule.reg))
    const replies = []
    await plugin[rule.fnc]({
      isMaster: true,
      msg: command,
      runtime,
      reply: async message => replies.push(message),
    })
    assert.deepEqual(replies, [image])
  }
  assert.match(rendered.get("Proxy-Plugin/help/overview"), /<h1>代理指令帮助<\/h1>[\s\S]+#节点管理[\s\S]+#订阅管理/)
  assert.match(rendered.get("Proxy-Plugin/help/nodes"), /<h1>节点管理<\/h1>[\s\S]+#代理测速/)
  assert.match(rendered.get("Proxy-Plugin/help/subscriptions"), /<h1>订阅管理<\/h1>[\s\S]+#代理订阅 更新全部/)
  assert.equal(await plugin.dispatch({ isMaster: false, msg: "#订阅管理" }), false)
})

test("测速、订阅与状态发送运行结果图，渲染不可用时发送结果文字", async t => {
  const previousManager = globalThis.__proxyPluginManagerV1
  const config = structuredClone(defaults)
  config.subscription.items = [{ name: "常用订阅", active: true }]
  const state = {
    running: true,
    applied: "off",
    platform: "win32/x64",
    config,
    appliedConfig: config,
    system: { owned: false, enabled: true },
    tun: { interface: false, routes: false },
    lastError: "订阅请求失败 https://example.com/?token=private",
  }
  globalThis.__proxyPluginManagerV1 = {
    initialize: async () => {},
    status: async () => state,
    listSubscriptions: async () => Array.from({ length: 11 }, (_, index) => ({
      index: index + 1,
      name: index === 0 ? "常用订阅" : `备用 ${index}`,
      active: index === 0,
      applied: index === 0,
      cached: true,
      nodes: 12,
      url: "https://example.com/?token=private",
      usage: index === 0 ? { upload: 0, download: 1024, total: 2048, expire: 1800000000 } : undefined,
    })),
    speed: async (group, options) => {
      assert.equal(group, "手动选择")
      assert.equal(options.includeCurrent, true)
      return {
        current: "节点 B",
        results: [{ name: "节点 A", delay: 45 }, { name: "节点 B", delay: 280 }, { name: "节点 C", delay: null }],
      }
    },
  }
  t.after(() => { globalThis.__proxyPluginManagerV1 = previousManager })
  const plugin = new ProxyPlugin()
  const runtime = {
    puppeteer: {
      async screenshot(name, data) {
        const source = await fs.readFile(data.tplFile, "utf8")
        return { type: "image", html: template.render(source, data) }
      },
    },
  }
  const run = async (msg, renderer = runtime) => {
    const replies = []
    await plugin.dispatch({ isMaster: true, msg, runtime: renderer, reply: message => replies.push(message) })
    return replies
  }
  const [progress, speed] = await run("#代理测速 手动选择")
  assert.match(progress, /开始测速/)
  assert.match(speed.html, /可用节点[\s\S]+2 \/ 3/)
  assert.match(speed.html, /节点 B[\s\S]+当前[\s\S]+row-value warning">280 ms/)
  assert.match(speed.html, /row-value danger">失败/)
  const [subscriptions] = await run("#代理订阅")
  assert.equal(subscriptions.length, 2)
  assert.match(subscriptions[0].html, /已用 1\.00 KiB[\s\S]+到期时间/)
  assert.doesNotMatch(subscriptions[1].html, /流量|到期时间/)
  assert.doesNotMatch(subscriptions.map(page => page.html).join(""), /token=private/)
  const [status] = await run("#代理状态")
  assert.match(status.html, /核心进程[\s\S]+运行中[\s\S]+已应用接管[\s\S]+关闭接管/)
  assert.match(status.html, /系统流量尚未由本插件接管/)
  assert.doesNotMatch(status.html, /token=private/)
  const [fallback] = await run("#代理状态", { puppeteer: { screenshot: async () => false } })
  assert.match(fallback, /核心进程：运行中/)
})

test("群聊中的更新参数也不能用于提交订阅 URL", async t => {
  const previous = globalThis.__proxyPluginManagerV1
  globalThis.__proxyPluginManagerV1 = { initialize: async () => {} }
  t.after(() => {
    globalThis.__proxyPluginManagerV1 = previous
  })
  const replies = []
  await new ProxyPlugin().dispatch({
    isMaster: true,
    isGroup: true,
    msg: "#代理订阅 更新 https://example.com/?token=private",
    reply: async text => replies.push(text),
  })
  assert.ok(replies[0].includes("私聊"))
  assert.ok(!replies[0].includes("private"))
})

test("GNOME 类型前缀和单双引号差异归一化为空数组、字符串及端口值", () => {
  assert.deepEqual(parseGVariant("@as []", "array"), [])
  assert.deepEqual(parseGVariant("[\"a'b\", 'localhost']", "array"), ["a'b", "localhost"])
  assert.equal(parseGVariant("uint32 17890", "number"), 17890)
  assert.equal(parseGVariant("'manual'", "string"), "manual")
  assert.equal(parseGVariant("false", "boolean"), false)
})
