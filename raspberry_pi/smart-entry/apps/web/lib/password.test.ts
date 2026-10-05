import assert from "node:assert/strict"
import { test } from "node:test"

import { hashPassword, verifyPassword } from "./password"

test("a hash verifies only its own password", async () => {
  const hash = await hashPassword("porta-do-lab")
  assert.equal(await verifyPassword("porta-do-lab", hash), true)
  assert.equal(await verifyPassword("porta-do-lab ", hash), false)
})

test("the same password hashes differently each time (random salt)", async () => {
  assert.notEqual(await hashPassword("x"), await hashPassword("x"))
})

test("hashes are safe to paste into a .env file", async () => {
  const hash = await hashPassword("senha")
  assert.match(hash, /^scrypt:\d+:\d+:\d+:[\w-]+:[\w-]+$/)
  assert.doesNotMatch(hash, /[$#\s"']/)
})

test("a malformed stored hash is a configuration error, not a wrong password", async () => {
  await assert.rejects(verifyPassword("senha", "not-a-hash"))
  await assert.rejects(verifyPassword("senha", "scrypt:abc:8:1:c2FsdA:aGFzaA"))
})
