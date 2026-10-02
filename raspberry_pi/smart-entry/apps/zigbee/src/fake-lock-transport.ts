import { setTimeout as sleep } from "node:timers/promises"

import type { AccessEvent, LockSlot, LockStatus } from "@workspace/shared"

import { LockUnreachableError } from "./errors.js"
import type { LockTransport } from "./lock-transport.js"

export interface FakeLockBehavior {
  /** Added to every round trip, to exercise timeouts. */
  delayMs?: number
  /** Every round trip fails with LockUnreachableError. */
  unreachable?: boolean
}

export interface FakeLockTransport extends LockTransport {
  configure(behavior: FakeLockBehavior): void
  /** Simulates the lock reporting a keypad/RFID attempt. */
  emitAccessEvent(event: AccessEvent): void
}

/**
 * In-memory stand-in for the real ZigBee link, so the HTTP API and apps/web
 * can be built and tested before ZigBee communication with the lock is
 * validated. Swap for a zigbee-herdsman-backed LockTransport once ready.
 */
export function createFakeLockTransport(
  options: { initialSlots?: LockSlot[] } = {}
): FakeLockTransport {
  const slots = new Map(options.initialSlots?.map((slot) => [slot.id, slot] as const))
  let behavior: FakeLockBehavior = {}
  let statusHandler: ((status: LockStatus) => void) | undefined
  let accessHandler: ((event: AccessEvent) => void) | undefined

  async function roundTrip(): Promise<void> {
    if (behavior.delayMs) await sleep(behavior.delayMs)
    if (behavior.unreachable) throw new LockUnreachableError()
  }

  return {
    isConnected: () => !behavior.unreachable,

    async listSlots() {
      await roundTrip()
      return [...slots.values()].sort((a, b) => a.id - b.id)
    },

    async setUser(slot) {
      await roundTrip()
      slots.set(slot, { id: slot, hasTotp: true, hasRfid: false })
    },

    async clearUser(slot) {
      await roundTrip()
      slots.delete(slot)
    },

    async unlock() {
      await roundTrip()
      statusHandler?.({ locked: false, updatedAt: new Date().toISOString() })
    },

    onStatusPush(handler) {
      statusHandler = handler
    },

    onAccessEvent(handler) {
      accessHandler = handler
    },

    configure(next) {
      behavior = next
    },

    emitAccessEvent(event) {
      accessHandler?.(event)
    },
  }
}
