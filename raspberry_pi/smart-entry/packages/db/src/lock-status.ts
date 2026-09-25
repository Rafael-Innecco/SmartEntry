import type { LockStatus } from "@workspace/shared"

import type { SmartEntryDb } from "./client.js"

interface LockStatusRow {
  locked: number
  updated_at: string
}

export function getLockStatus(db: SmartEntryDb): LockStatus | undefined {
  const row = db
    .prepare("SELECT locked, updated_at FROM lock_status WHERE id = 1")
    .get() as LockStatusRow | undefined
  return row ? { locked: Boolean(row.locked), updatedAt: row.updated_at } : undefined
}

export function setLockStatus(db: SmartEntryDb, status: LockStatus): void {
  db.prepare(
    `INSERT INTO lock_status (id, locked, updated_at)
     VALUES (1, @locked, @updatedAt)
     ON CONFLICT(id) DO UPDATE SET locked = excluded.locked, updated_at = excluded.updated_at`
  ).run({ locked: status.locked ? 1 : 0, updatedAt: status.updatedAt })
}
