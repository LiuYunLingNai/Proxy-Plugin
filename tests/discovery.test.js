import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { scanLinuxCoreProcesses } from "../lib/process.js"
import { tempRoot } from "./helpers.js"

test("Linux /proc 扫描识别核心、排除桌面客户端并容忍进程退出", async t => {
  const root = await tempRoot(t)
  for (const [pid, name] of [
    [101, "mihomo"],
    [102, "node"],
    [103, "clash-meta"],
    [104, "mihomo-party"],
  ]) {
    await fs.mkdir(path.join(root, String(pid)))
    await fs.writeFile(path.join(root, String(pid), "comm"), name + "\n")
  }
  await fs.mkdir(path.join(root, "105"))
  await fs.mkdir(path.join(root, "not-a-pid"))
  const result = await scanLinuxCoreProcesses(root)
  assert.deepEqual(
    result.map(item => [item.pid, item.name]),
    [
      [101, "mihomo"],
      [103, "clash-meta"],
    ],
  )
})
