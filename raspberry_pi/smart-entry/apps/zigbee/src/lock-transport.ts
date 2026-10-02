import type { AccessEvent, LockSlot, LockStatus } from "@workspace/shared"

/**
 * Everything apps/zigbee needs from the ZigBee link to the lock, shaped after
 * the agreed protocol: Door Lock cluster for unlock/status, a custom cluster
 * for slot management and access events. Implementations reject with
 * LockUnreachableError when the lock can't be reached; timeouts are applied
 * by the caller.
 */
export interface LockTransport {
  isConnected(): boolean
  /** Occupied slots only, with the credentials the lock has for each. */
  listSlots(): Promise<LockSlot[]>
  /** Stores a TOTP secret in a slot; resolves once the lock confirms. */
  setUser(slot: number, totpSecret: Uint8Array): Promise<void>
  /** Clears a slot; resolves once the lock confirms. */
  clearUser(slot: number): Promise<void>
  /** Resolves once the lock confirms it opened. */
  unlock(): Promise<void>
  onStatusPush(handler: (status: LockStatus) => void): void
  /** Keypad/RFID attempts reported by the lock. */
  onAccessEvent(handler: (event: AccessEvent) => void): void
}
