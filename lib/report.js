import { fileURLToPath } from "node:url"
import { activeSubscription } from "./config.js"
import { redact } from "./storage.js"

const tplFile = fileURLToPath(new URL("../resources/report.html", import.meta.url))
const dateTime = new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" })
const byteUnits = ["B", "KiB", "MiB", "GiB", "TiB"]
const subscriptionPageSize = 10

function validBytes(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function formatBytes(value) {
  let unit = 0
  while (value >= 1024 && unit < byteUnits.length - 1) {
    value /= 1024
    unit++
  }
  return `${unit ? value.toFixed(2) : value} ${byteUnits[unit]}`
}

function expirationTime(seconds) {
  if (!validBytes(seconds) || seconds === 0) return ""
  const time = new Date(seconds * 1000)
  return Number.isFinite(time.getTime()) ? dateTime.format(time) : ""
}

function subscriptionRow(item) {
  const { upload, download, total, expire } = item.usage || {}
  const traffic = []
  if (validBytes(upload) && validBytes(download)) traffic.push(`已用 ${formatBytes(upload + download)}`)
  else if (validBytes(upload)) traffic.push(`已上传 ${formatBytes(upload)}`)
  else if (validBytes(download)) traffic.push(`已下载 ${formatBytes(download)}`)
  if (validBytes(total)) traffic.push(`总量 ${formatBytes(total)}`)
  const expires = expirationTime(expire)
  const cached = !item.cached ? "尚未缓存" : item.nodes === null ? "含代理提供者" : `${item.nodes ?? 0} 个节点`
  return {
    number: item.index,
    label: redact(item.name),
    detail: [cached, ...(traffic.length ? [`流量 ${traffic.join(" · ")}`] : []), ...(expires ? [`到期时间 ${expires}`] : [])],
    tags: [
      ...(item.active ? [{ value: "已选中", tone: "info" }] : []),
      ...(item.applied ? [{ value: "运行中", tone: "success" }] : []),
    ],
  }
}

export function subscriptionReports(items) {
  const pages = Math.max(1, Math.ceil(items.length / subscriptionPageSize))
  return Array.from({ length: pages }, (_, index) => ({
    title: "订阅列表",
    subtitle: pages > 1 ? `${items.length} 条订阅 · 第 ${index + 1}/${pages} 页` : `${items.length} 条订阅`,
    panels: [{
      rows: items.slice(index * subscriptionPageSize, (index + 1) * subscriptionPageSize).map(subscriptionRow),
      empty: "还没有订阅。在 WebUI 中添加，或发送 #订阅管理 查看指令。",
    }],
    footer: items.length ? "添加、切换和更新的用法见 #订阅管理" : "",
  }))
}

export function speedReport(group, { current, results }) {
  const available = results.filter(row => Number.isFinite(row.delay) && row.delay > 0)
  const rows = results.slice(0, 10).map(({ name, delay }, index) => {
    const ok = Number.isFinite(delay) && delay > 0
    return {
      number: index + 1,
      label: redact(name),
      value: ok ? `${delay} ms` : "失败",
      tone: !ok || delay >= 500 ? "danger" : delay >= 200 ? "warning" : "success",
      tags: name === current ? [{ value: "当前", tone: "info" }] : [],
    }
  })
  return {
    title: "节点测速",
    subtitle: redact(group),
    metrics: [
      { label: "可用节点", value: `${available.length} / ${results.length}`, tone: available.length ? "success" : "neutral" },
      { label: "最低延迟", value: available.length ? `${available[0].delay} ms` : "—" },
    ],
    note: current ? `组内当前 · ${redact(current)}` : "",
    panels: [{
      title: results.length > rows.length ? `延迟排序 · 显示前 ${rows.length} 项` : "测速结果",
      rows,
      empty: "该组没有可测速的节点。",
    }],
    footer: "测速不会改变节点选择。",
  }
}

function detection(value) {
  return value === true ? "已检测到" : value === false ? "未检测到" : "未能检测"
}

export function statusReport(state, labels) {
  const { config, running, applied, appliedConfig, runtime, system, tun } = state
  const takeover = applied || "off"
  const mode = runtime?.mode || appliedConfig?.mode || config.mode
  const expected = activeSubscription(config)?.name || "本地配置"
  const used = running ? activeSubscription(appliedConfig)?.name || "本地配置" : "核心未运行"
  const systemStatus = system.conflict ? "存在冲突" : system.owned ? "本插件接管" : "本插件未接管"
  const tunVerified = tun.interface === true && tun.routes === true
  const takeoverVerified = takeover === "system" ? system.owned && !system.conflict : takeover === "tun" && tunVerified
  const showTun = takeover === "tun" || config.takeover === "tun" || tun.interface === true
  const notices = [
    ["控制接口", state.apiError],
    ["系统代理", system.reason],
    ["TUN 检测", showTun ? tun.reason : ""],
    ["近期错误", state.lastError],
    ["其他代理核心", Array.isArray(state.otherCores) && state.otherCores.length
      ? state.otherCores.map(item => `${item.name || "mihomo"}（PID ${item.pid}）`).join("、")
      : ""],
    ["核心进程扫描", state.otherCores?.error],
  ].filter(([, value]) => value).map(([label, value]) => ({ label, detail: [redact(value).slice(0, 600)] }))

  return {
    title: "代理状态",
    subtitle: `${state.platform}${state.version?.version ? ` · mihomo ${state.version.version}` : ""}`,
    metrics: [
      { label: "核心进程", value: running ? "运行中" : "未运行", tone: running ? "success" : "neutral" },
      { label: "已应用接管", value: labels[takeover], tone: takeoverVerified ? "success" : takeover === "off" ? "neutral" : "warning" },
      { label: "路由模式", value: labels[mode], tone: running ? "info" : "neutral" },
    ],
    note: running && takeover === "off" ? "核心已启动，系统流量尚未由本插件接管。" : "",
    panels: [
      {
        title: "接管与端口",
        rows: [
          { label: "目标接管", value: labels[config.takeover] },
          { label: "系统代理", value: systemStatus, tone: system.conflict ? "danger" : system.owned ? "success" : undefined },
          ...(typeof system.enabled === "boolean" ? [{ label: "系统代理开关", value: system.enabled ? "开启" : "关闭" }] : []),
          ...(showTun ? [
            { label: "TUN 网卡", value: detection(tun.interface) },
            { label: "TUN 路由", value: detection(tun.routes) },
          ] : []),
          { label: "代理端口", value: String(runtime?.["mixed-port"] ?? appliedConfig?.core.mixedPort ?? config.core.mixedPort) },
          { label: "控制端口", value: String(appliedConfig?.core.controllerPort ?? config.core.controllerPort) },
        ],
      },
      {
        title: "订阅",
        rows: [
          { label: "正在使用", value: redact(used), tone: running ? "info" : undefined },
          ...(expected !== used ? [{ label: "已选配置", value: redact(expected) }] : []),
        ],
      },
      ...(notices.length ? [{ title: "需要检查", rows: notices }] : []),
    ],
    footer: "详细原因可用 #代理诊断 查看。",
  }
}

function reportText(report) {
  const rows = (report.panels || []).flatMap(panel => [
    panel.title,
    ...(panel.rows.length ? panel.rows.map(row => [
      [...(row.number ? [`${row.number}.`] : []), row.label, ...(row.tags || []).map(tag => `（${tag.value}）`)].join(" "),
      row.value,
      ...(row.detail || []),
    ].filter(Boolean).join(" · ")) : [panel.empty]),
  ])
  return [
    report.title,
    report.subtitle,
    ...(report.metrics || []).map(item => `${item.label}：${item.value}`),
    report.note,
    ...rows,
    report.footer,
  ].filter(Boolean).join("\n")
}

export async function replyReport(event, kind, reports) {
  const pages = Array.isArray(reports) ? reports : [reports]
  const renderer = event.runtime?.puppeteer
  if (renderer) {
    try {
      const images = []
      for (const [index, report] of pages.entries()) {
        const image = await renderer.screenshot(`Proxy-Plugin/report/${kind}`, {
          tplFile,
          saveId: `page-${index + 1}`,
          imgType: "png",
          ...report,
        })
        if (!image) break
        images.push(image)
      }
      if (images.length === pages.length) return event.reply(images.length === 1 ? images[0] : images)
    } catch (error) {
      globalThis.logger?.warn?.(`[Proxy-Plugin] 结果图渲染失败：${redact(error.message)}`)
    }
  }
  return event.reply(pages.map(reportText).join("\n\n"))
}
