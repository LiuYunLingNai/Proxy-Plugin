import { getManager } from "./lib/manager.js"
import { createWebActions } from "./lib/web-actions.js"

const fields = [
  ["webui.enabled", "启用 WebUI", "Switch", "保存后重启云崽生效；关闭后不提供 WebUI 服务。"],
  ["webui.mountToYunzai", "挂载到云崽 HTTP 服务", "Switch", "开启时使用云崽端口及 /proxy-plugin/ 路径；关闭时使用独立监听地址和端口。"],
  ["webui.host", "WebUI 独立监听地址", "Input", "默认 127.0.0.1；局域网访问可设为 0.0.0.0。仅独立模式生效。"],
  ["webui.port", "WebUI 独立端口", "InputNumber", "默认 19100，范围 1024–65535；挂载模式使用云崽端口。保存后重启云崽生效。"],
  ["webui.publicUrl", "WebUI 访问地址", "Input", "可选，如 http://192.168.1.10:19100；用于生成访问链接，不含 /proxy-plugin/ 和令牌。留空自动生成。"],
  ["core.path", "核心路径", "Input", "留空自动下载；也可填写已有 mihomo 的绝对路径。"],
  ["core.version", "下载版本", "Input", "latest 或版本标签；已有核心不会自动覆盖升级。"],
  [
    "download.mirrors",
    "GitHub 下载源",
    "Select",
    "按选中顺序尝试，可新增自定义 HTTPS 前缀。优先镜像时移除直连，再把直连选在最后作为备用。",
  ],
  ["download.timeoutSeconds", "下载超时（秒）", "InputNumber", "单次核心下载超时，5–300 秒。"],
  ["core.mixedPort", "代理端口", "InputNumber", "默认 17890；仅监听本机。"],
  ["core.controllerPort", "控制端口", "InputNumber", "默认 19090；仅监听本机并使用独立密钥。"],
  ["core.autoStart", "加载后自动启动", "Switch", "首次部署建议关闭，手动验证后再开启。"],
  [
    "core.windowsElevate",
    "Windows 核心 UAC 提权",
    "Switch",
    "用于 TUN，启停核心可能需要在本机确认 UAC。",
  ],
  [
    "takeover",
    "接管方式",
    "Select",
    "系统代理与 TUN 分开实现。",
    [
      ["off", "关闭"],
      ["system", "系统代理"],
      ["tun", "TUN"],
    ],
  ],
  [
    "mode",
    "路由模式",
    "Select",
    "全局模式的节点在 GLOBAL 代理组选择。",
    [
      ["rule", "规则"],
      ["global", "全局"],
      ["direct", "直连"],
    ],
  ],
  [
    "tun.stack",
    "TUN 协议栈",
    "Select",
    "默认 system。",
    [
      ["system", "system"],
      ["gvisor", "gvisor"],
      ["mixed", "mixed"],
    ],
  ],
  ["tun.strictRoute", "TUN 严格路由", "Switch", "开启前请确认本机网络和虚拟化环境兼容。"],
  [
    "system.linuxDesktop",
    "Linux 桌面环境",
    "Select",
    "云崽须运行在目标桌面用户会话；无桌面请用 TUN。",
    [
      ["auto", "自动"],
      ["gnome", "GNOME"],
      ["kde", "KDE"],
    ],
  ],
  ["system.bypass", "系统代理绕过列表", "Input", "用分号或逗号分隔。"],
  [
    "subscription.items",
    "mihomo YAML 订阅列表",
    "GSubForm",
    "点击打开列表，可新增、编辑和删除多条订阅。勾选一条作为当前配置，其他条目独立缓存；首次添加默认启用第一条。",
  ],
  [
    "subscription.autoUpdateHours",
    "订阅更新周期（小时）",
    "InputNumber",
    "0 关闭；逐条更新过期订阅，仅更新当前启用项时应用到核心。",
  ],
  ["health.restartAttempts", "核心异常重试次数", "InputNumber", "0–5 次；云崽存活时检测。"],
  ["subscription.userAgent", "订阅默认 User-Agent", "Input", "未设置独立 User-Agent 的订阅使用此值。"],
]
const editable = new Set(fields.map(field => field[0]))

export function supportGuoba() {
  const actions = createWebActions()
  return {
    pluginInfo: {
      name: "Proxy-Plugin",
      title: "Proxy-Plugin",
      description: "mihomo 系统代理与 TUN 管理",
      author: "本地插件",
      isV3: true,
      isV2: false,
      icon: "mdi:lan-connect",
    },
    configInfo: {
      schemas: fields.map(([field, label, component, bottomHelpMessage, choices]) => ({
        field,
        label,
        component,
        bottomHelpMessage,
        componentProps:
          field === "subscription.items"
            ? {
                multiple: true,
                modalProps: { title: "编辑订阅" },
                listModalProps: { title: "订阅管理" },
                schemas: [
                  { field: "id", component: "Input", show: false },
                  {
                    field: "name",
                    label: "订阅名称",
                    component: "Input",
                    required: true,
                    componentProps: { maxlength: 64 },
                    bottomHelpMessage: "名称不能重复。",
                  },
                  {
                    field: "url",
                    label: "订阅地址",
                    component: "Input",
                    required: true,
                    componentProps: { type: "password", placeholder: "https://…" },
                  },
                  {
                    field: "userAgent",
                    label: "请求 User-Agent",
                    component: "Input",
                    componentProps: { maxlength: 256 },
                    bottomHelpMessage: "留空使用全局 User-Agent。",
                  },
                  {
                    field: "autoUpdateHours",
                    label: "独立更新周期（小时）",
                    component: "InputNumber",
                    componentProps: { min: 0, max: 8760 },
                    bottomHelpMessage: "留空使用全局周期，0 关闭自动更新。",
                  },
                  {
                    field: "active",
                    label: "使用这份配置",
                    component: "Switch",
                    defaultValue: false,
                    bottomHelpMessage:
                      "一次启用一条，保留它的规则和代理组；切换前取消原条目的开关。保存后用 #代理核心重启 应用。",
                  },
                ],
              }
            : field === "download.mirrors"
              ? {
                  mode: "tags",
                  options: [
                    { value: "", label: "GitHub 直连" },
                    { value: "https://gh-proxy.com/", label: "gh-proxy.com" },
                    { value: "https://ghfast.top/", label: "ghfast.top" },
                  ],
                }
              : choices
                ? { options: choices.map(([value, label]) => ({ value, label })) }
                : {},
      })),
      actions,
      getConfigData() {
        return getManager().store.load()
      },
      async setConfigData(data, { Result }) {
        try {
          await getManager().queue.run(async () => {
            const store = getManager().store
            const config = await store.load()
            for (const [field, value] of Object.entries(data)) {
              if (!editable.has(field)) continue
              const keys = field.split(".")
              let current = config
              for (const key of keys.slice(0, -1)) current = current[key]
              current[keys.at(-1)] = value
            }
            await getManager().saveSettings(config)
          })
          return Result.ok({}, "已保存；WebUI 服务设置重启云崽生效，核心运行设置使用 #代理核心重启 应用。")
        } catch (error) {
          return Result.error(error.message)
        }
      },
    },
  }
}
