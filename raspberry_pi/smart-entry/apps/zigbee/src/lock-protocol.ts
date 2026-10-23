import { createHmac, timingSafeEqual } from "node:crypto"

export const LOCK_CLUSTER_ID = 0xfc00
export const LOCK_ENDPOINT = 1
export const NO_SLOT = 0xff
export const Command = {
  listSlots: 1,
  setUser: 2,
  clearUser: 3,
  unlock: 4,
} as const
export const Event = { status: 1, access: 2 } as const
export const Result = {
  ok: 0,
  occupied: 1,
  empty: 2,
  clockUnsynced: 3,
  expired: 4,
  replay: 5,
  invalid: 6,
  hardware: 7,
} as const

export interface Packet {
  kind: 0 | 1 | 2
  opcode: number
  slot: number
  counter: number
  session: Buffer
  deadline: number
  data: Buffer
}

const DOMAIN = Buffer.from("SmartEntry/v1\0", "ascii")
const HEADER = 21
const TAG = 16

function tag(key: Buffer, ieee: string, content: Buffer): Buffer {
  if (key.length !== 32 || !/^0x[0-9a-f]{16}$/.test(ieee)) {
    throw new Error("Invalid protocol key or lock IEEE address")
  }
  return createHmac("sha256", key)
    .update(DOMAIN)
    .update(Buffer.from(ieee.slice(2), "hex"))
    .update(content)
    .digest()
    .subarray(0, TAG)
}

/** Proposed v1 wire contract. All multibyte numbers are unsigned little endian. */
export function encodePacket(
  packet: Packet,
  key: Buffer,
  ieee: string
): Buffer {
  if (
    packet.session.length !== 8 ||
    packet.data.length > 32 ||
    !Number.isInteger(packet.counter) ||
    packet.counter < 1 ||
    packet.counter > 0xffffffff ||
    !Number.isInteger(packet.deadline) ||
    packet.deadline < 0 ||
    packet.deadline > 0xffffffff ||
    ![0, 1, 2].includes(packet.kind) ||
    !Number.isInteger(packet.opcode) ||
    packet.opcode < 1 ||
    packet.opcode > (packet.kind === 2 ? 2 : 4) ||
    !(
      packet.slot === NO_SLOT ||
      (Number.isInteger(packet.slot) && packet.slot >= 0 && packet.slot <= 9)
    )
  ) {
    throw new Error("Invalid protocol packet")
  }
  const body = Buffer.alloc(HEADER + packet.data.length)
  body[0] = 1
  body[1] = packet.kind
  body[2] = packet.opcode
  body[3] = packet.slot
  body.writeUInt32LE(packet.counter, 4)
  packet.session.copy(body, 8)
  body.writeUInt32LE(packet.deadline, 16)
  body[20] = packet.data.length
  packet.data.copy(body, HEADER)
  return Buffer.concat([body, tag(key, ieee, body)])
}

export function decodePacket(wire: Buffer, key: Buffer, ieee: string): Packet {
  if (
    wire.length < HEADER + TAG ||
    wire.length > HEADER + 32 + TAG ||
    wire[0] !== 1 ||
    wire.length !== HEADER + wire[20]! + TAG
  ) {
    throw new Error("Invalid protocol packet")
  }
  const body = wire.subarray(0, -TAG)
  if (!timingSafeEqual(tag(key, ieee, body), wire.subarray(-TAG))) {
    throw new Error("Invalid protocol authentication")
  }
  const packet: Packet = {
    kind: wire[1] as Packet["kind"],
    opcode: wire[2]!,
    slot: wire[3]!,
    counter: wire.readUInt32LE(4),
    session: Buffer.from(wire.subarray(8, 16)),
    deadline: wire.readUInt32LE(16),
    data: Buffer.from(wire.subarray(HEADER, -TAG)),
  }
  // Shared structural validation without accepting trailing/reserved fields.
  encodePacket(packet, key, ieee)
  return packet
}
