import assert from "node:assert/strict"
import { test } from "node:test"

import { createDb, isLockSyncRequired, listUsers } from "@workspace/db"

import {
  ClockUnsyncedError,
  LockBusyError,
  LockRejectedError,
  LockTimeoutError,
  SyncRequiredError,
} from "./errors.js"
import {
  Command,
  Event,
  decodePacket,
  encodePacket,
  type Packet,
} from "./lock-protocol.js"
import { createServices } from "./services.js"
import { ZigbeeLockTransport, type LockRadio } from "./zigbee-lock-transport.js"

const key = Buffer.from(Array.from({ length: 32 }, (_, i) => i))
const ieee = "0x00124b0000000001"

/** Independent application state: counter/deadline rules are checked before effects. */
function bench() {
  const db = createDb(":memory:")
  const slots = new Map<number, Buffer>()
  const sent: Packet[] = []
  let receive: (wire: Buffer) => void = () => {}
  let disconnect: () => void = () => {}
  let ready = true
  let ntp = true
  let unix = 1_800_000_000
  let monotonic = 0
  let lastCounter = 0
  let opens = 0
  let queued = false
  let drop = false
  const respond = (request: Packet, data: number[]) =>
    receive(
      encodePacket(
        {
          ...request,
          kind: 1,
          data: Buffer.from(data),
        },
        key,
        ieee
      )
    )
  function deliver(request: Packet) {
    if (request.counter <= lastCounter) return respond(request, [5])
    if (
      request.opcode !== Command.listSlots &&
      (request.deadline <= unix || request.deadline > unix + 10)
    )
      return respond(request, [4])
    lastCounter = request.counter // Persist before effects/ack, also for listSlots.
    let data: number[] = [0]
    if (request.opcode === Command.listSlots) {
      data = [
        0,
        1,
        ...Array.from({ length: 10 }, (_, i) => (slots.has(i) ? 3 : 0)),
      ]
    } else if (request.opcode === Command.setUser) {
      if (slots.has(request.slot)) data = [1]
      else slots.set(request.slot, Buffer.from(request.data))
    } else if (request.opcode === Command.clearUser) {
      if (!slots.delete(request.slot)) data = [2]
    } else if (request.opcode === Command.unlock) {
      opens++
      data = [0, 0]
    }
    if (!drop) respond(request, data)
  }
  const radio: LockRadio = {
    isReady: () => ready,
    onPacket: (handler) => {
      receive = handler
    },
    onDisconnect: (handler) => {
      disconnect = handler
    },
    async send(wire, signal) {
      signal.throwIfAborted()
      const packet = decodePacket(wire, key, ieee)
      sent.push(packet)
      if (!queued) deliver(packet)
    },
  }
  const create = () =>
    new ZigbeeLockTransport({
      db,
      radio,
      key,
      ieee,
      clock: { unixSeconds: async () => (ntp ? unix : undefined) },
      timeoutMs: 40,
      monotonicNow: () => monotonic,
    })
  const lock = create()
  return {
    db,
    slots,
    sent,
    lock,
    create,
    deliver,
    respond,
    services: createServices(db, lock, 1000),
    get opens() {
      return opens
    },
    set queued(value: boolean) {
      queued = value
    },
    set drop(value: boolean) {
      drop = value
    },
    set unix(value: number) {
      unix = value
    },
    set ntp(value: boolean) {
      ntp = value
    },
    set monotonic(value: number) {
      monotonic = value
    },
    event(packet: Packet) {
      receive(encodePacket(packet, key, ieee))
    },
    raw(wire: Buffer) {
      receive(wire)
    },
    disconnect() {
      ready = false
      disconnect()
    },
    reconnect() {
      ready = true
    },
  }
}

test("real services sync/register/unlock/remove require signed confirmations and commit recovery marker", async () => {
  const b = bench()
  try {
    await assert.rejects(
      b.services.registerUser({ id: 0, name: "Ana" }),
      SyncRequiredError
    )
    await b.services.sync()
    assert.equal(isLockSyncRequired(b.db), false)
    const created = await b.services.registerUser({ id: 0, name: "Ana" })
    assert.equal(
      new URL(created.totpUri).searchParams.get("secret")?.length,
      52
    )
    assert.equal(b.slots.get(0)?.length, 32)
    assert.equal(listUsers(b.db)[0]?.name, "Ana")
    assert.equal(isLockSyncRequired(b.db), false)
    await b.services.unlock()
    assert.equal(b.opens, 1)
    await b.services.removeUser(0)
    assert.equal(listUsers(b.db).length, 0)
    assert.equal(b.slots.size, 0)
    assert.deepEqual(
      b.sent.map((p) => p.counter),
      [1, 2, 3, 4]
    )
  } finally {
    b.db.close()
  }
})

test("lost registration ACK survives a new transport and sync recovers the committed slot", async () => {
  const b = bench()
  try {
    await b.services.sync()
    b.drop = true
    await assert.rejects(
      b.services.registerUser({ id: 2, name: "Ana" }),
      LockTimeoutError
    )
    assert.equal(listUsers(b.db).length, 0)
    assert.equal(b.slots.has(2), true)
    const restarted = b.create()
    const services = createServices(b.db, restarted, 1000)
    assert.equal(restarted.requiresSync(), true)
    await assert.rejects(
      services.registerUser({ id: 1, name: "Bia" }),
      SyncRequiredError
    )
    b.drop = false
    await services.sync()
    assert.equal(listUsers(b.db)[0]?.id, 2)
    assert.equal(restarted.requiresSync(), false)
    assert.ok(b.sent[2]!.counter > b.sent[1]!.counter)
  } finally {
    b.db.close()
  }
})

test("expired queued unlock never actuates; newer sync also fences delayed commands", async () => {
  const b = bench()
  try {
    await b.services.sync()
    b.queued = true
    await assert.rejects(b.lock.unlock(), LockTimeoutError)
    const old = b.sent[1]!
    b.unix = old.deadline + 1
    b.deliver(old)
    assert.equal(b.opens, 0)
    b.queued = false
    await b.services.sync()
    b.unix = old.deadline - 1 // Even with a clock adjustment, the counter fences it.
    b.deliver(old)
    assert.equal(b.opens, 0)
  } finally {
    b.db.close()
  }
})

test("no NTP means no mutating transmission, while read-only reconciliation remains available", async () => {
  const b = bench()
  try {
    b.ntp = false
    await b.services.sync()
    await assert.rejects(b.lock.unlock(), ClockUnsyncedError)
    await assert.rejects(
      b.lock.setUser(0, Buffer.alloc(32)),
      ClockUnsyncedError
    )
    assert.equal(b.sent.length, 1)
    b.ntp = true
    await b.lock.unlock()
    assert.equal(b.opens, 1)
  } finally {
    b.db.close()
  }
})

test("tampered, wrong-counter and wrong-session responses cannot complete a pending operation", async () => {
  const b = bench()
  try {
    await b.services.sync()
    b.queued = true
    const pending = b.lock.unlock()
    await new Promise((resolve) => setImmediate(resolve))
    const request = b.sent.at(-1)!
    const response: Packet = { ...request, kind: 1, data: Buffer.from([0, 0]) }
    const tampered = encodePacket(response, key, ieee)
    tampered[tampered.length - 1]! ^= 1
    b.raw(tampered)
    b.event({ ...response, counter: request.counter + 1 })
    b.event({ ...response, session: Buffer.alloc(8, 0xaa) })
    await assert.rejects(b.lock.clearUser(0), LockBusyError)
    await assert.rejects(pending, LockTimeoutError)
    assert.equal(b.opens, 0)
  } finally {
    b.db.close()
  }
})

test("authenticated events reject replay and old sessions; connection expires without fresh evidence", async () => {
  const b = bench()
  try {
    const events: unknown[] = []
    b.lock.onAccessEvent((event) => events.push(event))
    assert.equal(b.lock.isConnected(), false)
    await b.services.sync()
    const event: Packet = {
      ...b.sent[0]!,
      kind: 2,
      opcode: Event.access,
      slot: 3,
      counter: 1,
      deadline: 0,
      data: Buffer.from([0, 0]),
    }
    b.event(event)
    b.event(event)
    assert.equal(events.length, 1)
    assert.equal(b.lock.isConnected(), true)
    b.monotonic = 90_001
    assert.equal(b.lock.isConnected(), false)
    b.disconnect()
    b.reconnect()
    await b.services.sync()
    b.event({ ...event, counter: 2 })
    assert.equal(events.length, 1)
    assert.notDeepEqual(b.sent.at(-1)!.session, event.session)
  } finally {
    b.db.close()
  }
})

test("authenticated lock rejection is distinct from delivery timeout", async () => {
  const b = bench()
  try {
    await b.services.sync()
    b.queued = true
    const pending = b.lock.unlock()
    await new Promise((resolve) => setImmediate(resolve))
    b.respond(b.sent.at(-1)!, [7])
    await assert.rejects(pending, LockRejectedError)
  } finally {
    b.db.close()
  }
})

test("a relock event after unlock ACK is not overwritten by the promise continuation", async () => {
  const b = bench()
  try {
    const states: boolean[] = []
    b.lock.onStatusPush((status) => states.push(status.locked))
    await b.services.sync()
    b.queued = true
    const pending = b.lock.unlock()
    await new Promise((resolve) => setImmediate(resolve))
    const request = b.sent.at(-1)!
    b.respond(request, [0, 0])
    b.event({
      ...request,
      kind: 2,
      opcode: Event.status,
      counter: 1,
      deadline: 0,
      data: Buffer.from([1]),
    })
    await pending
    assert.deepEqual(states, [true, false, true])
  } finally {
    b.db.close()
  }
})
