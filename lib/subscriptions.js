import fs from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"
import { atomicWrite, readJson, writeJson } from "./storage.js"
import { parseProfile } from "./profile.js"

const fingerprint = entry => {
  const hash = crypto.createHash("sha256").update(entry.url)
  if (entry.userAgent) hash.update("\0" + entry.userAgent)
  return hash.digest("hex")
}
async function textOrNull(file) {
  try {
    return await fs.readFile(file, "utf8")
  } catch (error) {
    if (error.code === "ENOENT") return null
    throw error
  }
}

export class SubscriptionCache {
  constructor(store) {
    this.directory = path.join(store.data, "profiles", "subscriptions")
    this.index = path.join(this.directory, "index.json")
  }
  file(entry) {
    if (!/^[a-f0-9]{20}$/.test(entry.id)) throw new Error("订阅缓存标识无效")
    return path.join(this.directory, entry.id + ".yaml")
  }
  async metadata(entry) {
    const record = (await readJson(this.index, {}))[entry.id]
    return record?.fingerprint === fingerprint(entry) ? record : null
  }
  async metadataList(entries) {
    const index = await readJson(this.index, {})
    return entries.map(entry => {
      const record = index[entry.id]
      return record?.fingerprint === fingerprint(entry) ? record : null
    })
  }
  async cached(entry) {
    return (await this.metadata(entry)) ? textOrNull(this.file(entry)) : null
  }
  async snapshot(entry) {
    return {
      text: await textOrNull(this.file(entry)),
      record: (await readJson(this.index, {}))[entry.id] || null,
    }
  }
  async save(entry, text, { updated = true, usage } = {}) {
    const profile = parseProfile(text)
    const index = await readJson(this.index, {})
    const hash = fingerprint(entry)
    const previous = index[entry.id]?.fingerprint === hash ? index[entry.id] : null
    const record = {
      fingerprint: hash,
      updatedAt: !updated && previous ? previous.updatedAt : Date.now(),
      nodes: Array.isArray(profile.proxies) ? profile.proxies.length : null,
      usage: updated ? usage : previous?.usage,
    }
    await atomicWrite(this.file(entry), text)
    index[entry.id] = record
    await writeJson(this.index, index)
    return record
  }
  async restore(entry, snapshot) {
    const index = await readJson(this.index, {})
    if (snapshot.text === null)
      await fs.unlink(this.file(entry)).catch(error => {
        if (error.code !== "ENOENT") throw error
      })
    else await atomicWrite(this.file(entry), snapshot.text)
    if (snapshot.record) index[entry.id] = snapshot.record
    else delete index[entry.id]
    await writeJson(this.index, index)
  }
  async remove(entry) {
    return this.restore(entry, { text: null, record: null })
  }
}
