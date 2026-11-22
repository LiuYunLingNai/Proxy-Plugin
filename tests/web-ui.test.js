import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import express from "express"
import { once } from "node:events"
import { ProxyWebServer, WEB_PREFIX } from "../lib/web-server.js"
import { defaults } from "../lib/config.js"

test(
  "插件自带 WebUI 可添加订阅、保存设置，桌面与手机无横向溢出",
  {
    skip: !process.env.PROXY_PLUGIN_UI_TEST,
  },
  async t => {
    const { default: puppeteer } = await import("puppeteer")
    const subscriptions = []
    const subscriptionSettings = new Map()
    let savedSettings
    let savedRules
    let dnsCalls = 0
    let proxyReads = 0
    let currentNode = "节点 A"
    let connectionDownload = 4096
    let connectionClosed = false
    let checkedConfig
    let savedConfig
    const heldReads = new Map()
    const holdRead = name => {
      let release
      const promise = new Promise(resolve => { release = resolve })
      heldReads.set(name, promise)
      return () => {
        heldReads.delete(name)
        release()
      }
    }
    const waitForRead = async name => { await heldReads.get(name) }
    const initialRules = [
      "DOMAIN,ncdy.zybsuper666.com,DIRECT",
      "DOMAIN-SUFFIX,mtalk.google.com,节点 A",
      "IP-CIDR,127.0.0.0/8,DIRECT,no-resolve",
      "RULE-SET,local,DIRECT",
      "AND,((DOMAIN,example.com),(NETWORK,TCP)),节点 A",
      ...Array.from({ length: 78 }, (_, index) => `DOMAIN-SUFFIX,example${index}.com,DIRECT`),
      "MATCH,DIRECT",
    ]
    const state = {
      platform: "win32/x64",
      running: false,
      version: null,
      config: structuredClone(defaults),
      applied: "off",
      runtime: null,
      system: { owned: false, enabled: false },
      tun: { interface: false, routes: false },
      otherCores: [],
    }
    const web = new ProxyWebServer({
      streamClient: async () => ({
        stream: async (channel, signal) => {
          const stream = new ReadableStream({
            start(controller) {
              const timer = setInterval(
                () =>
                  controller.enqueue(
                    new TextEncoder().encode(
                      JSON.stringify(
                        channel === "traffic"
                          ? { up: 1024, down: 4096, upTotal: 10240, downTotal: 40960 }
                          : channel === "memory"
                            ? { inuse: 1024000 }
                            : { type: "info", payload: "实时日志测试" },
                      ) + "\n",
                    ),
                  ),
                100,
              )
              signal.addEventListener(
                "abort",
                () => {
                  clearInterval(timer)
                  controller.close()
                },
                { once: true },
              )
            },
          })
          return new Response(stream)
        },
      }),
      actions: {
        status: async () => {
          await waitForRead('status')
          return state
        },
        mode: async ({ mode }) => {
          state.config.mode = mode
          return mode
        },
        subscriptions: async () => {
          await waitForRead('subscriptions')
          return subscriptions
        },
        subscriptionAdd: async args => {
          subscriptions.push({
            id: subscriptions.length ? "b" : "a",
            name: args.name || "测试订阅",
            index: 1,
            active: subscriptions.length === 0,
            cached: true,
            nodes: 12,
            updatedAt: Date.now(),
            usage: subscriptions.length ? { expire: 0 } : { upload: 512, download: 512, total: 2048, expire: 1800000000 },
          })
          const entry = subscriptions.at(-1)
          subscriptionSettings.set(entry.id, {
            id: entry.id,
            name: entry.name,
            url: args.url,
            defaults: { userAgent: "clash.meta", autoUpdateHours: 0 },
          })
          return { name: args.name, applied: false }
        },
        subscriptionSettings: async args => ({
          ...subscriptionSettings.get(args.key),
          active: subscriptions.find(item => item.id === args.key).active,
        }),
        subscriptionEdit: async args => {
          if (args.url.endsWith("/failed")) throw new Error("模拟订阅下载失败")
          const entry = subscriptions.find(item => item.id === args.key)
          Object.assign(entry, { name: args.name })
          Object.assign(subscriptionSettings.get(args.key), {
            name: args.name,
            url: args.url,
            userAgent: args.userAgent || undefined,
            autoUpdateHours: args.autoUpdateHours ?? undefined,
          })
          return { name: args.name, applied: false }
        },
        subscriptionSelect: async args => {
          for (const item of subscriptions) item.active = item.id === args.key
          return { active: true, applied: false }
        },
        settings: async () => defaults,
        saveSettings: async args => {
          savedSettings = args
          return { saved: true }
        },
        connections: async () => ({
          running: true,
          connections: connectionClosed ? [] : [
            {
              id: "test",
              upload: 1024,
              download: connectionDownload,
              chains: ["节点 A"],
              start: "2026-11-22T08:00:00Z",
              rule: "DOMAIN",
              rulePayload: "example.com",
              metadata: {
                host: "example.com",
                destinationPort: "443",
                destinationIP: "1.2.3.4",
                sourceIP: "127.0.0.1",
                sourcePort: "12345",
                network: "tcp",
                process: "browser.exe",
                processPath: "C:/Applications/A very long application folder/Browser/browser.exe",
              },
            },
          ],
          uploadTotal: 1024,
          downloadTotal: 4096,
        }),
        closeConnection: async () => {
          connectionClosed = true
          return { closed: true }
        },
        closeAllConnections: async () => ({ closed: true }),
        logs: async () => ({
          files: [{ source: "mihomo.log", lines: ["time=now level=info 测试日志内容"] }],
        }),
        rules: async () => {
          await waitForRead('rules')
          return {
          rules: savedRules || initialRules,
          groups: ["DIRECT"],
          providers: [],
          source: "测试配置",
          available: true,
          }
        },
        saveRules: async args => {
          savedRules = args.rules
          return { saved: true, running: false }
        },
        proxySnapshot: async () => {
          proxyReads++
          return {
            running: true,
            groups: [
              { name: "GLOBAL", type: "Selector", now: "代理", all: ["代理", "节点 D"] },
              {
                name: "代理",
                type: "Selector",
                now: currentNode,
                all: ["节点 A", "节点 B", "节点 C", "节点 D"],
              },
            ],
            proxies: {
              "节点 A": { name: "节点 A", type: "SS", history: [{ delay: 25 }] },
              "节点 B": { name: "节点 B", type: "SS", provider: "机场", history: [{ delay: 45 }] },
              "节点 C": { name: "节点 C", type: "SS" },
              "节点 D": { name: "节点 D", type: "SS" },
            },
          }
        },
        selectNode: async args => {
          await new Promise(resolve => setTimeout(resolve, 150))
          if (args.name === "节点 C") throw new Error("模拟切换失败")
          currentNode = args.name
          return currentNode
        },
        providers: async args => ({
          running: true,
          providers:
            args.kind === "rules"
              ? [{ name: "local", ruleCount: 12 }]
              : [{ name: "机场", vehicleType: "HTTP", proxies: [{}] }],
        }),
        runtimeRules: async () => {
          await waitForRead('runtimeRules')
          return { running: false, rules: [] }
        },
        testGroup: async () => {
          await waitForRead('testGroup')
          return { "节点 A": 25, "节点 B": 350, "节点 C": 750 }
        },
        testNode: async () => {
          await waitForRead('testNode')
          return { delay: 25 }
        },
        disableRule: async () => ({ disabled: true }),
        kernelVersions: async () => [{ version: "v1.2.3", publishedAt: "2026-11-21" }],
        coreOptions: async () => {
          await waitForRead('coreOptions')
          return { options: { ipv6: true, "log-level": "info" } }
        },
        saveCoreOptions: async () => ({ saved: true }),
        configDocument: async () => {
          await waitForRead('configDocument')
          return { content: savedConfig || "proxies: []\nrules: ['MATCH,DIRECT']", source: "当前配置" }
        },
        checkConfigDocument: async args => {
          checkedConfig = args.content
          await new Promise(resolve => setTimeout(resolve, 200))
          return { valid: true }
        },
        saveConfigDocument: async args => {
          savedConfig = args.content
          return { saved: true }
        },
        dnsQuery: async () => {
          dnsCalls++
          return { Answer: [{ data: "1.2.3.4" }] }
        },
        flushCache: async () => ({ flushed: true }),
      },
    })
    const app = express()
    web.attach(app)
    const server = app.listen(0, "127.0.0.1")
    await once(server, "listening")
    t.after(() => {
      server.closeAllConnections()
      return new Promise(resolve => server.close(resolve))
    })
    const browser = await puppeteer.launch({
      executablePath:
        process.env.PROXY_PLUGIN_BROWSER ||
        "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
      headless: true,
      args: ["--no-sandbox", "--disable-gpu"],
    })
    t.after(() => browser.close())
    const page = await browser.newPage()
    const errors = []
    page.on("pageerror", error => errors.push(error.message))
    await page.setViewport({ width: 1280, height: 1000 })
    const session = web.createSession()
    await page.goto(
      `http://127.0.0.1:${server.address().port}${WEB_PREFIX}/#token=${session.token}`,
      { waitUntil: "networkidle2" },
    )
    await page.waitForFunction(() => document.body.textContent.includes("已停止"))
    assert.equal(await page.evaluate(() => location.hash), "")
    const releaseStatus = holdRead('status')
    await page.click('[data-nav="subscriptions"]')
    await page.waitForFunction(() => !document.querySelector('form input').closest('fieldset').disabled)
    const inputs = await page.$$("form input")
    await inputs[0].type("我的订阅 A")
    await inputs[1].type("https://example.com/subscription")
    await page.click('button[type="submit"]')
    await page.waitForFunction(() => document.body.textContent.includes("12 个节点"))
    assert.equal(subscriptions.length, 1)
    const secondInputs = await page.$$("form input")
    await secondInputs[0].type("备用订阅 B")
    await secondInputs[1].type("https://example.com/subscription-b")
    await page.click('button[type="submit"]')
    await page.waitForFunction(() => document.body.textContent.includes("备用订阅 B"))
    assert.match(await page.$eval('[data-subscription-id="a"] dl', element => element.textContent), /流量已用 1\.00 KiB · 总量 2\.00 KiB/)
    assert.equal(await page.$eval('[data-subscription-id="a"] time', element => element.dateTime), new Date(1800000000 * 1000).toISOString())
    assert.equal(await page.$('[data-subscription-id="b"] dl'), null)
    releaseStatus()
    const choose = await page.$$("button")
    const switchButton = (
      await Promise.all(
        choose.map(async item => ({
          item,
          label: await item.evaluate(element => element.textContent.trim()),
        })),
      )
    ).find(item => item.label === "切换")
    await switchButton.item.click()
    await page.waitForFunction(() => !document.body.textContent.includes("正在校验并应用订阅配置"))
    assert.equal(subscriptions[1].active, true)
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    )
    const clickText = text =>
      page.evaluate(label => {
        const button = Array.from(document.querySelectorAll("button")).find(
          item => item.textContent.trim() === label,
        )
        if (!button) throw new Error("按钮不存在 " + label)
        button.click()
      }, text)
    const screenshots = path.resolve(process.cwd(), "../../temp/proxy-plugin-webui")
    await fs.mkdir(screenshots, { recursive: true })
    const selectOption = async (label, text) => {
      await page.click(`[role="combobox"][aria-label="${label}"]`)
      await page.waitForSelector('[role="listbox"]')
      await page.evaluate(value => {
        const option = Array.from(document.querySelectorAll('[role="option"]')).find(
          element => element.textContent.trim() === value,
        )
        if (!option) throw new Error("选项不存在 " + value)
        option.click()
      }, text)
      await page.waitForFunction(() => !document.querySelector('[role="listbox"]'))
    }
    const capture = async name => {
      await page.evaluate(async () => {
        await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})))
      })
      await page.screenshot({ path: path.join(screenshots, name), fullPage: true })
    }
    const fillField = async (label, text) => {
      const id = await page.evaluate(value => {
        const element = Array.from(document.querySelectorAll('[role="dialog"] label')).find(item => item.textContent.trim() === value)
        if (!element?.htmlFor) throw new Error("字段不存在 " + value)
        return element.htmlFor
      }, label)
      await page.evaluate(value => {
        const input = document.getElementById(value)
        input.focus()
        input.select()
      }, id)
      await page.keyboard.sendCharacter(text)
    }
    await page.click('button[aria-label="编辑 备用订阅 B"]')
    await page.waitForFunction(() => document.querySelector('[role="dialog"] input[type="password"]')?.value === "https://example.com/subscription-b")
    await fillField("订阅名称", "编辑后的订阅 B")
    await clickText("保存订阅")
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'))
    assert.equal(subscriptions[1].name, "编辑后的订阅 B")
    await page.waitForSelector('button[aria-label="编辑 编辑后的订阅 B"]')
    await page.click('button[aria-label="编辑 编辑后的订阅 B"]')
    await page.waitForSelector('[role="dialog"] input[type="password"]')
    await fillField("订阅地址", "https://example.com/failed")
    await clickText("保存并更新")
    await page.waitForFunction(() => document.querySelector('[role="dialog"]').textContent.includes("模拟订阅下载失败"))
    assert.equal(subscriptionSettings.get("b").url, "https://example.com/subscription-b")
    assert.equal(await page.$eval('[role="dialog"] input[type="password"]', element => element.value), "https://example.com/failed")
    await fillField("订阅地址", "https://example.com/edited")
    await page.evaluate(() => Array.from(document.querySelectorAll('[role="dialog"] label')).find(element => element.textContent.includes("User-Agent 使用全局设置")).click())
    await fillField("请求 User-Agent", "mihomo/browser-test")
    await page.evaluate(() => Array.from(document.querySelectorAll('[role="dialog"] label')).find(element => element.textContent.includes("更新周期使用全局设置")).click())
    await fillField("更新周期（小时）", "0.5")
    await capture("subscription-editor-desktop.png")
    await clickText("保存并更新")
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'))
    assert.equal(subscriptionSettings.get("b").url, "https://example.com/edited")
    assert.equal(subscriptionSettings.get("b").userAgent, "mihomo/browser-test")
    assert.equal(subscriptionSettings.get("b").autoUpdateHours, 0.5)
    await clickText("设置")
    await page.waitForFunction(() => document.querySelector('[role="dialog"] input'))
    assert.equal(await page.evaluate(() => {
      const label = Array.from(document.querySelectorAll('[role="dialog"] label')).find(element => element.textContent.trim() === 'WebUI 独立端口')
      return document.getElementById(label.htmlFor).disabled
    }), true)
    await page.evaluate(() => Array.from(document.querySelectorAll('[role="dialog"] label')).find(element => element.textContent.includes('挂载到云崽 HTTP 服务')).click())
    await fillField("WebUI 独立监听地址", "0.0.0.0")
    await fillField("WebUI 独立端口", "19123")
    await fillField("WebUI 访问地址", "https://proxy.example")
    await capture("webui-service-settings-desktop.png")
    await selectOption("TUN 协议栈", "gvisor")
    await page.click('[role="combobox"][aria-label="Linux 桌面环境"]')
    await page.waitForSelector('[role="listbox"]')
    await page.keyboard.press("Escape")
    assert.ok(await page.$('[role="dialog"]'))
    assert.equal(await page.$('[role="listbox"]'), null)
    await clickText("保存设置")
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'))
    assert.equal(savedSettings["core.mixedPort"], defaults.core.mixedPort)
    assert.equal(savedSettings["tun.stack"], "gvisor")
    assert.equal(savedSettings["webui.mountToYunzai"], false)
    assert.equal(savedSettings["webui.port"], 19123)
    assert.equal(savedSettings["webui.host"], "0.0.0.0")
    assert.equal(savedSettings["webui.publicUrl"], "https://proxy.example")
    assert.equal(savedSettings["webui.enabled"], true)
    await page.waitForFunction(() => !document.querySelector('[role="status"]'))
    await page.click('[data-nav="connections"]')
    await page.waitForFunction(() => document.body.textContent.includes("example.com"))
    await selectOption("连接协议", "UDP")
    await page.waitForFunction(() => document.body.textContent.includes("没有匹配的活动连接"))
    await selectOption("连接协议", "全部协议")
    await clickText("详情")
    await page.waitForSelector('[role="dialog"][aria-labelledby]')
    assert.ok(await page.$eval('[role="dialog"]', element => element.textContent.includes("browser.exe")))
    await capture("connection-drawer-desktop.png")
    await page.keyboard.press("Tab")
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), true)
    connectionDownload = 8192
    await page.waitForFunction(() => document.querySelector('[role="dialog"]').textContent.includes("8.0 KiB"))
    await clickText("断开此连接")
    await page.waitForFunction(() => document.querySelector('[role="dialog"]').textContent.includes("连接已结束"))
    assert.ok(await page.$eval('[role="dialog"]', element => element.textContent.includes("8.0 KiB")))
    assert.equal(await page.evaluate(() => Array.from(document.querySelectorAll('[role="dialog"] button')).find(element => element.textContent.trim() === "断开此连接").disabled), true)
    await page.keyboard.press("Escape")
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'))
    connectionClosed = false
    await page.click('[data-nav="logs"]')
    await page.waitForFunction(() => document.body.textContent.includes("测试日志内容"))
    await clickText("实时日志流")
    await page.waitForFunction(() => document.body.textContent.includes("实时日志测试"))
    await page.focus('[role="group"][aria-label="日志来源"] button[aria-pressed="true"]')
    await page.keyboard.press("ArrowLeft")
    await page.waitForFunction(() => document.body.textContent.includes("测试日志内容"))
    const releaseRuntime = holdRead('runtimeRules')
    await page.click('[data-nav="rules"]')
    await page.waitForSelector('[data-rule-index="0"]')
    assert.equal(await page.evaluate(() => Array.from(document.querySelectorAll('button')).find(element => element.textContent.trim() === '刷新规则').disabled), false)
    assert.ok(
      await page.$eval(
        'input[aria-label="搜索规则"]',
        element => element.getBoundingClientRect().width >= 200,
      ),
    )
    const rulesDirectory = path.resolve(process.cwd(), "../../temp/proxy-plugin-webui")
    await fs.mkdir(rulesDirectory, { recursive: true })
    await page.screenshot({
      path: path.join(rulesDirectory, "rules-list-desktop.png"),
      fullPage: true,
    })
    releaseRuntime()
    await clickText("IP")
    assert.equal((await page.$$("[data-rule-index]")).length, 1)
    assert.equal(await page.$eval('[role="tab"][aria-selected="true"]', element => element.textContent.trim()), "IP")
    await clickText("全部")
    await page.click('button[aria-label="编辑第 1 条规则"]')
    await page.waitForSelector('[role="dialog"] input')
    await clickText("完整规则")
    await page.waitForSelector('[role="dialog"] textarea')
    assert.ok(
      await page.$eval(
        '[role="dialog"] textarea',
        element => element.getBoundingClientRect().height >= 100,
      ),
    )
    await clickText("取消")
    await page.click('button[aria-label="批量编辑"]')
    await page.waitForSelector("textarea:not([disabled])")
    assert.ok(
      await page.$eval("textarea", element => element.getBoundingClientRect().height >= 300),
    )
    await page.$eval("textarea", element => {
      element.focus()
      element.select()
    })
    await page.type("textarea", "DOMAIN,example.com,DIRECT\nMATCH,DIRECT")
    await clickText("确定修改")
    await clickText("保存并应用")
    await page.waitForFunction(() => document.body.textContent.includes("规则已校验并保存"))
    assert.deepEqual(savedRules, ["DOMAIN,example.com,DIRECT", "MATCH,DIRECT"])
    await clickText("添加规则")
    await page.waitForSelector('[role="dialog"] input')
    const contentId = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll('[role="dialog"] label')).find(
          label => label.textContent.trim() === "匹配内容",
        ).htmlFor,
    )
    await page.evaluate(id => document.getElementById(id).focus(), contentId)
    await page.waitForFunction(id => document.activeElement?.id === id, {}, contentId)
    await page.keyboard.type("new.example.com")
    await clickText("确定修改")
    await clickText("保存并应用")
    await page.waitForFunction(() => !document.body.textContent.includes("修改尚未应用"))
    assert.deepEqual(savedRules, [
      "DOMAIN-SUFFIX,new.example.com,DIRECT",
      "DOMAIN,example.com,DIRECT",
      "MATCH,DIRECT",
    ])
    await page.click('[data-nav="proxies"]')
    await page.waitForSelector('[data-current-node]')
    assert.equal(await page.$eval('[role="group"][aria-label="代理组"] [aria-current="true"]', element => element.getAttribute("aria-label")), "代理")
    assert.equal(await page.$eval('[data-current-node]', element => element.textContent), "节点 A")
    assert.equal(await page.$('input[name="url"]'), null)
    await clickText("测速设置")
    await page.waitForSelector('[role="dialog"] input[name="url"]')
    await page.keyboard.press("Escape")
    await page.waitForSelector('[role="dialog"]', { hidden: true })
    await page.focus('[role="combobox"][aria-label="节点排序"]')
    await page.keyboard.press("ArrowDown")
    await page.waitForSelector('[role="listbox"]')
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("Enter")
    assert.equal(await page.$eval('[role="combobox"][aria-label="节点排序"]', element => element.textContent.trim()), "延迟优先")
    const readsBeforeSelection = proxyReads
    await page.click('[data-proxy-node="节点 B"]')
    await page.waitForFunction(() => document.body.textContent.includes("切换中"))
    await page.waitForFunction(() => !document.body.textContent.includes("切换中"))
    assert.equal(
      await page.$eval('button[aria-pressed="true"]', element => element.textContent.trim()),
      "规则",
    )
    assert.equal(await page.$eval('[data-proxy-node="节点 B"]', element => element.getAttribute("aria-pressed")), "true")
    assert.equal(await page.$eval('[data-current-node]', element => element.textContent), "节点 B")
    assert.equal(proxyReads, readsBeforeSelection)
    await page.click('[data-proxy-node="节点 C"]')
    await page.waitForFunction(() => document.body.textContent.includes("模拟切换失败"))
    assert.equal(await page.$eval('[data-proxy-node="节点 B"]', element => element.getAttribute("aria-pressed")), "true")
    assert.equal(proxyReads, readsBeforeSelection)
    const releaseNodeTest = holdRead('testNode')
    await page.click('button[aria-label="测速 节点 A"]')
    await page.waitForSelector('li[aria-busy="true"] svg[class*="animate-spin"]')
    assert.deepEqual(await page.$$eval('li[aria-busy="true"] [data-proxy-node]', nodes => nodes.map(node => node.getAttribute('data-proxy-node'))), ['节点 A'])
    releaseNodeTest()
    await page.waitForFunction(() => document.body.textContent.includes("节点测速完成"))
    const releaseGroupTest = holdRead('testGroup')
    await clickText("全组测速")
    await page.waitForFunction(() => document.querySelectorAll('ul[aria-label="节点列表"] li[aria-busy="true"]').length === 4)
    releaseGroupTest()
    await page.waitForFunction(() => document.body.textContent.includes("代理组测速完成"))
    assert.equal(proxyReads, readsBeforeSelection)
    for (const [label, className] of [
      ["25 ms", "text-success-soft-foreground"],
      ["350 ms", "text-warning-soft-foreground"],
      ["750 ms", "text-destructive-soft-foreground"],
      ["失败", "text-destructive-soft-foreground"],
    ]) {
      assert.equal(
        await page.evaluate(
          (text, expected) =>
            Array.from(document.querySelectorAll("span")).some(
              element =>
                element.textContent.trim() === text && element.classList.contains(expected),
            ),
          label,
          className,
        ),
        true,
        label,
      )
    }
    await page.click('[role="group"][aria-label="路由模式"] button:nth-of-type(2)')
    await page.waitForSelector('[role="group"][aria-label="代理组"] button[aria-label="GLOBAL"][aria-current="true"]:not([disabled])')
    assert.equal(await page.$eval('[data-current-node]', element => element.textContent), "代理")
    await page.click('[role="group"][aria-label="路由模式"] button:first-of-type')
    await page.waitForSelector('[role="group"][aria-label="代理组"] button[aria-label="代理"][aria-current="true"]:not([disabled])')
    await page.click('[role="tablist"][aria-label="代理页面"] [role="tab"]:last-child')
    await page.waitForFunction(() => document.querySelector('[role="tabpanel"][aria-label="代理提供者"]')?.textContent.includes("机场"))
    assert.equal(await page.$('[data-proxy-node]'), null)
    const releaseCoreOptions = holdRead('coreOptions')
    await page.click('[data-nav="config"]')
    await page.waitForSelector('textarea[aria-label="完整配置"]')
    await page.waitForFunction(() => {
      const editor = document.querySelector('textarea[aria-label="完整配置"]')
      return !!editor.value && !editor.readOnly
    })
    releaseCoreOptions()
    assert.equal(await page.$eval('textarea[aria-label="完整配置"]', element => element === document.activeElement), false)
    const editor = 'textarea[aria-label="完整配置"]'
    await page.$eval(editor, element => {
      element.focus()
      element.select()
    })
    await page.keyboard.sendCharacter("proxies: []\nrules:\n  - MATCH,DIRECT\n")
    await page.keyboard.down("Control")
    await page.keyboard.press("KeyF")
    await page.keyboard.up("Control")
    await page.type('input[aria-label="查找配置内容"]', "DIRECT")
    assert.equal(await page.$eval('input[aria-label="查找配置内容"]', element => element.value), "DIRECT")
    await page.type('input[aria-label="替换配置内容"]', "REJECT")
    await clickText("全部替换（1）")
    await page.waitForFunction(() => document.querySelector('textarea[aria-label="完整配置"]').value.includes("MATCH,REJECT"))
    await page.click('button[aria-label="关闭查找"]')
    const editedConfig = await page.$eval(editor, element => element.value)
    assert.ok(await page.$('pre code .hl-attr'))
    await clickText("查询")
    await page.waitForFunction(() => document.body.textContent.includes("1.2.3.4"))
    assert.equal(dnsCalls, 1)
    await clickText("校验配置")
    await page.waitForFunction(() => document.querySelector('textarea[aria-label="完整配置"]').readOnly)
    await page.focus(editor)
    await page.keyboard.down("Control")
    await page.keyboard.press("KeyZ")
    await page.keyboard.up("Control")
    assert.equal(await page.$eval(editor, element => element.value), editedConfig)
    await page.waitForFunction(() => document.body.textContent.includes("mihomo 配置校验通过"))
    assert.equal(checkedConfig, editedConfig)
    await page.focus(editor)
    await page.keyboard.down("Control")
    await page.keyboard.press("KeyS")
    await page.keyboard.up("Control")
    await page.waitForSelector('[role="dialog"]')
    assert.equal(savedConfig, undefined)
    await clickText("取消")
    assert.equal(savedConfig, undefined)
    await clickText("保存并应用")
    await page.waitForSelector('[role="dialog"]')
    await clickText("确定")
    await page.waitForFunction(() => document.body.textContent.includes("配置已保存并应用"))
    assert.equal(savedConfig, editedConfig)
    await capture("config-desktop.png")
    await page.click('[data-nav="proxies"]')
    await page.waitForFunction(() => document.body.textContent.includes("节点 B"))
    await page.screenshot({ path: path.join(screenshots, "proxies-desktop.png"), fullPage: true })
    state.running = true
    await page.click('[data-nav="home"]')
    await page.waitForFunction(() => document.body.textContent.includes("4.0 KiB/s"))
    await page.waitForFunction(() => !document.querySelector('[role="status"]'))
    const directory = path.resolve(process.cwd(), "../../temp/proxy-plugin-webui")
    await fs.mkdir(directory, { recursive: true })
    await page.screenshot({ path: path.join(directory, "desktop.png"), fullPage: true })
    await page.setViewport({ width: 375, height: 900 })
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    )
    await page.screenshot({ path: path.join(directory, "mobile.png"), fullPage: true })
    await page.click('button[aria-label="切换深色"]')
    await page.waitForFunction(() => document.documentElement.classList.contains("dark"))
    await page.waitForFunction(() => {
      const card = document.querySelector(".glass-card")
      const color = card && getComputedStyle(card).backgroundColor
      return color && color.startsWith("rgb(") && Number(color.match(/\d+/)?.[0]) < 50
    })
    await page.screenshot({ path: path.join(directory, "mobile-dark.png"), fullPage: true })
    await page.click('[data-nav="rules"]')
    await page.waitForSelector('[data-rule-index="0"]')
    assert.ok(
      await page.$eval(
        'input[aria-label="搜索规则"]',
        element => element.getBoundingClientRect().width >= 200,
      ),
    )
    await page.screenshot({ path: path.join(directory, "rules-mobile.png"), fullPage: true })
    await page.setViewport({ width: 1280, height: 1000 })
    await page.screenshot({ path: path.join(directory, "rules-desktop.png"), fullPage: true })
    await page.setViewport({ width: 375, height: 900 })
    for (const view of ["subscriptions", "connections", "logs", "rules", "proxies", "config"]) {
      await page.click(`[data-nav="${view}"]`)
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
        view,
      )
      if (view === "proxies") {
        await page.waitForSelector('[role="combobox"][aria-label="代理组"]', { visible: true })
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      }
      if (view === "config" || view === "proxies")
        await page.screenshot({ path: path.join(directory, `${view}-mobile.png`), fullPage: true })
      if (view === "connections") {
        await page.waitForFunction(() => document.body.textContent.includes("example.com"))
        await clickText("详情")
        await page.waitForSelector('[role="dialog"]')
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
        await capture("connection-drawer-mobile-dark.png")
        await page.keyboard.press("Escape")
      }
      if (view === "config") {
        await page.click('[role="combobox"][aria-label="进程匹配"]')
        await page.waitForSelector('[role="listbox"]')
        assert.equal(await page.$eval('[role="listbox"]', element => {
          const bounds = element.getBoundingClientRect()
          return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight
        }), true)
        await capture("config-dropdown-mobile-dark.png")
        await page.keyboard.press("Escape")
      }
    }
    await page.click('[data-nav="subscriptions"]')
    await page.waitForSelector('button[aria-label="编辑 编辑后的订阅 B"]')
    await page.click('button[aria-label="编辑 编辑后的订阅 B"]')
    await page.waitForFunction(() => document.querySelector('[role="dialog"] input[type="password"]')?.value === "https://example.com/edited")
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await capture("subscription-editor-mobile-dark.png")
    await clickText("取消")
    await clickText("设置")
    await page.waitForSelector('[role="dialog"] input')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await capture("webui-service-settings-mobile-dark.png")
    await clickText("取消")
    const releaseRules = holdRead('rules')
    await page.click('[data-nav="rules"]')
    await page.waitForSelector('[data-rule-index="0"]')
    await page.click('button[aria-label="批量编辑"]')
    await page.waitForSelector('[role="dialog"] textarea')
    await page.$eval('[role="dialog"] textarea', element => {
      element.focus()
      element.select()
    })
    await page.keyboard.sendCharacter('DOMAIN,unsaved.example,DIRECT\nMATCH,DIRECT')
    await clickText('确定修改')
    releaseRules()
    await page.waitForNetworkIdle({ idleTime: 200 })
    assert.equal(await page.$eval('[data-rule-index="0"]', element => element.textContent.includes('unsaved.example')), true)
    const releaseDocument = holdRead('configDocument')
    await page.click('[data-nav="config"]')
    await page.waitForFunction(() => {
      const editor = document.querySelector('textarea[aria-label="完整配置"]')
      return !!editor?.value && !editor.readOnly
    })
    await page.$eval('textarea[aria-label="完整配置"]', element => {
      element.focus()
      element.select()
    })
    const unsavedDocument = 'proxies: []\nrules: ["MATCH,REJECT"]\n# unsaved'
    await page.keyboard.sendCharacter(unsavedDocument)
    releaseDocument()
    await page.waitForNetworkIdle({ idleTime: 200 })
    assert.equal(await page.$eval('textarea[aria-label="完整配置"]', element => element.value), unsavedDocument)
    assert.deepEqual(errors, [])
  },
)
