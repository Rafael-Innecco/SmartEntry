import assert from "node:assert/strict"
import type { AddressInfo } from "node:net"
import { afterEach, beforeEach, describe, test } from "node:test"

import { createDb, listUsers, type SmartEntryDb } from "@workspace/db"
import {
  accessLogResponseSchema,
  healthResponseSchema,
  registerUserResponseSchema,
  renameUserResponseSchema,
  statusResponseSchema,
  syncResponseSchema,
  usersResponseSchema,
} from "@workspace/shared"

import { createApp } from "./app.js"
import { createFakeLockTransport, type FakeLockTransport } from "./fake-lock-transport.js"

const LOCK_TIMEOUT_MS = 100

let db: SmartEntryDb
let lock: FakeLockTransport
let baseUrl: string
let close: () => Promise<void>

beforeEach(async () => {
  db = createDb(":memory:")
  lock = createFakeLockTransport()
  const { server } = createApp({ db, lock, lockTimeoutMs: LOCK_TIMEOUT_MS })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  close = () => new Promise((resolve) => server.close(() => resolve()))
})

afterEach(() => close())

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: (await res.json()) as unknown }
}

async function register(id: number, name: string) {
  const res = await call("POST", "/users", { id, name })
  assert.equal(res.status, 200)
  return registerUserResponseSchema.parse(res.body)
}

describe("health and status", () => {
  test("health reports the lock connection", async () => {
    assert.deepEqual(healthResponseSchema.parse((await call("GET", "/health")).body), {
      ok: true,
      lockConnected: true,
    })
    lock.configure({ unreachable: true })
    assert.equal(healthResponseSchema.parse((await call("GET", "/health")).body).lockConnected, false)
  })

  test("a fresh install starts locked (RNF4)", async () => {
    assert.equal(statusResponseSchema.parse((await call("GET", "/status")).body).locked, true)
  })
})

describe("POST /users", () => {
  test("registers on the lock, then in the replica, and returns the TOTP URI once", async () => {
    const { user, totpUri } = await register(0, "Alice")
    assert.match(totpUri, /^otpauth:\/\/totp\/SmartEntry%3AAlice\?secret=[A-Z2-7]{32}&/)
    assert.equal(user.syncedAt, user.createdAt)
    assert.deepEqual(await lock.listSlots(), [{ id: 0, hasTotp: true, hasRfid: false }])
    const { users } = usersResponseSchema.parse((await call("GET", "/users")).body)
    assert.deepEqual(users, [user])
    assert.equal(JSON.stringify(users).includes("secret"), false)
  })

  test("rejects an occupied slot with 409", async () => {
    await register(0, "Alice")
    assert.equal((await call("POST", "/users", { id: 0, name: "Bob" })).status, 409)
  })

  test("rejects invalid input with 400", async () => {
    assert.equal((await call("POST", "/users", { id: 10, name: "" })).status, 400)
    assert.equal((await call("POST", "/users")).status, 400)
  })

  test("does not touch the replica when the lock is unreachable (503)", async () => {
    lock.configure({ unreachable: true })
    assert.equal((await call("POST", "/users", { id: 0, name: "Alice" })).status, 503)
    assert.deepEqual(listUsers(db), [])
  })

  test("returns 504 when the lock does not answer in time", async () => {
    lock.configure({ delayMs: LOCK_TIMEOUT_MS * 3 })
    assert.equal((await call("POST", "/users", { id: 0, name: "Alice" })).status, 504)
    assert.deepEqual(listUsers(db), [])
  })
})

describe("PATCH and DELETE /users/:id", () => {
  test("renames only on the Pi, even with the lock unreachable", async () => {
    await register(0, "Alice")
    lock.configure({ unreachable: true })
    const res = await call("PATCH", "/users/0", { name: "Alice Souza" })
    assert.equal(res.status, 200)
    assert.equal(renameUserResponseSchema.parse(res.body).user.name, "Alice Souza")
  })

  test("removes from the lock, then from the replica", async () => {
    await register(0, "Alice")
    assert.equal((await call("DELETE", "/users/0")).status, 200)
    assert.deepEqual(await lock.listSlots(), [])
    assert.deepEqual(listUsers(db), [])
  })

  test("keeps the user when the lock is unreachable", async () => {
    await register(0, "Alice")
    lock.configure({ unreachable: true })
    assert.equal((await call("DELETE", "/users/0")).status, 503)
    assert.equal(listUsers(db).length, 1)
  })

  test("404 for an empty slot, 400 for a slot outside 0-9", async () => {
    assert.equal((await call("PATCH", "/users/3", { name: "X" })).status, 404)
    assert.equal((await call("DELETE", "/users/3")).status, 404)
    assert.equal((await call("DELETE", "/users/42")).status, 400)
  })
})

describe("POST /unlock", () => {
  test("unlocks, updates the status and logs a remote success", async () => {
    assert.equal((await call("POST", "/unlock")).status, 200)
    assert.equal(statusResponseSchema.parse((await call("GET", "/status")).body).locked, false)
    const [entry] = accessLogResponseSchema.parse((await call("GET", "/access-log")).body).entries
    assert.equal(entry?.method, "remote")
    assert.equal(entry?.result, "success")
  })

  test("logs a remote failure and returns 503 when the lock is unreachable", async () => {
    lock.configure({ unreachable: true })
    assert.equal((await call("POST", "/unlock")).status, 503)
    assert.equal(statusResponseSchema.parse((await call("GET", "/status")).body).locked, true)
    const [entry] = accessLogResponseSchema.parse((await call("GET", "/access-log")).body).entries
    assert.equal(entry?.result, "failure")
  })
})

describe("POST /sync", () => {
  test("merges by slot: keeps Pi names, drops removed slots, names new ones", async () => {
    await register(0, "Alice")
    await register(1, "Bob")
    await lock.clearUser(1)
    await lock.setUser(3, Buffer.alloc(20))

    const res = await call("POST", "/sync")
    assert.equal(res.status, 200)
    const { users, syncedAt } = syncResponseSchema.parse(res.body)
    assert.deepEqual(
      users.map((u) => [u.id, u.name]),
      [
        [0, "Alice"],
        [3, "Usuário 3"],
      ]
    )
    assert.ok(users.every((u) => u.syncedAt === syncedAt))
  })

  test("leaves the replica untouched when the lock is unreachable", async () => {
    await register(0, "Alice")
    lock.configure({ unreachable: true })
    assert.equal((await call("POST", "/sync")).status, 503)
    assert.equal(listUsers(db).length, 1)
  })
})

describe("GET /access-log", () => {
  test("records events pushed by the lock, newest first, honoring limit", async () => {
    lock.emitAccessEvent({ slot: 0, method: "totp", result: "failure" })
    lock.emitAccessEvent({ slot: 0, method: "totp", result: "success" })
    const all = accessLogResponseSchema.parse((await call("GET", "/access-log")).body).entries
    assert.deepEqual(
      all.map((e) => e.result),
      ["success", "failure"]
    )
    const one = accessLogResponseSchema.parse((await call("GET", "/access-log?limit=1")).body)
    assert.equal(one.entries.length, 1)
    assert.equal((await call("GET", "/access-log?limit=0")).status, 400)
  })
})

describe("routing", () => {
  test("404 for unknown routes, 400 for malformed JSON", async () => {
    assert.equal((await call("GET", "/nope")).status, 404)
    const res = await fetch(`${baseUrl}/users`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    })
    assert.equal(res.status, 400)
  })
})
