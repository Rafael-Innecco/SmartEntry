import assert from "node:assert/strict"
import { beforeEach, describe, test } from "node:test"

import type { User } from "@workspace/shared"
import Database from "better-sqlite3"

import { ACCESS_LOG_MAX_ENTRIES, addAccessEvent, listAccessLog } from "./access-log.js"
import { createDb, migrate, type SmartEntryDb } from "./client.js"
import { MIGRATIONS } from "./schema.js"
import { nextHmacCounter } from "./link-state.js"
import { getLockStatus, setLockStatus } from "./lock-status.js"
import {
  deleteUser,
  getUser,
  listUsers,
  mergeSlotsFromLock,
  updateUserName,
  upsertUser,
} from "./users.js"

const T0 = "2026-10-01T10:00:00.000Z"
const T1 = "2026-10-02T10:00:00.000Z"

function user(id: number, name: string): User {
  return { id, name, hasTotp: true, hasRfid: false, createdAt: T0, syncedAt: T0 }
}

let db: SmartEntryDb
beforeEach(() => {
  db = createDb(":memory:")
})

describe("users", () => {
  test("upsert inserts, then updates in place keeping createdAt", () => {
    upsertUser(db, user(0, "Alice"))
    upsertUser(db, { ...user(0, "Alice B."), createdAt: T1 })
    assert.deepEqual(listUsers(db), [{ ...user(0, "Alice B."), createdAt: T0 }])
  })

  test("updateUserName and deleteUser report whether the slot existed", () => {
    upsertUser(db, user(2, "Bob"))
    assert.equal(updateUserName(db, 2, "Robert"), true)
    assert.equal(getUser(db, 2)?.name, "Robert")
    assert.equal(updateUserName(db, 5, "Nobody"), false)
    assert.equal(deleteUser(db, 2), true)
    assert.equal(deleteUser(db, 2), false)
  })

  test("rejects slots outside 0-9", () => {
    assert.throws(() => upsertUser(db, user(10, "Overflow")))
  })
})

describe("mergeSlotsFromLock", () => {
  test("keeps Pi names, drops slots gone from the lock, names unknown slots", () => {
    upsertUser(db, user(0, "Alice"))
    upsertUser(db, user(1, "Bob"))

    mergeSlotsFromLock(
      db,
      [
        { id: 0, hasTotp: true, hasRfid: true },
        { id: 3, hasTotp: true, hasRfid: false },
      ],
      T1
    )

    assert.deepEqual(listUsers(db), [
      { id: 0, name: "Alice", hasTotp: true, hasRfid: true, createdAt: T0, syncedAt: T1 },
      { id: 3, name: "Usuário 3", hasTotp: true, hasRfid: false, createdAt: T1, syncedAt: T1 },
    ])
  })

  test("an empty lock empties the replica", () => {
    upsertUser(db, user(0, "Alice"))
    mergeSlotsFromLock(db, [], T1)
    assert.deepEqual(listUsers(db), [])
  })

  test("is all-or-nothing", () => {
    upsertUser(db, user(0, "Alice"))
    assert.throws(() =>
      mergeSlotsFromLock(
        db,
        [
          { id: 1, hasTotp: true, hasRfid: false },
          { id: 42, hasTotp: true, hasRfid: false },
        ],
        T1
      )
    )
    assert.deepEqual(listUsers(db), [user(0, "Alice")])
  })
})

describe("lock status", () => {
  test("is undefined until set, then upserts the single row", () => {
    assert.equal(getLockStatus(db), undefined)
    setLockStatus(db, { locked: true, updatedAt: T0 })
    setLockStatus(db, { locked: false, updatedAt: T1 })
    assert.deepEqual(getLockStatus(db), { locked: false, updatedAt: T1 })
  })
})

describe("access log", () => {
  test("lists newest first", () => {
    addAccessEvent(db, { slot: 0, method: "totp", result: "success" }, T0)
    addAccessEvent(db, { slot: null, method: "remote", result: "failure" }, T1)
    const entries = listAccessLog(db, 10)
    assert.deepEqual(
      entries.map(({ slot, method, result, receivedAt }) => ({ slot, method, result, receivedAt })),
      [
        { slot: null, method: "remote", result: "failure", receivedAt: T1 },
        { slot: 0, method: "totp", result: "success", receivedAt: T0 },
      ]
    )
  })

  test("keeps the name the slot had when the event happened", () => {
    upsertUser(db, user(0, "Alice"))
    addAccessEvent(db, { slot: 0, method: "totp", result: "success" }, T0)
    updateUserName(db, 0, "Bruna")
    addAccessEvent(db, { slot: 0, method: "totp", result: "success" }, T1)
    addAccessEvent(db, { slot: 7, method: "totp", result: "failure" }, T1)
    addAccessEvent(db, { slot: null, method: "remote", result: "success" }, T1)
    assert.deepEqual(
      listAccessLog(db, 10).map((entry) => entry.userName),
      [null, null, "Bruna", "Alice"]
    )
  })

  test(`keeps only the newest ${ACCESS_LOG_MAX_ENTRIES} entries`, () => {
    for (let i = 0; i < ACCESS_LOG_MAX_ENTRIES + 10; i++) {
      addAccessEvent(db, { slot: i % 10, method: "totp", result: "success" }, T0)
    }
    const entries = listAccessLog(db, ACCESS_LOG_MAX_ENTRIES + 10)
    assert.equal(entries.length, ACCESS_LOG_MAX_ENTRIES)
    assert.equal(entries.at(-1)?.id, 11)
  })
})

describe("migrations", () => {
  test("upgrade a database created before access_log had user_name", () => {
    const legacy = new Database(":memory:")
    legacy.exec(`
      CREATE TABLE access_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, slot INTEGER,
        method TEXT NOT NULL, result TEXT NOT NULL, received_at TEXT NOT NULL
      );
      INSERT INTO access_log (slot, method, result, received_at) VALUES (1, 'totp', 'success', '${T0}');
    `)
    migrate(legacy)
    assert.equal(legacy.pragma("user_version", { simple: true }), MIGRATIONS.length)
    assert.deepEqual(
      listAccessLog(legacy, 10).map(({ slot, userName }) => ({ slot, userName })),
      [{ slot: 1, userName: null }]
    )
  })

  test("are a no-op on an up-to-date database", () => {
    upsertUser(db, user(0, "Alice"))
    migrate(db)
    assert.equal(listUsers(db).length, 1)
  })
})

describe("link state", () => {
  test("the HMAC counter starts at 1 and never repeats", () => {
    assert.deepEqual([nextHmacCounter(db), nextHmacCounter(db), nextHmacCounter(db)], [1, 2, 3])
  })
})
