import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import {
  acquireCoordinatorLease,
  isStaleLease,
  runCoordinatorSession,
} from "./coordinator.js"
import { ConfigError } from "./errors.js"

function withStateDir(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "smart-entry-lease-"))
  try {
    run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** The pid of a process that has already exited. */
function deadPid(): number {
  const child = spawnSync(process.execPath, ["-e", ""])
  assert.ok(child.pid)
  return child.pid
}

test("coordinator refuses concurrent owners and allows reuse after shutdown", () => {
  withStateDir((dir) => {
    const release = acquireCoordinatorLease(dir)
    assert.throws(
      () => acquireCoordinatorLease(dir),
      (err: Error) =>
        err instanceof ConfigError &&
        err.message.includes(`held by running process ${process.pid}`)
    )
    release()
    assert.equal(existsSync(join(dir, "coordinator.lock")), false)
    acquireCoordinatorLease(dir)()
  })
})

test("a lock abandoned by a crash, an old version or a cut write is reclaimed", () => {
  const abandoned = [
    `${deadPid()}\nsome-boot\n`,
    `${deadPid()}\n`,
    "",
    "garbage",
  ]
  for (const content of abandoned) {
    withStateDir((dir) => {
      writeFileSync(join(dir, "coordinator.lock"), content)
      const release = acquireCoordinatorLease(dir)
      const lock = readFileSync(join(dir, "coordinator.lock"), "utf8")
      assert.equal(lock.split("\n")[0], String(process.pid))
      release()
      assert.deepEqual(readdirSync(dir), [], "no lock or temp file remains")
    })
  }
})

test("a lock held by another live process is not reclaimed", () => {
  withStateDir((dir) => {
    const held = `${process.ppid}\n-\n`
    writeFileSync(join(dir, "coordinator.lock"), held)
    assert.throws(
      () => acquireCoordinatorLease(dir),
      new RegExp(`held by running process ${process.ppid}`)
    )
    assert.equal(readFileSync(join(dir, "coordinator.lock"), "utf8"), held)
  })
})

test("release never deletes a lock another coordinator took over", () => {
  withStateDir((dir) => {
    const release = acquireCoordinatorLease(dir)
    writeFileSync(join(dir, "coordinator.lock"), `${process.ppid}\n-\n`)
    release()
    assert.equal(existsSync(join(dir, "coordinator.lock")), true)
  })
})

test("staleness is decided by boot id first, then by process liveness", () => {
  const alive = () => true
  const dead = () => false
  // Written before the last reboot or power loss.
  assert.equal(isStaleLease("123\nboot-a\n", "boot-b", 999, alive), true)
  // Same boot: depends on whether the owner still runs.
  assert.equal(isStaleLease("123\nboot-a\n", "boot-a", 999, alive), false)
  assert.equal(isStaleLease("123\nboot-a\n", "boot-a", 999, dead), true)
  // Without boot ids (e.g. Windows) only liveness counts.
  assert.equal(isStaleLease("123\n-\n", null, 999, alive), false)
  assert.equal(isStaleLease("123\n-\n", null, 999, dead), true)
  // An old pid-only lock with our own pid must predate this boot.
  assert.equal(isStaleLease("999\n", "boot-a", 999, alive), true)
  // Our own current lock is held.
  assert.equal(isStaleLease("999\nboot-a\n", "boot-a", 999, alive), false)
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
