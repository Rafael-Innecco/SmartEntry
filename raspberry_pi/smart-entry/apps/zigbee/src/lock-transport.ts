import type { AccessEvent, LockSlot, LockStatus } from "@workspace/shared"

/**
 * Everything apps/zigbee needs from the ZigBee link to the lock, shaped after
 * the proposed authenticated v1 custom cluster for commands/status/events.
 * Implementations reject with LockUnreachableError before an unavailable link
 * is used. The real transport also applies its own confirmation timeout;
 * callers may impose a shorter HTTP timeout.
 */
export interface LockTransport {
  /** Real transport persists uncertainty across restarts until replica sync. */
  requiresSync?(): boolean
  /** Called only after the service has committed the confirmed replica change. */
  confirmReplica?(): void
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
