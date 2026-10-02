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
       RETURNING hmac_counter`
    )
    .get() as { hmac_counter: number }
  return row.hmac_counter
}
