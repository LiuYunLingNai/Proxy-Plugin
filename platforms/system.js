import fs from "node:fs/promises"
import { isDeepStrictEqual } from "node:util"
import { readJson, writeJson } from "../lib/storage.js"

const equal = isDeepStrictEqual

export class SystemProxy {
  constructor(file, platform) {
    this.file = file
    this.platform = platform
  }

  async enable(config) {
    const existing = await readJson(this.file)
    const adapter = await this.platform.system(config)
    const current = await adapter.read()
    if (existing && existing.context !== adapter.context)
      throw new Error("原代理记录属于其他用户或桌面会话，请在原会话恢复")
    if (existing && !equal(current, existing.applied))
      throw new Error("系统代理已被其他程序修改，请先执行 #代理恢复 或手动解决冲突")
    const before = existing?.before || current
    const applied = adapter.desired(config)
    // 在首次写入前落盘，部分写入或进程被终止后仍能恢复已写入的字段。
    await writeJson(this.file, { context: adapter.context, before, applied, pending: true })
    try {
      await adapter.write(applied)
      const actual = await adapter.read()
      if (!equal(actual, applied))
        throw new Error("系统代理设置未生效，请检查用户会话和桌面设置权限")
      await writeJson(this.file, { context: adapter.context, before, applied, pending: false })
    } catch (error) {
      const recovery = await this.restore(config).catch(err => ({
        conflicts: [`恢复失败：${err.message}`],
      }))
      throw new Error(
        `${error.message}${recovery.conflicts?.length ? `；${recovery.conflicts.join("；")}` : "；已撤销本次写入"}`,
      )
    }
  }

  async restore(config) {
    const record = await readJson(this.file)
    if (!record) return { restored: false, conflicts: [] }
    const adapter = await this.platform.system(config)
    if (record.context !== adapter.context)
      throw new Error("恢复记录属于其他用户或桌面会话，请在原会话执行恢复")
    const current = await adapter.read()
    const alreadyRestored = equal(current, record.before)
    // 开关、地址和 PAC 是一个整体；不能在地址已被第三方修改时单独恢复开关。
    const conflicts = alreadyRestored
      ? []
      : Object.keys(record.applied).filter(
          key =>
            !equal(current[key], record.applied[key]) &&
            (!record.pending || !equal(current[key], record.before[key])),
        )
    if (conflicts.length) return { restored: false, conflicts }
    if (!alreadyRestored) {
      await adapter.write(record.before)
      if (!equal(await adapter.read(), record.before))
        throw new Error("原代理设置未能完整恢复，保留恢复记录")
    }
    await fs.unlink(this.file)
    return { restored: true, conflicts: [] }
  }

  async status(config) {
    const record = await readJson(this.file)
    const adapter = await this.platform.system(config)
    const current = await adapter.read()
    const enabled = adapter.enabled ? adapter.enabled(current) : null
    if (!record) return { owned: false, enabled, pending: false }
    if (record.context !== adapter.context)
      return { owned: false, conflict: true, reason: "用户会话不匹配" }
    const owned = Object.entries(record.applied).every(([key, value]) => equal(current[key], value))
    return { owned, enabled, conflict: !owned, pending: record.pending === true }
  }
}
