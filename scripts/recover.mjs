import { ConfigStore } from "../lib/config.js"
import { ProxyManager } from "../lib/manager.js"

// 在机器人根目录运行：node plugins/Proxy-Plugin/scripts/recover.mjs
const rootIndex = process.argv.indexOf("--root")
const store = new ConfigStore(rootIndex < 0 ? process.cwd() : process.argv[rootIndex + 1])
const manager = new ProxyManager({ store })
try {
  await manager.initialize()
  await manager.stop()
  console.log("本插件系统代理已恢复，核心已停止。请检查 TUN 网卡和路由是否已释放。")
} catch (error) {
  console.error(`恢复失败：${error.message}`)
  process.exitCode = 1
}
