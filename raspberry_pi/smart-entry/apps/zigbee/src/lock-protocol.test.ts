import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { decodePacket, encodePacket, type Packet } from "./lock-protocol.js"

const vector = JSON.parse(
  readFileSync(
    new URL("./fixtures/lock-protocol-v1.json", import.meta.url),
    "utf8"
  )
) as {
  keyHex: string
  lockIeee: string
  wireHex: string
  tagHex: string
}
const key = Buffer.from(vector.keyHex, "hex")
const packet: Packet = {
  kind: 0,
  opcode: 2,
  slot: 3,
  counter: 0x01020304,
  session: Buffer.from("a0a1a2a3a4a5a6a7", "hex"),
  deadline: 1_800_000_008,
  data: Buffer.from(Array.from({ length: 32 }, (_, i) => i + 32)),
}

test("v1 encoding matches the independently calculated firmware interoperability vector", () => {
  const wire = encodePacket(packet, key, vector.lockIeee)
  assert.equal(wire.toString("hex"), vector.wireHex)
  assert.equal(wire.subarray(-16).toString("hex"), vector.tagHex)
  assert.deepEqual(decodePacket(wire, key, vector.lockIeee), packet)
  assert.equal(wire.length, 69)
})

test("authentication binds every byte, the direction, and the lock identity; truncation/trailing data fail", () => {
  const wire = Buffer.from(vector.wireHex, "hex")
  for (let i = 0; i < wire.length; i++) {
    const mutated = Buffer.from(wire)
    mutated[i]! ^= 1
    assert.throws(() => decodePacket(mutated, key, vector.lockIeee))
  }
  assert.throws(() => decodePacket(wire, key, "0x00124b0000000002"))
  assert.throws(() => decodePacket(wire.subarray(0, -1), key, vector.lockIeee))
  assert.throws(() =>
    decodePacket(Buffer.concat([wire, Buffer.from([0])]), key, vector.lockIeee)
  )
  assert.throws(() =>
    encodePacket({ ...packet, counter: 0x100000000 }, key, vector.lockIeee)
  )
})
