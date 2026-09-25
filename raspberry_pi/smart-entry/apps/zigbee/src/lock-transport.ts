import type { LockStatus, NewUser, User } from "@workspace/shared"

/**
 * Everything apps/zigbee needs from the ZigBee link to the lock. The real
 * zigbee-herdsman-backed implementation doesn't exist yet (validating basic
 * ZigBee communication with the lock is still an open item), so this is the
 * seam a fake implementation plugs into for now.
 */
export interface LockTransport {
  /** Pulls the full user list from the lock (used by the manual/startup sync). */
  syncUsers(): Promise<User[]>
  /** Registers a new user on the lock; resolves once the lock confirms. */
  registerUser(user: NewUser): Promise<User>
  /** Removes a user from the lock; resolves once the lock confirms. */
  removeUser(id: number): Promise<void>
  /** Sends the unlock command; resolves once the lock confirms it opened. */
  unlock(): Promise<void>
  /** Registers a callback invoked whenever the lock pushes a status change. */
  onStatusPush(handler: (status: LockStatus) => void): void
}
