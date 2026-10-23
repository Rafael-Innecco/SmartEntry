import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { createDb } from "./client.js"
import {
  isLockSyncRequired,
  nextHmacCounter,
  setLockSyncRequired,
} from "./link-state.js"

test("counter reservation and uncertain-write marker survive closing and reopening the real SQLite file", () => {
  const directory = mkdtempSync(join(tmpdir(), "smart-entry-recovery-"))
  try {
    const path = join(directory, "lock.sqlite3")
    const first = createDb(path)
    assert.equal(first.pragma("synchronous", { simple: true }), 2)
    setLockSyncRequired(first, true)
    assert.equal(nextHmacCounter(first), 1)
    first.close()
    const restarted = createDb(path)
    try {
      assert.equal(isLockSyncRequired(restarted), true)
      assert.equal(nextHmacCounter(restarted), 2)
      setLockSyncRequired(restarted, false)
    } finally {
      restarted.close()
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
