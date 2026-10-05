import assert from "node:assert/strict"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { after, before, test } from "node:test"

import { createZigbeeClient } from "./zigbee-client"

let server: Server
let baseUrl: string
let reply: { status: number; body: unknown; hang?: boolean } = { status: 200, body: {} }
let lastRequest: { method?: string; url?: string; body: string } = { body: "" }

before(async () => {
  server = createServer(async (req, res) => {
    let body = ""
    for await (const chunk of req) body += chunk
    lastRequest = { method: req.method, url: req.url, body }
    if (reply.hang) return
    res.writeHead(reply.status, { "content-type": "application/json" })
    res.end(JSON.stringify(reply.body))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

after(() => {
  server.closeAllConnections()
  server.close()
})

test("parses successful responses with the shared schemas", async () => {
  reply = { status: 200, body: { locked: false, updatedAt: "2026-10-02T10:00:00.000Z" } }
  assert.deepEqual(await createZigbeeClient(baseUrl).status(), {
    ok: true,
    data: { locked: false, updatedAt: "2026-10-02T10:00:00.000Z" },
  })
})

test("sends the request the route expects", async () => {
  reply = { status: 200, body: { user: { id: 3, name: "Bia", hasTotp: true, hasRfid: false, createdAt: "2026-10-02T10:00:00.000Z", syncedAt: null } } }
  await createZigbeeClient(baseUrl).renameUser(3, "Bia")
  assert.deepEqual(lastRequest, { method: "PATCH", url: "/users/3", body: JSON.stringify({ name: "Bia" }) })
})

test("maps HTTP errors to typed errors", async () => {
  const client = createZigbeeClient(baseUrl)
  const cases: [number, string][] = [
    [400, "invalid"],
    [404, "not-found"],
    [409, "slot-in-use"],
    [503, "lock-unreachable"],
    [504, "lock-timeout"],
    [500, "internal"],
  ]
  for (const [status, error] of cases) {
    reply = { status, body: { error: "x" } }
    assert.deepEqual(await client.unlock(), { ok: false, error }, `HTTP ${status}`)
  }
})

test("reports service-down when apps/zigbee is not listening", async () => {
  const closed = createServer()
  await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve))
  const { port } = closed.address() as AddressInfo
  await new Promise((resolve) => closed.close(resolve))
  assert.deepEqual(await createZigbeeClient(`http://127.0.0.1:${port}`).health(), {
    ok: false,
    error: "service-down",
  })
})

test("reports service-down when apps/zigbee hangs past the timeout", async () => {
  reply = { status: 200, body: {}, hang: true }
  assert.deepEqual(await createZigbeeClient(baseUrl, 50).status(), { ok: false, error: "service-down" })
})
