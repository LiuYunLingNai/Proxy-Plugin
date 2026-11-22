import { fileURLToPath } from "node:url"

const tplFile = fileURLToPath(new URL("../resources/help.html", import.meta.url))

const pages = {
  "#代理帮助": {
    id: "overview",
    title: "代理指令帮助",
    guide: "部署核心 → 添加订阅 → 开启系统代理或 TUN",
    sections: [
      {
        title: "分类帮助",
        primary: true,
        rows: [
          ["#节点管理", "代理组、节点切换与测速"],
          ["#订阅管理", "添加、切换和更新订阅"],
        ],
      },
      {
        title: "核心与接管",
        rows: [
          ["#代理部署", "下载缺失的 mihomo 并启动"],
          ["#代理核心重启", "应用已保存的核心设置"],
          ["#代理接管 系统 / tun / 关闭", "选择一种接管方式"],
          ["#代理模式 规则 / 全局 / 直连", "选择一种路由模式"],
        ],
      },
      {
        title: "面板与排障",
        rows: [
          ["#代理web [有效分钟]", "获取 WebUI 临时链接"],
          ["#代理状态", "查看核心和接管状态"],
          ["#代理诊断", "排查系统代理和核心冲突"],
          ["#代理恢复", "停止核心并恢复系统代理"],
        ],
      },
    ],
    footer: "仅主人可用。完整指令见项目 README。",
  },
  "#节点管理": {
    id: "nodes",
    title: "节点管理",
    guide: "先看代理组，再选节点。规则模式下，以连接实际匹配的代理组为准。",
    sections: [
      {
        title: "查看与切换",
        rows: [
          ["#代理组", "列出代理组和当前选择"],
          ["#代理节点 <完整组名>", "查看指定组里的节点"],
          ['#代理切换 "组名" "节点名或关键词"', "关键词需要唯一匹配"],
        ],
      },
      {
        title: "测速",
        rows: [
          ["#代理测速 <完整组名>", "测延迟，保留节点选择"],
          ["#代理web", "在 WebUI 中单独测某个节点"],
        ],
      },
    ],
    footer: "仅主人可用。全局模式请在 GLOBAL 组切换。",
  },
  "#订阅管理": {
    id: "subscriptions",
    title: "订阅管理",
    guide: "可保存多份 mihomo YAML 订阅，同一时间使用一份。添加链接请私聊。",
    sections: [
      {
        title: "查看与切换",
        rows: [
          ["#代理订阅", "查看订阅列表和运行状态"],
          ['#代理订阅 添加 "名称" <URL>', "下载、校验并保存订阅"],
          ["#代理订阅 切换 <名称或序号>", "启用指定订阅"],
        ],
      },
      {
        title: "更新与整理",
        rows: [
          ["#代理订阅 更新 <名称或序号>", "刷新指定订阅"],
          ["#代理订阅 更新全部", "刷新所有已保存订阅"],
          ['#代理订阅 改名 "原名称或序号" "新名称"', "修改显示名称"],
          ["#代理订阅 删除 <名称或序号>", "在用时先切换或停止核心"],
        ],
      },
    ],
    footer: "可在 WebUI 编辑订阅地址、User-Agent 和更新周期。",
  },
}

export const helpPattern = `^(?:${Object.keys(pages).join("|")})$`

export function isHelpCommand(command) {
  return Object.hasOwn(pages, command)
}

export async function renderHelp(command, runtime) {
  const page = pages[command]
  const image = await runtime?.puppeteer?.screenshot(`Proxy-Plugin/help/${page.id}`, {
    tplFile,
    imgType: "png",
    ...page,
  })
  if (!image) throw new Error("帮助图渲染失败，请检查 Yunzai 渲染器")
  return image
}
