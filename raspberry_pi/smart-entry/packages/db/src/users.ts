import type { LockSlot, User } from "@workspace/shared"

import type { SmartEntryDb } from "./client.js"

interface UserRow {
  id: number
  name: string
  has_totp: number
  has_rfid: number
  created_at: string
  synced_at: string | null
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    hasTotp: Boolean(row.has_totp),
    hasRfid: Boolean(row.has_rfid),
    createdAt: row.created_at,
    syncedAt: row.synced_at,
  }
}

export function listUsers(db: SmartEntryDb): User[] {
  const rows = db.prepare("SELECT * FROM users ORDER BY id").all() as UserRow[]
  return rows.map(rowToUser)
}

export function getUser(db: SmartEntryDb, id: number): User | undefined {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined
  return row ? rowToUser(row) : undefined
}

/** Insert a user, or update it in place if the id already exists. `createdAt` is preserved on update. */
export function upsertUser(db: SmartEntryDb, user: User): void {
  db.prepare(
    `INSERT INTO users (id, name, has_totp, has_rfid, created_at, synced_at)
     VALUES (@id, @name, @hasTotp, @hasRfid, @createdAt, @syncedAt)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       has_totp = excluded.has_totp,
       has_rfid = excluded.has_rfid,
       synced_at = excluded.synced_at`
  ).run({
    id: user.id,
    name: user.name,
    hasTotp: user.hasTotp ? 1 : 0,
    hasRfid: user.hasRfid ? 1 : 0,
    createdAt: user.createdAt,
    syncedAt: user.syncedAt,
  })
}

/** Returns false if there is no user in that slot. */
export function updateUserName(db: SmartEntryDb, id: number, name: string): boolean {
  return db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name, id).changes > 0
}

/** Returns false if there is no user in that slot. */
export function deleteUser(db: SmartEntryDb, id: number): boolean {
  return db.prepare("DELETE FROM users WHERE id = ?").run(id).changes > 0
}

/**
 * Reconciles the replica with the slot list pulled from the lock during a
 * full sync. The lock decides which slots exist and what credentials they
 * have; names are Pi-only metadata, so existing names are kept and slots the
 * Pi has never seen get a placeholder name. All-or-nothing.
 */
export function mergeSlotsFromLock(db: SmartEntryDb, slots: LockSlot[], syncedAt: string): void {
  const removeMissing = db.prepare(
    "DELETE FROM users WHERE id NOT IN (SELECT value FROM json_each(?))"
  )
  const upsertSlot = db.prepare(
    `INSERT INTO users (id, name, has_totp, has_rfid, created_at, synced_at)
     VALUES (@id, @name, @hasTotp, @hasRfid, @syncedAt, @syncedAt)
     ON CONFLICT(id) DO UPDATE SET
       has_totp = excluded.has_totp,
       has_rfid = excluded.has_rfid,
       synced_at = excluded.synced_at`
  )

  db.transaction(() => {
    removeMissing.run(JSON.stringify(slots.map((slot) => slot.id)))
    for (const slot of slots) {
      upsertSlot.run({
        id: slot.id,
        name: `Usuário ${slot.id}`,
        hasTotp: slot.hasTotp ? 1 : 0,
        hasRfid: slot.hasRfid ? 1 : 0,
        syncedAt,
      })
    }
  })()
}
