import assert from "node:assert/strict"
import { test } from "node:test"

import { createLoginLimiter } from "./login-limiter"

function setup() {
  let clock = 0
  const limiter = createLoginLimiter({ now: () => clock })
  return { limiter, advance: (ms: number) => (clock += ms) }
}

test("locks after 5 failures within a minute, for one minute", () => {
  const { limiter, advance } = setup()
  for (let i = 0; i < 4; i++) limiter.recordFailure()
  assert.equal(limiter.isLocked(), false)
  limiter.recordFailure()
  assert.equal(limiter.isLocked(), true)
  advance(59_999)
  assert.equal(limiter.isLocked(), true)
  advance(1)
  assert.equal(limiter.isLocked(), false)
})

test("failures older than the window do not count", () => {
  const { limiter, advance } = setup()
  for (let i = 0; i < 4; i++) limiter.recordFailure()
  advance(60_000)
  limiter.recordFailure()
  assert.equal(limiter.isLocked(), false)
})

test("a successful login clears the count", () => {
  const { limiter } = setup()
  for (let i = 0; i < 4; i++) limiter.recordFailure()
  limiter.reset()
  limiter.recordFailure()
  assert.equal(limiter.isLocked(), false)
})
