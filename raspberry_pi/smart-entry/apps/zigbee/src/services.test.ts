import assert from "node:assert/strict"
import { test } from "node:test"

import { createDb, listUsers } from "@workspace/db"
import type { LockSlot } from "@workspace/shared"

import { LockBusyError, LockTimeoutError, SyncRequiredError } from "./errors.js"
import { createFakeLockTransport } from "./fake-lock-transport.js"
import { createServices } from "./services.js"

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test("overlapping registrations cannot replace the first credential", async () => {
  const db = createDb(":memory:")
  const lock = createFakeLockTransport()
  const confirmation = deferred<void>()
  const setUser = lock.setUser.bind(lock)
  lock.setUser = async (slot, secret) => {
    await confirmation.promise
    await setUser(slot, secret)
  }
  const services = createServices(db, lock, 1000)
  try {
    const first = services.registerUser({ id: 0, name: "Alice" })
    await assert.rejects(
      services.registerUser({ id: 0, name: "Bob" }),
      LockBusyError
    )
    await assert.rejects(services.sync(), LockBusyError)
    assert.throws(() => services.renameUser(0, "Bob"), LockBusyError)
    confirmation.resolve()
    await first
    assert.equal(listUsers(db)[0]?.name, "Alice")
  } finally {
    db.close()
  }
})

test("late registration requires sync and removal before issuing a new QR", async () => {
  const db = createDb(":memory:")
  const lock = createFakeLockTransport()
  const confirmation = deferred<void>()
  const setUser = lock.setUser.bind(lock)
  lock.setUser = async (slot, secret) => {
    await confirmation.promise
    await setUser(slot, secret)
  }
  const services = createServices(db, lock, 20)
  try {
    await assert.rejects(
      services.registerUser({ id: 0, name: "Alice" }),
      LockTimeoutError
    )
    await assert.rejects(services.sync(), LockBusyError)
    assert.deepEqual(listUsers(db), [])
    confirmation.resolve()
    // Wait for the real operation, rather than releasing the gate on timeout.
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.deepEqual(listUsers(db), [])
    await assert.rejects(
      services.registerUser({ id: 0, name: "Bob" }),
      SyncRequiredError
    )
    await services.sync()
    assert.equal(listUsers(db)[0]?.id, 0)
    await services.removeUser(0)
    const result = await services.registerUser({ id: 0, name: "Bob" })
    assert.equal(result.user.name, "Bob")
    assert.match(result.totpUri, /^otpauth:/)
  } finally {
    db.close()
  }
})

test("sync and removal cannot race; a late removal is reconciled", async () => {
  const db = createDb(":memory:")
  const lock = createFakeLockTransport()
  const services = createServices(db, lock, 20)
  try {
    await services.registerUser({ id: 0, name: "Alice" })
    const snapshot = deferred<LockSlot[]>()
    const listSlots = lock.listSlots.bind(lock)
    lock.listSlots = () => snapshot.promise
    const sync = services.sync()
    await assert.rejects(services.removeUser(0), LockBusyError)
    snapshot.resolve(await listSlots())
    await sync
    lock.listSlots = listSlots

    const confirmation = deferred<void>()
    const clearUser = lock.clearUser.bind(lock)
    lock.clearUser = async (slot) => {
      await confirmation.promise
      await clearUser(slot)
    }
    await assert.rejects(services.removeUser(0), LockTimeoutError)
    assert.equal(listUsers(db).length, 1)
    confirmation.resolve()
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(listUsers(db).length, 1)
    await assert.rejects(services.removeUser(0), SyncRequiredError)
    await services.sync()
    assert.deepEqual(listUsers(db), [])
  } finally {
    db.close()
  }
})
