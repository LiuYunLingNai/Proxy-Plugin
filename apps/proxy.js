import BasePlugin from "../../../lib/plugins/plugin.js"
import { getManager } from "../lib/manager.js"
import { redact } from "../lib/storage.js"
import fs from "node:fs/promises"
import { activeSubscription } from "../lib/config.js"
import { getWebServer, WEB_PREFIX } from "../lib/web-server.js"
import { helpPattern, isHelpCommand, renderHelp } from "../lib/help.js"
import { replyReport, speedReport, statusReport, subscriptionReports } from "../lib/report.js"

const names = {
  off: "关闭接管",
  system: "系统代理",
  tun: "TUN",
  rule: "规则",
  global: "全局",
  direct: "直连",
}
const modes = {
  规则: "rule",
  全局: "global",
  直连: "direct",
  rule: "rule",
  global: "global",
  direct: "direct",
}
const takeovers = {
  系统: "system",
  系统代理: "system",
  tun: "tun",
  TUN: "tun",
  关闭: "off",
  off: "off",
  system: "system",
}
const detected = value => (value === true ? "已检测到" : value === false ? "未检测到" : "未能检测")

export function splitArgs(text) {
  const tokens = String(text).match(/"(?:\\.|[^"\\])*"|'[^']*'|\S+/g) || []
  return tokens.map(token =>
    token.startsWith('"') ? JSON.parse(token) : token.startsWith("'") ? token.slice(1, -1) : token,
  )
}

export default class ProxyPlugin extends BasePlugin {
  constructor() {
    super({
      name: "Proxy-Plugin",
      dsc: "mihomo 系统代理与 TUN 管理",
      event: "message",
      priority: 250,
      rule: [
        { reg: helpPattern, fnc: "dispatch", permission: "master", log: false },
        {
          reg: "^#代理(?:状态|部署|核心(?:启动|停止|重启)|接管.*|模式.*|组|节点.*|切换.*|测速.*|订阅.*|配置(?:检查|回滚|导入).*|诊断|恢复|日志|web(?:\\s*\\d+)?|下线)$",
          fnc: "dispatch",
          permission: "master",
          log: false,
        },
      ],
    })
  }

  async init() {
    const manager = getManager()
    let lease = await manager.attach()
    this.addCleanup(
      async () => {
        await manager.detach(lease)
      },
      async () => {
        lease = await manager.attach()
      },
    )
    const web = getWebServer()
    const attachWeb = async () => {
      const current = await manager.store.load()
      try {
        return await web.attachConfigured(current.webui, globalThis.Bot?.express)
      } catch (error) {
        web.lastError = redact(error.message)
        globalThis.logger?.error?.(`[Proxy-Plugin] ${web.lastError}`)
        return null
      }
    }
    let webLease = await attachWeb()
    this.addCleanup(
      () => web.release(webLease),
      async () => {
        webLease = await attachWeb()
      },
    )
    const config = await manager.store.load()
    if (config.core.autoStart)
      void manager.start().catch(error => {
        manager.lastError = redact(error.message)
        globalThis.logger?.error?.(`[Proxy-Plugin] 自动启动失败：${redact(error.message)}`)
      })
  }

  async dispatch(e = this.e) {
    if (!e.isMaster) return false
    const command = String(e.msg || e.text || "").trim()
    const text = command.replace(/^#代理/, "").trim()
    const reply = message => e.reply(message)
    try {
      if (isHelpCommand(command)) return await reply(await renderHelp(command, e.runtime))
      const manager = getManager()
      await manager.initialize()
      if (text === "下线") return reply(`已撤销 ${getWebServer().revoke()} 个 WebUI 访问链接。`)
      if (/^web(?:\s*\d+)?$/.test(text)) {
        const web = getWebServer()
        const minutes = Number(text.replace(/^web\s*/, "")) || 30
        const base = web.accessBase(globalThis.Bot?.url)
        const session = web.createSession(minutes)
        const message = `Proxy-Plugin WebUI（${minutes} 分钟内有效）\n${base}${WEB_PREFIX}/#token=${session.token}\n使用 #代理下线 撤销访问。`
        if (e.isGroup) {
          try {
            if (e.bot?.sendFriendMsg) await e.bot.sendFriendMsg(e.user_id, message)
            else await globalThis.Bot.pickFriend(e.user_id).sendMsg(message)
          } catch (error) {
            web.sessions.delete(session.token)
            throw new Error("私聊发送失败，请私聊机器人发送 #代理web")
          }
          return reply("WebUI 链接已私聊发送。")
        }
        return reply(message)
      }
      if (["部署", "核心启动"].includes(text)) {
        await reply("正在校验配置并启动 mihomo；首次使用会下载核心。")
        const result = await manager.start()
        return reply(
          result.already
            ? "核心已在运行；更改锅巴设置后使用 #代理核心重启 应用。"
            : `核心已启动，接管方式：${names[result.takeover]}。`,
        )
      }
      if (text === "核心停止" || text === "恢复") {
        await manager.stop()
        return reply("已恢复本插件的系统代理设置并停止核心；TUN 网卡与路由可用 #代理诊断 检查。")
      }
      if (text === "核心重启") {
        await reply("正在校验并应用配置，核心将重启。")
        await manager.restart()
        return reply("核心已重启，目标接管方式已应用。")
      }
      if (text.startsWith("接管")) {
        const mode = takeovers[text.slice(2).trim()]
        if (!mode) return reply("用法：#代理接管 系统 / tun / 关闭")
        await reply("正在检查权限并切换接管方式。")
        const result = await manager.takeover(mode)
        return reply(
          `接管方式：${names[result.takeover]}${result.running ? "；核心运行中。" : "。"}`,
        )
      }
      if (text.startsWith("模式")) {
        const mode = modes[text.slice(2).trim()]
        if (!mode) return reply("用法：#代理模式 规则 / 全局 / 直连")
        await manager.setMode(mode)
        return reply(`路由模式已切换为${names[mode]}。全局模式使用 GLOBAL 组，请检查该组选择。`)
      }
      if (text === "状态" || text === "诊断") {
        const state = await manager.status()
        if (text === "状态") return await replyReport(e, "status", statusReport(state, names))
        const output = [
          "Proxy-Plugin 0.2.0",
          `平台：${state.platform}`,
          `核心进程：${state.running ? "运行中" : "未运行"}${state.version ? ` · ${state.version.version || "mihomo"}` : ""}`,
          `目标接管：${names[state.config.takeover]}；已应用：${names[state.applied]}`,
          `路由模式：${names[state.runtime?.mode || state.config.mode]}`,
          `代理端口：${state.runtime?.["mixed-port"] || state.appliedConfig?.core.mixedPort || state.config.core.mixedPort}；控制端口：${state.appliedConfig?.core.controllerPort || state.config.core.controllerPort}`,
          `系统代理：${state.system.owned ? "本插件接管" : state.system.conflict ? "存在冲突" : "本插件未接管"}`,
          state.system.enabled === true
            ? "操作系统代理开关：开启（包含 PAC/自动代理）"
            : state.system.enabled === false
              ? "操作系统代理开关：关闭"
              : "",
          `TUN 网卡：${detected(state.tun.interface)}；路由：${detected(state.tun.routes)}`,
          `订阅：${state.config.subscription.items.length} 条；目标：${activeSubscription(state.config)?.name || "本地配置"}；运行：${state.running ? activeSubscription(state.appliedConfig)?.name || "本地配置" : "未运行"}`,
          state.apiError ? `控制接口：${state.apiError}` : "",
          state.system.reason ? `系统代理说明：${state.system.reason}` : "",
          state.tun.reason ? `TUN 检测说明：${state.tun.reason}` : "",
          state.lastError ? `近期错误：${state.lastError}` : "",
          state.otherCores?.length
            ? `其他代理核心：${state.otherCores.map(item => `${item.name || "mihomo"}（PID ${item.pid}）`).join("、")}`
            : state.otherCores?.error
              ? `核心进程扫描：${state.otherCores.error}`
              : "",
          "网卡和路由检测不等于出口连通性验证；请使用 #代理测速 检查节点，并在本机验证 DNS 与目标应用。",
          `运行目录：${manager.store.data}`,
        ]
        return reply(output.filter(Boolean).join("\n"))
      }
      if (text === "组") {
        const groups = await manager.nodes()
        return reply(
          groups.length
            ? groups
                .map(group => `${group.name} → ${group.now || "自动"}（${group.all.length} 项）`)
                .join("\n")
            : "没有可用代理组。",
        )
      }
      if (text.startsWith("节点")) {
        const groupName = text.slice(2).trim()
        if (!groupName) return reply("用法：#代理节点 <完整组名>。更多用法见 #节点管理。")
        const group = await manager.nodes(groupName)
        return reply(
          [
            `当前：${group.now || "自动"}`,
            ...group.all.slice(0, 40).map((name, index) => `${index + 1}. ${name}`),
            group.all.length > 40 ? "只显示前 40 项。" : "",
          ]
            .filter(Boolean)
            .join("\n"),
        )
      }
      if (text.startsWith("切换")) {
        const args = splitArgs(text.slice(2).trim())
        if (args.length !== 2)
          return reply('用法：#代理切换 "组名" "节点名或关键词"；名称有空格时使用引号。')
        return reply(`已切换到：${await manager.select(args[0], args[1])}`)
      }
      if (text.startsWith("测速")) {
        const group = text.slice(2).trim()
        if (!group) return reply("用法：#代理测速 <完整组名>")
        await reply("开始测速，最多 100 个节点，并发 6。")
        const result = await manager.speed(group, { includeCurrent: true })
        return await replyReport(e, "speed", speedReport(group, result))
      }
      if (text.startsWith("订阅")) {
        const arg = text.slice(2).trim()
        if (e.isGroup && /https?:\/\//i.test(arg))
          return reply("订阅地址含凭据，请私聊发送或在锅巴填写。")
        if (!arg || arg === "列表") {
          const items = await manager.listSubscriptions()
          return await replyReport(e, "subscriptions", subscriptionReports(items))
        }
        if (/^https?:\/\//i.test(arg) || /^添加\s+/.test(arg)) {
          if (e.isGroup) return reply("订阅地址含凭据，请私聊发送或在锅巴填写。")
          const args = /^添加\s+/.test(arg) ? splitArgs(arg.replace(/^添加\s+/, "")) : [arg]
          if (args.length > 2 || !args.length) return reply('用法：#代理订阅 添加 "名称" <URL>')
          const url = args.at(-1),
            name = args.length === 2 ? args[0] : undefined
          await reply("正在下载并校验订阅。")
          const result = await manager.addSubscription(url, name)
          return reply(
            `订阅已保存：${result.name}${result.active ? "（启用）" : "（备用）"}。${result.applied ? "核心配置已应用。" : result.active ? "使用 #代理核心启动 启动。" : "当前运行配置保持原状。"}`,
          )
        }
        if (/^更新(?:\s|$)/.test(arg) || arg === "更新全部") {
          const key = arg === "更新全部" ? "全部" : arg.replace(/^更新\s*/, "")
          await reply("正在更新并校验订阅。")
          if (!key || key === "全部") {
            const results = await manager.updateAllSubscriptions()
            return reply(
              [
                `更新：成功 ${results.filter(item => item.ok).length}/${results.length}`,
                ...results.map(
                  item =>
                    `${item.name}：${item.ok ? (item.applied ? "已更新并应用" : "已更新缓存") : item.error}`,
                ),
              ].join("\n"),
            )
          }
          const result = await manager.updateSubscription(key)
          return reply(`${result.name} 已更新${result.applied ? "并应用到核心" : "缓存"}。`)
        }
        if (/^(?:切换|切)\s+/.test(arg)) {
          const key = arg.replace(/^(?:切换|切)\s+/, "")
          const result = await manager.selectSubscription(key)
          return reply(
            `已选择：${result.name}。${result.applied ? "核心配置已应用。" : "核心未运行，启动后生效。"}`,
          )
        }
        if (/^改名\s+/.test(arg)) {
          const args = splitArgs(arg.replace(/^改名\s+/, ""))
          if (args.length !== 2) return reply('用法：#代理订阅 改名 "原名称或序号" "新名称"')
          return reply(`已改名为：${await manager.renameSubscription(args[0], args[1])}`)
        }
        if (/^(?:删除|删)\s+/.test(arg))
          return reply(
            `已删除：${await manager.removeSubscription(arg.replace(/^(?:删除|删)\s+/, ""))}`,
          )
        return reply("发送 #代理订阅 查看列表，或发送 #订阅管理 查看帮助图。")
      }
      if (text === "配置检查") {
        await manager.check()
        return reply("mihomo 配置检查通过。")
      }
      if (text === "配置回滚") {
        await manager.rollback()
        return reply("已恢复上一份可用运行配置。")
      }
      if (text.startsWith("配置导入")) {
        if (e.isGroup) return reply("本地配置导入请私聊操作。")
        const file = text
          .slice(4)
          .trim()
          .replace(/^"(.*)"$/, "$1")
        if (!file) return reply("用法：#代理配置导入 <本地 YAML 路径>")
        await manager.importFile(file)
        return reply("配置已校验并启动；原有规则与代理组保留。")
      }
      if (text === "日志") {
        if (e.isGroup) return reply("核心日志请私聊查看。")
        const file = await fs.open(manager.store.paths.log, "r")
        try {
          const size = (await file.stat()).size
          const buffer = Buffer.alloc(Math.min(size, 16384))
          await file.read(buffer, 0, buffer.length, Math.max(0, size - buffer.length))
          return reply(
            redact(buffer.toString().split("\n").slice(-20).join("\n")).slice(-3500) ||
              "日志为空。",
          )
        } finally {
          await file.close()
        }
      }
      return reply("用法见 #代理帮助")
    } catch (error) {
      const message = redact(error.message).slice(0, 1200)
      globalThis.logger?.error?.(`[Proxy-Plugin] ${message}`)
      return reply(`操作失败：${message}`)
    }
  }
}
