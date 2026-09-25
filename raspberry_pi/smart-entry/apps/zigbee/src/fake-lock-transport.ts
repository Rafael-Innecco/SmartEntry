import type { LockStatus, NewUser, User } from "@workspace/shared"

import type { LockTransport } from "./lock-transport.js"

/**
 * In-memory stand-in for the real ZigBee link, so the HTTP API (and
 * apps/web on top of it) can be built and tested before ZigBee
 * communication with the lock is validated. Swap this out for a
 * zigbee-herdsman-backed LockTransport once that's ready.
 */
export function createFakeLockTransport(): LockTransport {
  const users = new Map<number, User>()
  let statusHandler: ((status: LockStatus) => void) | undefined

  return {
    async syncUsers() {
      return [...users.values()]
    },

    async registerUser(newUser: NewUser) {
      const user: User = {
        ...newUser,
        hasTotp: true,
        hasRfid: false,
        createdAt: new Date().toISOString(),
        syncedAt: null,
      }
      users.set(user.id, user)
      return user
    },

    async removeUser(id: number) {
      users.delete(id)
    },

    async unlock() {
      statusHandler?.({ locked: false, updatedAt: new Date().toISOString() })
    },

    onStatusPush(handler) {
      statusHandler = handler
    },
  }
}
