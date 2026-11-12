import assert from "node:assert/strict"
import { test } from "node:test"

import { Zcl, type Models } from "zigbee-herdsman"

import {
  installTimeGuard,
  registerTimeClusterOnCoordinator,
  smartEntryCluster,
} from "./herdsman-radio.js"
import { LOCK_CLUSTER_ID } from "./lock-protocol.js"

test("custom cluster serializes binary envelope as OCTET_STR with exactly one length byte", () => {
  const payload = Buffer.from([0, 255, 128, 0])
  const custom = { smartEntry: smartEntryCluster }
  const frame = Zcl.Frame.create(
    Zcl.FrameType.SPECIFIC,
    Zcl.Direction.CLIENT_TO_SERVER,
    true,
    undefined,
    7,
    "request",
    LOCK_CLUSTER_ID,
    { payload },
    custom
  )
  const wire = frame.toBuffer()
  assert.equal(wire[3], payload.length)
  assert.deepEqual(wire.subarray(4), payload)
  const decoded = Zcl.Frame.fromBuffer(
    LOCK_CLUSTER_ID,
    Zcl.Header.fromBuffer(wire),
    wire,
    custom
  )
  assert.deepEqual(decoded.payload.payload, payload)
})

test("Time interception blocks automatic library response and returns invalid time without NTP", async () => {
  for (const unix of [undefined, 1_800_000_000]) {
    const device = {} as Models.Device
    let response: unknown
    let finished!: () => void
    const done = new Promise<void>((resolve) => {
      finished = resolve
    })
    const endpoint = {
      readResponse: async (_cluster: number, seq: number, data: unknown) => {
        assert.equal(seq, 7)
        response = data
        finished()
      },
    } as unknown as Models.Endpoint
    const frame = Zcl.Frame.create(
      Zcl.FrameType.GLOBAL,
      Zcl.Direction.CLIENT_TO_SERVER,
      false,
      undefined,
      7,
      "read",
      0x000a,
      [{ attrId: 0 }, { attrId: 1 }],
      {}
    )
    installTimeGuard(device, { unixSeconds: async () => unix })
    assert.equal(device.customReadResponse!(frame, endpoint), true)
    await done
    assert.deepEqual(response, {
      0: {
        value: unix === undefined ? 0xffffffff : unix - 946684800,
        type: Zcl.DataType.UTC,
      },
      1: { value: unix === undefined ? 0 : 3, type: Zcl.DataType.BITMAP8 },
    })
  }
})

test("registerTimeClusterOnCoordinator adds 0x000a to coordinator endpoint inputClusters and skips duplicates", () => {
  const coordinatorEndpoint = { inputClusters: [0x0000, 0x0003] } as unknown as Models.Endpoint
  const otherEndpoint = { inputClusters: [0x000a] } as unknown as Models.Endpoint
  const fakeController = {
    getDevicesIterator: function* () {
      yield {
        type: "Coordinator",
        endpoints: [coordinatorEndpoint, otherEndpoint],
      } as unknown as Models.Device
      yield {
        type: "Router",
        endpoints: [{ inputClusters: [] } as unknown as Models.Endpoint],
      } as unknown as Models.Device
    },
  } as unknown as import("zigbee-herdsman").Controller

  registerTimeClusterOnCoordinator(fakeController)

  // 0x000a was added to the coordinator endpoint that lacked it
  assert.ok(coordinatorEndpoint.inputClusters.includes(0x000a))
  // Already-present 0x000a is not duplicated
  assert.equal(otherEndpoint.inputClusters.filter((c) => c === 0x000a).length, 1)
  // Non-coordinator endpoints are untouched
})
