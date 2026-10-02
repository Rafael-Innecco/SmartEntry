import type { AccessEvent, AccessLogEntry, AccessMethod, AccessResult } from "@workspace/shared"

import type { SmartEntryDb } from "./client.js"

export const ACCESS_LOG_MAX_ENTRIES = 500

interface AccessLogRow {
  id: number
  slot: number | null
  method: AccessMethod
  result: AccessResult
  received_at: string
}

/** Appends an event and drops everything beyond the newest ACCESS_LOG_MAX_ENTRIES. */
export function addAccessEvent(db: SmartEntryDb, event: AccessEvent, receivedAt: string): void {
  db.transaction(() => {
    db.prepare(
      "INSERT INTO access_log (slot, method, result, received_at) VALUES (?, ?, ?, ?)"
    ).run(event.slot, event.method, event.result, receivedAt)
    db.prepare(
      "DELETE FROM access_log WHERE id NOT IN (SELECT id FROM access_log ORDER BY id DESC LIMIT ?)"
    ).run(ACCESS_LOG_MAX_ENTRIES)
  })()
}

/** Newest first. */
export function listAccessLog(db: SmartEntryDb, limit: number): AccessLogEntry[] {
  const rows = db
    .prepare("SELECT * FROM access_log ORDER BY id DESC LIMIT ?")
    .all(limit) as AccessLogRow[]
  return rows.map((row) => ({
    id: row.id,
    slot: row.slot,
    method: row.method,
    result: row.result,
    receivedAt: row.received_at,
  }))
}
