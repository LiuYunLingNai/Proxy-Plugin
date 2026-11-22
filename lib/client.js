export class MihomoClient {
  constructor(port, secret) {
    this.base = `http://127.0.0.1:${port}`
    this.secret = secret
  }
  async request(route, { method = "GET", body, timeout = 5000 } = {}) {
    const response = await fetch(this.base + route, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(timeout),
      headers: {
        Authorization: `Bearer ${this.secret}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!response.ok) {
      const suffix =
        response.status === 404 || response.status === 405 ? "，当前核心版本可能不支持此功能" : ""
      throw new Error(`mihomo 接口 ${route.split("?")[0]} 返回 HTTP ${response.status}${suffix}`)
    }
    const text = await response.text()
    return text ? JSON.parse(text) : null
  }
  version() {
    return this.request("/version", { timeout: 1500 })
  }
  configs() {
    return this.request("/configs")
  }
  reload(file) {
    return this.request("/configs?force=true", {
      method: "PUT",
      body: { path: file },
      timeout: 30000,
    })
  }
  proxyProviders() {
    return this.request("/providers/proxies")
  }
  ruleProviders() {
    return this.request("/providers/rules")
  }
  updateProvider(kind, name) {
    return this.request(`/providers/${kind}/${encodeURIComponent(name)}`, {
      method: "PUT",
      timeout: 60000,
    })
  }
  healthProvider(name) {
    return this.request(`/providers/proxies/${encodeURIComponent(name)}/healthcheck`, {
      timeout: 60000,
    })
  }
  groupDelay(name, url, timeout) {
    return this.request(
      `/group/${encodeURIComponent(name)}/delay?url=${encodeURIComponent(url)}&timeout=${timeout}`,
      { timeout: timeout + 5000 },
    )
  }
  providerDelay(provider, name, url, timeout) {
    return this.request(
      `/providers/proxies/${encodeURIComponent(provider)}/${encodeURIComponent(name)}/healthcheck?url=${encodeURIComponent(url)}&timeout=${timeout}`,
      { timeout: timeout + 2000 },
    )
  }
  unfixGroup(name) {
    return this.request(`/proxies/${encodeURIComponent(name)}`, { method: "DELETE" })
  }
  runtimeRules() {
    return this.request("/rules")
  }
  disableRule(index, disabled) {
    return this.request("/rules/disable", { method: "PATCH", body: { [index]: disabled } })
  }
  dnsQuery(name, type) {
    return this.request(
      `/dns/query?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`,
      { timeout: 15000 },
    )
  }
  flushCache(kind) {
    return this.request(`/cache/${kind}/flush`, { method: "POST" })
  }
  updateGeo() {
    return this.request("/configs/geo", { method: "POST", timeout: 120000 })
  }
  async stream(channel, signal, level = "info") {
    const routes = { traffic: "/traffic", memory: "/memory", logs: `/logs?level=${level}` }
    if (!Object.hasOwn(routes, channel)) throw new Error("未知数据流")
    const response = await fetch(this.base + routes[channel], {
      signal,
      headers: { Authorization: `Bearer ${this.secret}` },
      redirect: "error",
    })
    if (!response.ok) throw new Error(`mihomo 数据流返回 HTTP ${response.status}`)
    return response
  }
  proxies() {
    return this.request("/proxies")
  }
  proxy(name) {
    return this.request(`/proxies/${encodeURIComponent(name)}`)
  }
  connections() {
    return this.request("/connections")
  }
  closeConnection(id) {
    return this.request(`/connections/${encodeURIComponent(id)}`, { method: "DELETE" })
  }
  closeAllConnections() {
    return this.request("/connections", { method: "DELETE" })
  }
  mode(mode) {
    return this.request("/configs", { method: "PATCH", body: { mode } })
  }
  select(group, name) {
    return this.request(`/proxies/${encodeURIComponent(group)}`, { method: "PUT", body: { name } })
  }
  delay(name, timeout = 5000, url = "https://www.gstatic.com/generate_204") {
    return this.request(
      `/proxies/${encodeURIComponent(name)}/delay?timeout=${timeout}&url=${encodeURIComponent(url)}`,
      { timeout: timeout + 2000 },
    )
  }
}
