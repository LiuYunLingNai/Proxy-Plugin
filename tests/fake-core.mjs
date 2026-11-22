import http from "node:http"
import fs from "node:fs"
import YAML from "yaml"

const file = process.argv[process.argv.indexOf("-f") + 1]
let config = YAML.parse(fs.readFileSync(file, "utf8"))
if (config.__failStart) process.exit(12)
const selectedNodes = { Test: "A", Auto: "A" }
const controller = http.createServer(async (request, response) => {
  if (request.headers.authorization !== `Bearer ${config.secret}`) {
    response.writeHead(401)
    response.end()
    return
  }
  let body = ""
  for await (const chunk of request) body += chunk
  const url = new URL(request.url, "http://localhost")
  let result
  if (url.pathname === "/version") result = { version: "fake-core", meta: true }
  else if (url.pathname === "/configs") {
    if (request.method === "PUT") {
      const next = YAML.parse(fs.readFileSync(JSON.parse(body).path, "utf8"))
      if (next.__failReload) {
        response.writeHead(400)
        response.end()
        return
      }
      config = next
    }
    if (request.method === "PATCH") Object.assign(config, JSON.parse(body))
    result = config
  } else if (url.pathname === "/proxies")
    result = {
      proxies: {
        Test: {
          name: "Test",
          type: "Selector",
          now: selectedNodes.Test,
          all: ["A", "B", "ProviderNode"],
        },
        Auto: {
          name: "Auto",
          type: "URLTest",
          now: selectedNodes.Auto,
          all: ["A", "ProviderNode"],
        },
        A: { name: "A", type: "ss" },
        B: { name: "B", type: "ss" },
      },
    }
  else if (
    url.pathname.startsWith("/proxies/") &&
    request.method === "GET" &&
    !url.pathname.endsWith("/delay")
  ) {
    const name = decodeURIComponent(url.pathname.slice("/proxies/".length))
    if (name === "Test" || name === "Auto")
      result = {
        name,
        type: name === "Test" ? "Selector" : "URLTest",
        now: selectedNodes[name],
        all: ["A", "B", "ProviderNode"],
      }
    else {
      response.writeHead(404)
      response.end()
      return
    }
  } else if (url.pathname === "/connections" && request.method === "GET")
    result = {
      uploadTotal: 1024,
      downloadTotal: 4096,
      connections: [
        {
          id: "connection-test",
          upload: 512,
          download: 1024,
          chains: ["Test", "A"],
          metadata: {
            host: "example.com",
            destinationPort: "443",
            network: "tcp",
            process: "browser",
            processPath: "private-path",
            uid: "private",
          },
        },
      ],
    }
  else if (url.pathname.startsWith("/connections") && request.method === "DELETE") result = null
  else if (url.pathname === "/providers/proxies")
    result = {
      providers: {
        airport: {
          name: "airport",
          vehicleType: "HTTP",
          proxies: [
            { name: "ProviderNode", type: "ss", password: "private", history: [{ delay: 42 }] },
          ],
          subscriptionInfo: { Upload: 1, Download: 2, Total: 1000, Expire: 0 },
          url: "https://secret.example",
        },
      },
    }
  else if (url.pathname === "/providers/rules")
    result = {
      providers: {
        local: {
          name: "local",
          vehicleType: "HTTP",
          behavior: "domain",
          ruleCount: 12,
          url: "private",
        },
      },
    }
  else if (url.pathname.startsWith("/providers/") && request.method === "PUT") result = null
  else if (url.pathname.endsWith("/healthcheck"))
    result = url.pathname.includes("ProviderNode") ? { delay: 42 } : null
  else if (url.pathname.startsWith("/group/") && url.pathname.endsWith("/delay"))
    result = { A: 25, ProviderNode: 42 }
  else if (url.pathname === "/rules")
    result = {
      rules: [
        {
          index: 0,
          type: "DOMAIN",
          payload: "example.com",
          proxy: "DIRECT",
          extra: { disabled: false, hitCount: 3, missCount: 0 },
        },
      ],
    }
  else if (url.pathname === "/rules/disable" && request.method === "PATCH") result = null
  else if (url.pathname === "/dns/query")
    result = {
      Status: 0,
      Answer: [{ name: url.searchParams.get("name"), data: "1.2.3.4", TTL: 60 }],
    }
  else if (url.pathname.startsWith("/cache/") || url.pathname === "/configs/geo") result = null
  else if (url.pathname === "/traffic" || url.pathname === "/memory" || url.pathname === "/logs") {
    response.setHeader("Content-Type", "application/json")
    const timer = setInterval(
      () =>
        response.write(
          JSON.stringify(
            url.pathname === "/traffic"
              ? { up: 1024, down: 2048, upTotal: 4096, downTotal: 8192 }
              : url.pathname === "/memory"
                ? { inuse: 10240 }
                : { type: "info", payload: "https://secret.example/?token=private" },
          ) + "\n",
        ),
      50,
    )
    request.on("close", () => clearInterval(timer))
    return
  } else if (url.pathname.endsWith("/delay")) result = { delay: 25 }
  else if (url.pathname.startsWith("/proxies/") && request.method === "DELETE") result = null
  else if (url.pathname.startsWith("/proxies/") && request.method === "PUT") {
    selectedNodes[decodeURIComponent(url.pathname.slice("/proxies/".length))] =
      JSON.parse(body).name
    result = null
  } else {
    response.writeHead(404)
    response.end()
    return
  }
  response.setHeader("Content-Type", "application/json")
  response.end(JSON.stringify(result))
})
const mixed = http.createServer((req, res) => res.end("fake proxy"))
controller.listen(Number(config["external-controller"].split(":").at(-1)), "127.0.0.1")
mixed.listen(config["mixed-port"], "127.0.0.1")
