import test from "node:test"
import assert from "node:assert/strict"
import express from "express"
import http from "node:http"
import { once } from "node:events"
import { MihomoClient } from "../lib/client.js"
import { ProxyWebServer, WEB_PREFIX } from "../lib/web-server.js"

test("实时日志流跨分块正确脱敏，撤销令牌关闭已有流连接", async t => {
  const upstream = http
    .createServer((req, res) => {
      assert.equal(req.headers.authorization, "Bearer core-secret")
      res.writeHead(200, { "Content-Type": "application/json" })
      const line =
        JSON.stringify({ type: "info", payload: "订阅 https://example.com/?token=secret" }) + "\n"
      const bytes = Buffer.from(line)
      res.write(bytes.subarray(0, 2))
      res.write(bytes.subarray(2))
      const timer = setInterval(() => res.write(line), 30)
      res.on("close", () => clearInterval(timer))
    })
    .listen(0, "127.0.0.1")
  await once(upstream, "listening")
  t.after(() => {
    upstream.closeAllConnections()
    return new Promise(resolve => upstream.close(resolve))
  })
  const web = new ProxyWebServer({
    streamClient: async () => new MihomoClient(upstream.address().port, "core-secret"),
  })
  const app = express()
  web.attach(app)
  const server = app.listen(0, "127.0.0.1")
  await once(server, "listening")
  t.after(() => {
    server.closeAllConnections()
    return new Promise(resolve => server.close(resolve))
  })
  const url = `http://127.0.0.1:${server.address().port}${WEB_PREFIX}/api/stream/logs`
  assert.equal((await fetch(url)).status, 401)
  const session = web.createSession()
  const response = await fetch(url, { headers: { Authorization: `Bearer ${session.token}` } })
  assert.equal(response.status, 200)
  const reader = response.body.getReader()
  const chunk = await reader.read()
  const text = new TextDecoder().decode(chunk.value)
  assert.ok(text.includes("订阅"))
  assert.ok(!text.includes("example.com"))
  web.revoke()
  let done = false
  for (let attempt = 0; attempt < 10 && !done; attempt++) done = (await reader.read()).done
  assert.equal(done, true)
})
