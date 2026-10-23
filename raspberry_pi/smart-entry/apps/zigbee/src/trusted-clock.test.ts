import assert from "node:assert/strict"
import { test } from "node:test"

import { createTrustedClock, timeAttributes } from "./trusted-clock.js"

test("clock fails closed on NTP loss, command failure and invalid epoch", async () => {
  for (const check of [
    async () => "no",
    async () => {
      throw new Error("timedatectl unavailable")
    },
  ]) {
    assert.deepEqual(await timeAttributes(createTrustedClock(check)), {
      time: 0xffffffff,
      timeStatus: 0,
    })
  }
  assert.equal(
    await createTrustedClock(
      async () => "yes",
      () => 0
    ).unixSeconds(),
    undefined
  )
  const clock = createTrustedClock(
    async () => "yes\n",
    () => 1_800_000_000_000
  )
  assert.deepEqual(await timeAttributes(clock), {
    time: 853315200,
    timeStatus: 3,
  })
})
