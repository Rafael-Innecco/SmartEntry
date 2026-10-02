import {
  addAccessEvent,
  deleteUser,
  getUser,
  listUsers,
  mergeSlotsFromLock,
  updateUserName,
  upsertUser,
  type SmartEntryDb,
} from "@workspace/db"
import type { NewUser, User } from "@workspace/shared"

import { ConflictError, LockTimeoutError, NotFoundError } from "./errors.js"
import type { LockTransport } from "./lock-transport.js"
import { buildOtpauthUri, generateTotpSecret } from "./totp.js"

function now(): string {
  return new Date().toISOString()
}

async function withTimeout<T>(operation: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new LockTimeoutError()), ms)
  })
  try {
    return await Promise.race([operation, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Every write goes to the lock first and only touches the replica after the
 * lock confirms. A write that times out may still land on the lock later;
 * the next sync reconciles it.
 */
export function createServices(db: SmartEntryDb, lock: LockTransport, lockTimeoutMs: number) {
  const ask = <T>(operation: Promise<T>) => withTimeout(operation, lockTimeoutMs)

  return {
    async unlock(): Promise<void> {
      try {
        await ask(lock.unlock())
        addAccessEvent(db, { slot: null, method: "remote", result: "success" }, now())
      } catch (err) {
        addAccessEvent(db, { slot: null, method: "remote", result: "failure" }, now())
        throw err
      }
    },

    async registerUser({ id, name }: NewUser): Promise<{ user: User; totpUri: string }> {
      if (getUser(db, id)) throw new ConflictError(`slot ${id} is already in use`)
      const secret = generateTotpSecret()
      await ask(lock.setUser(id, secret))
      const confirmedAt = now()
      const user: User = {
        id,
        name,
        hasTotp: true,
        hasRfid: false,
        createdAt: confirmedAt,
        syncedAt: confirmedAt,
      }
      upsertUser(db, user)
      return { user, totpUri: buildOtpauthUri(name, secret) }
    },

    renameUser(id: number, name: string): User {
      if (!updateUserName(db, id, name)) throw new NotFoundError(`no user in slot ${id}`)
      return getUser(db, id) as User
    },

    async removeUser(id: number): Promise<void> {
      if (!getUser(db, id)) throw new NotFoundError(`no user in slot ${id}`)
      await ask(lock.clearUser(id))
      deleteUser(db, id)
    },

    async sync(): Promise<{ users: User[]; syncedAt: string }> {
      const slots = await ask(lock.listSlots())
      const syncedAt = now()
      mergeSlotsFromLock(db, slots, syncedAt)
      return { users: listUsers(db), syncedAt }
    },
  }
}

export type Services = ReturnType<typeof createServices>
