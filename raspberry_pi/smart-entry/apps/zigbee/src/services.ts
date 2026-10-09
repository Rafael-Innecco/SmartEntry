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

import {
  ConflictError,
  LockBusyError,
  LockTimeoutError,
  NotFoundError,
  SyncRequiredError,
} from "./errors.js"
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
export function createServices(
  db: SmartEntryDb,
  lock: LockTransport,
  lockTimeoutMs: number
) {
  const ask = <T>(operation: Promise<T>) =>
    withTimeout(operation, lockTimeoutMs)
  let busy = false
  let syncRequired = false

  function assertAvailable(requireSync = true): void {
    if (busy) throw new LockBusyError()
    if (requireSync && syncRequired) throw new SyncRequiredError()
  }

  // Keep the gate until the underlying operation settles, even after HTTP 504.
  // Releasing it at the timeout would allow a late write to overwrite a new one.
  async function exclusive<T>(
    operation: () => Promise<T>,
    uncertainWrite = false,
    requireSync = true
  ): Promise<T> {
    assertAvailable(requireSync)
    busy = true
    const pending = Promise.resolve().then(operation)
    void pending.then(
      () => {
        busy = false
      },
      () => {
        busy = false
      }
    )
    try {
      return await ask(pending)
    } catch (err) {
      if (uncertainWrite && err instanceof LockTimeoutError) syncRequired = true
      throw err
    }
  }

  return {
    async unlock(): Promise<void> {
      try {
        await exclusive(() => lock.unlock(), false, false)
        addAccessEvent(
          db,
          { slot: null, method: "remote", result: "success" },
          now()
        )
      } catch (err) {
        addAccessEvent(
          db,
          { slot: null, method: "remote", result: "failure" },
          now()
        )
        throw err
      }
    },

    async registerUser({
      id,
      name,
    }: NewUser): Promise<{ user: User; totpUri: string }> {
      return exclusive(async () => {
        if (getUser(db, id))
          throw new ConflictError(`slot ${id} is already in use`)
        const secret = generateTotpSecret()
        await lock.setUser(id, secret)
        const confirmedAt = now()
        const user: User = {
          id,
          name,
          hasTotp: true,
          hasRfid: false,
          createdAt: confirmedAt,
          syncedAt: confirmedAt,
        }
        // Do not save a credential whose QR was already lost to an HTTP timeout.
        if (!syncRequired) upsertUser(db, user)
        return { user, totpUri: buildOtpauthUri(name, secret) }
      }, true)
    },

    renameUser(id: number, name: string): User {
      assertAvailable()
      if (!updateUserName(db, id, name))
        throw new NotFoundError(`no user in slot ${id}`)
      return getUser(db, id) as User
    },

    async removeUser(id: number): Promise<void> {
      return exclusive(async () => {
        if (!getUser(db, id)) throw new NotFoundError(`no user in slot ${id}`)
        await lock.clearUser(id)
        if (!syncRequired) deleteUser(db, id)
      }, true)
    },

    async sync(): Promise<{ users: User[]; syncedAt: string }> {
      return exclusive(
        async () => {
          const slots = await lock.listSlots()
          const syncedAt = now()
          mergeSlotsFromLock(db, slots, syncedAt)
          syncRequired = false
          return { users: listUsers(db), syncedAt }
        },
        false,
        false
      )
    },
  }
}

export type Services = ReturnType<typeof createServices>
