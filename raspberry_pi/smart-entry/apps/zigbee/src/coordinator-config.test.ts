import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import {
  initializeNetwork,
  loadNetwork,
  readCoordinatorConfig,
} from "./coordinator-config.js"

test("coordinator rejects missing serial path, unsupported driver and malformed IEEE", () => {
  assert.throws(() => readCoordinatorConfig({}), /SERIAL_PATH/)
  const env = { SMART_ENTRY_ZIGBEE_SERIAL_PATH: "/dev/serial/by-id/test" }
  assert.equal(readCoordinatorConfig(env).adapter, "zstack")
  assert.throws(
    () =>
      readCoordinatorConfig({ ...env, SMART_ENTRY_ZIGBEE_ADAPTER: "ember" }),
    /zstack/
  )
  assert.throws(
    () => readCoordinatorConfig({ ...env, SMART_ENTRY_LOCK_IEEE: "123" }),
    /IEEE/
  )
  assert.equal(
    readCoordinatorConfig({
      ...env,
      SMART_ENTRY_LOCK_IEEE: "0x00124B0000000001",
    }).lockIeee,
    "0x00124b0000000001"
  )
})

test("network identity survives restart and cannot be overwritten or silently regenerated", () => {
  const dir = mkdtempSync(join(tmpdir(), "smart-entry-network-"))
  try {
    assert.throws(() => loadNetwork(dir), /Cannot read/)
    assert.throws(() => initializeNetwork(dir, 27), /channel/)
    initializeNetwork(dir, 15)
    const before = readFileSync(join(dir, "network.json"), "utf8")
    const identity = loadNetwork(dir)
    assert.equal(identity.channel, 15)
    assert.equal(Buffer.from(identity.networkKey, "hex").length, 16)
    assert.throws(() => initializeNetwork(dir, 20), /empty state directory/)
    assert.equal(readFileSync(join(dir, "network.json"), "utf8"), before)
    assert.deepEqual(loadNetwork(dir), identity)
    writeFileSync(
      join(dir, "network.json"),
      '{"networkKey":"sensitive-invalid-value"}'
    )
    assert.throws(
      () => loadNetwork(dir),
      (err: Error) => {
        assert.equal(err.message.includes("sensitive-invalid-value"), false)
        return /Invalid network.json/.test(err.message)
      }
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
