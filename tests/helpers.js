import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"

export async function tempRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "proxy-plugin-test-"))
  t.after(async () => {
    const resolved = path.resolve(root)
    if (
      path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
      !path.basename(resolved).startsWith("proxy-plugin-test-")
    )
      throw new Error("拒绝清理测试目录之外的路径")
    await fs.rm(resolved, { recursive: true, force: true })
  })
  return root
}

export function fakePlatform(
  initial = { flags: 1, server: "previous:8080", bypass: "localhost", pac: "" },
) {
  const platform = {
    value: structuredClone(initial),
    writes: 0,
    failWrite: false,
    tun: { interface: true, routes: true },
    async system() {
      return {
        context: "test:user",
        read: async () => structuredClone(platform.value),
        desired: config => ({
          flags: 3,
          server: `127.0.0.1:${config.core.mixedPort}`,
          bypass: config.system.bypass,
          pac: "",
        }),
        write: async value => {
          platform.writes++
          if (platform.failWrite) {
            platform.failWrite = false
            platform.value.server = value.server
            throw new Error("模拟部分写入失败")
          }
          platform.value = structuredClone(value)
        },
      }
    },
    async checkTun() {},
    async inspectTun() {
      return platform.tun
    },
  }
  return platform
}
