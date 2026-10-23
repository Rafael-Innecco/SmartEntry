import assert from "node:assert/strict"
import { test } from "node:test"

import { superviseRadio, type SupervisedRadio } from "./zigbee-supervisor.js"

test("supervisor stops the previous radio before reconnecting and syncs after reconnect", async () => {
  const abort = new AbortController()
  let disconnected = new AbortController()
  let running = false
  let cycles = 0
  const calls: string[] = []
  const radio: SupervisedRadio = {
    get disconnectSignal() {
      return disconnected.signal
    },
    isRunning: () => running,
    async start() {
      assert.equal(running, false)
      running = true
      disconnected = new AbortController()
      calls.push("start")
    },
    async stop() {
      calls.push("stop")
      running = false
    },
  }
  await superviseRadio({
    radio,
    signal: abort.signal,
    retryMs: 1,
    pollMs: 1,
    report() {},
    async sync() {
      calls.push("sync")
      if (++cycles === 1) {
        running = false
        disconnected.abort()
      } else abort.abort()
    },
  })
  assert.deepEqual(calls, ["start", "sync", "stop", "start", "sync", "stop"])
})

test("cleanup failure stops supervision instead of opening a second serial controller", async () => {
  let starts = 0
  await assert.rejects(
    superviseRadio({
      signal: new AbortController().signal,
      report() {},
      sync: async () => {},
      radio: {
        disconnectSignal: new AbortController().signal,
        isRunning: () => false,
        async start() {
          starts++
        },
        async stop() {
          throw new Error("cleanup failed")
        },
      },
    }),
    /cleanup failed/
  )
  assert.equal(starts, 1)
})
