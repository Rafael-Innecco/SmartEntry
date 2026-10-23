import type { SmartEntryDb } from "./client.js"

/**
 * Returns the next value of the counter that goes into each HMAC-signed
 * command. The lock rejects any counter it has already seen, so this must
 * never repeat — including across restarts, which is why it lives here.
 */
export function nextHmacCounter(db: SmartEntryDb): number {
  const row = db
    .prepare(
      `INSERT INTO link_state (id, hmac_counter) VALUES (1, 1)
       ON CONFLICT(id) DO UPDATE SET hmac_counter = hmac_counter + 1
       WHERE hmac_counter BETWEEN 0 AND 4294967294
       RETURNING hmac_counter`
    )
    .get() as { hmac_counter: number } | undefined
  if (!row)
    throw new Error("HMAC counter exhausted or invalid; re-provision the link")
  return row.hmac_counter
}

export function isLockSyncRequired(db: SmartEntryDb): boolean {
  const row = db
    .prepare("SELECT sync_required FROM lock_recovery WHERE id = 1")
    .get() as { sync_required: number }
  return row.sync_required === 1
}

export function setLockSyncRequired(db: SmartEntryDb, required: boolean): void {
  db.prepare("UPDATE lock_recovery SET sync_required = ? WHERE id = 1").run(
    required ? 1 : 0
  )
}
