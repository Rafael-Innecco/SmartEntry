import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import {
  acquireCoordinatorLease,
  runCoordinatorSession,
} from "./coordinator.js"

test("coordinator refuses concurrent owners and allows reuse after shutdown", () => {
  const dir = mkdtempSync(join(tmpdir(), "smart-entry-lease-"))
  try {
    const release = acquireCoordinatorLease(dir)
    assert.throws(() => acquireCoordinatorLease(dir), /coordinator.lock/)
    release()
    acquireCoordinatorLease(dir)()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("coordinator closes pairing and stops even when an action fails", async () => {
  const calls: string[] = []
  const controller = {
    start: async () => {
      calls.push("start")
      return "resumed" as const
    },
    permitJoin: async (seconds: number) => {
      calls.push(`join:${seconds}`)
    },
    stop: async () => {
      calls.push("stop")
    },
  }
  await assert.rejects(
    runCoordinatorSession(
      controller,
      new AbortController().signal,
      async () => {
        calls.push("action")
        throw new Error("radio command failed")
      }
    ),
    /radio command failed/
  )
  assert.deepEqual(calls, ["start", "join:0", "action", "join:0", "stop"])
})

test("coordinator attempts stop even when startup or closing pairing fails", async () => {
  let stopped = false
  await assert.rejects(
    runCoordinatorSession(
      {
        start: async () => {
          throw new Error("startup failed")
        },
        permitJoin: async () => {
          throw new Error("radio unavailable")
        },
        stop: async () => {
          stopped = true
        },
      },
      new AbortController().signal,
      async () => assert.fail("must not run")
    ),
    /startup failed/
  )
  assert.equal(stopped, true)
})

test("an interrupted startup cannot run an action or open pairing", async () => {
  const abort = new AbortController()
  const joins: number[] = []
  let stopped = false
  await assert.rejects(
    runCoordinatorSession(
      {
        start: async () => {
          abort.abort()
          return "resumed"
        },
        permitJoin: async (seconds) => {
          joins.push(seconds)
        },
        stop: async () => {
          stopped = true
        },
      },
      abort.signal,
      async () => assert.fail("must not run")
    ),
    /abort/i
  )
  assert.deepEqual(joins, [0])
  assert.equal(stopped, true)
})
