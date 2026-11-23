import path from "node:path"
import { fileURLToPath } from "node:url"
import { redact } from "./storage.js"

const pluginName = path.basename(fileURLToPath(new URL("../", import.meta.url)))
let updating = false

async function createUpdater() {
  const { update: YunzaiUpdate } = await import("../../other/update.js")
  return new YunzaiUpdate()
}

export async function updateProxyPlugin(event, manager, makeUpdater = createUpdater) {
  if (updating) return event.reply("Proxy-Plugin 正在更新，请稍候再试")
  updating = true
  try {
    const updater = await makeUpdater()
    updater.e = event
    if ((await updater.getPlugin(pluginName)) !== pluginName)
      throw new Error("未找到 Proxy-Plugin 的 Git 仓库，请用 git clone 安装后再更新")

    await event.reply("开始更新 Proxy-Plugin 和 mihomo。运行中的代理会暂时断开。")
    let result
    try {
      result = await manager.updateTogether(async () => {
        if (!(await updater.runUpdate(pluginName))) throw new Error("Proxy-Plugin 更新失败")
        if (updater.isPkgUp && (await updater.updatePackage())?.error)
          throw new Error("安装 Proxy-Plugin 更新所需的依赖失败")
        await event.reply("正在更新 mihomo 到最新发布版")
      })
    } catch (error) {
      if (updater.isUp)
        throw new Error(`${redact(error.message)}。插件文件已更新，重启 Yunzai 后加载新代码。`)
      throw error
    }

    await event.reply(`mihomo ${result.version} ${result.running ? "已启动" : "已就绪，核心保持停止"}。`)
    if (updater.isUp) await updater.restart()
    return true
  } finally {
    updating = false
  }
}
