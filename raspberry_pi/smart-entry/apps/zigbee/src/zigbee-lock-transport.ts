import { randomBytes } from "node:crypto"
import { performance } from "node:perf_hooks"

import {
  isLockSyncRequired,
  nextHmacCounter,
  setLockSyncRequired,
  type SmartEntryDb,
} from "@workspace/db"
import type { AccessEvent, LockSlot, LockStatus } from "@workspace/shared"

import {
  LockBusyError,
  LockRejectedError,
  LockTimeoutError,
  LockUnreachableError,
} from "./errors.js"
import {
  Command,
  Event,
  NO_SLOT,
  decodePacket,
  encodePacket,
  type Packet,
} from "./lock-protocol.js"
import type { LockTransport } from "./lock-transport.js"
import { requireTrustedTime, type TrustedClock } from "./trusted-clock.js"

export interface LockRadio {
  isReady(): boolean
  send(payload: Buffer, signal: AbortSignal): Promise<void>
  onPacket(handler: (payload: Buffer) => void): void
  onDisconnect(handler: () => void): void
}

interface Pending {
  packet: Packet
  finish: (error?: Error, data?: Buffer) => void
}

/** Proposed v1 implementation; never treats a radio ACK as application success. */
export class ZigbeeLockTransport implements LockTransport {
  private session = randomBytes(8)
  private eventSequence = 0
  private eventsEnabled = false
  private lastSeen = -Infinity
  private pending?: Pending
  private busy = false
  private statusHandler?: (status: LockStatus) => void
  private accessHandler?: (event: AccessEvent) => void

  constructor(
    private readonly options: {
      db: SmartEntryDb
      radio: LockRadio
      key: Buffer
      ieee: string
      clock: TrustedClock
      timeoutMs?: number
      monotonicNow?: () => number
    }
  ) {
    if (options.key.length !== 32 || !/^0x[0-9a-f]{16}$/.test(options.ieee)) {
      throw new Error("Invalid lock authentication configuration")
    }
    setLockSyncRequired(options.db, true)
    options.radio.onPacket((payload) => this.receive(payload))
    options.radio.onDisconnect(() => this.invalidate())
  }

  private now(): number {
    return (this.options.monotonicNow ?? (() => performance.now()))()
  }
  isConnected(): boolean {
    return this.options.radio.isReady() && this.now() - this.lastSeen < 90_000
  }
  requiresSync(): boolean {
    return isLockSyncRequired(this.options.db)
  }
  confirmReplica(): void {
    setLockSyncRequired(this.options.db, false)
  }
  onStatusPush(handler: (status: LockStatus) => void): void {
    this.statusHandler = handler
  }
  onAccessEvent(handler: (event: AccessEvent) => void): void {
    this.accessHandler = handler
  }

  invalidate(): void {
    this.session = randomBytes(8)
    this.eventsEnabled = false
    this.eventSequence = 0
    this.lastSeen = -Infinity
    setLockSyncRequired(this.options.db, true)
    // A command may already have arrived: force recovery rather than claiming no delivery.
    this.pending?.finish(new LockTimeoutError())
  }

  private async request(
    opcode: number,
    slot: number,
    data = Buffer.alloc(0)
  ): Promise<Buffer> {
    if (this.busy) throw new LockBusyError()
    if (!this.options.radio.isReady()) throw new LockUnreachableError()
    this.busy = true
    try {
      if (opcode === Command.listSlots) {
        // A fresh challenge also recovers event sequencing after a lock reboot.
        this.session = randomBytes(8)
        this.eventsEnabled = false
        this.eventSequence = 0
      }
      const deadline =
        opcode === Command.listSlots
          ? 0
          : (await requireTrustedTime(this.options.clock)) + 8
      if (!this.options.radio.isReady()) throw new LockUnreachableError()
      if (opcode === Command.setUser || opcode === Command.clearUser) {
        setLockSyncRequired(this.options.db, true)
      }
      const packet: Packet = {
        kind: 0,
        opcode,
        slot,
        counter: nextHmacCounter(this.options.db),
        session: Buffer.from(this.session),
        deadline,
        data,
      }
      const wire = encodePacket(packet, this.options.key, this.options.ieee)
      return await new Promise<Buffer>((resolve, reject) => {
        const abort = new AbortController()
        const timer = setTimeout(
          () => finish(new LockTimeoutError()),
          this.options.timeoutMs ?? 12_000
        )
        const finish = (error?: Error, response?: Buffer) => {
          if (this.pending?.packet !== packet) return
          this.pending = undefined
          clearTimeout(timer)
          abort.abort()
          if (error) reject(error)
          else resolve(response!)
        }
        this.pending = { packet, finish }
        // No retries. A failed send is still potentially delivered.
        void Promise.resolve()
          .then(() => {
            abort.signal.throwIfAborted()
            return this.options.radio.send(wire, abort.signal)
          })
          .catch(() => finish(new LockTimeoutError()))
      })
    } finally {
      this.busy = false
    }
  }

  async listSlots(): Promise<LockSlot[]> {
    const data = await this.request(Command.listSlots, NO_SLOT)
    const slots: LockSlot[] = []
    for (let id = 0; id < 10; id++) {
      const bits = data[id + 1]!
      if (bits & 1)
        slots.push({ id, hasTotp: !!(bits & 2), hasRfid: !!(bits & 4) })
    }
    return slots
  }

  async setUser(slot: number, secret: Uint8Array): Promise<void> {
    this.validateSlot(slot)
    if (secret.length !== 32)
      throw new Error("TOTP secret must contain 32 bytes")
    await this.request(Command.setUser, slot, Buffer.from(secret))
  }

  async clearUser(slot: number): Promise<void> {
    this.validateSlot(slot)
    await this.request(Command.clearUser, slot)
  }

  async unlock(): Promise<void> {
    await this.request(Command.unlock, NO_SLOT)
  }

  private validateSlot(slot: number): void {
    if (!Number.isInteger(slot) || slot < 0 || slot > 9)
      throw new Error("Invalid lock slot")
  }

  private pushStatus(locked: number): void {
    this.statusHandler?.({
      locked: locked === 1,
      updatedAt: new Date().toISOString(),
    })
  }

  private receive(wire: Buffer): void {
    let packet: Packet
    try {
      packet = decodePacket(wire, this.options.key, this.options.ieee)
    } catch {
      return
    }
    if (!packet.session.equals(this.session)) return
    if (packet.kind === 1) {
      const pending = this.pending
      if (
        !pending ||
        ["opcode", "slot", "counter", "deadline"].some(
          (field) =>
            packet[field as "opcode"] !== pending.packet[field as "opcode"]
        )
      )
        return
      const result = packet.data[0]
      if (result === undefined || result > 7) return
      if (result !== 0) {
        if (packet.data.length !== 1) return
        this.lastSeen = this.now()
        pending.finish(new LockRejectedError(result))
        return
      }
      const data = packet.data.subarray(1)
      if (packet.opcode === Command.listSlots) {
        if (
          data.length !== 11 ||
          data[0]! > 1 ||
          [...data.subarray(1)].some(
            (bits) =>
              bits > 7 ||
              (!(bits & 1) && bits !== 0) ||
              (bits & 1 && !(bits & 6))
          )
        )
          return
        this.eventsEnabled = true
        this.pushStatus(data[0]!)
      } else if (packet.opcode === Command.unlock) {
        if (data.length !== 1 || data[0] !== 0) return
        this.pushStatus(0)
      } else if (data.length !== 0) return
      this.lastSeen = this.now()
      pending.finish(undefined, data)
    } else if (
      packet.kind === 2 &&
      this.eventsEnabled &&
      packet.deadline === 0 &&
      packet.counter > this.eventSequence
    ) {
      if (packet.opcode === Event.status) {
        if (
          packet.slot !== NO_SLOT ||
          packet.data.length !== 1 ||
          packet.data[0]! > 1
        )
          return
        this.eventSequence = packet.counter
        this.lastSeen = this.now()
        this.pushStatus(packet.data[0]!)
      } else if (packet.opcode === Event.access) {
        if (
          packet.data.length !== 2 ||
          packet.data[0]! > 1 ||
          packet.data[1]! > 1
        )
          return
        this.eventSequence = packet.counter
        this.lastSeen = this.now()
        this.accessHandler?.({
          slot: packet.slot === NO_SLOT ? null : packet.slot,
          method: packet.data[0] === 0 ? "totp" : "rfid",
          result: packet.data[1] === 0 ? "success" : "failure",
        })
      }
    }
  }
}
