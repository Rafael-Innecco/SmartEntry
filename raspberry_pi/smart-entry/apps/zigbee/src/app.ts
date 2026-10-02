import { addAccessEvent, getLockStatus, setLockStatus, type SmartEntryDb } from "@workspace/db"

import type { LockTransport } from "./lock-transport.js"
import { createHttpServer } from "./server.js"
import { createServices } from "./services.js"

export interface AppOptions {
  db: SmartEntryDb
  lock: LockTransport
  /** How long to wait for the lock to confirm a command (B3: it sleeps between polls). */
  lockTimeoutMs?: number
}

export function createApp({ db, lock, lockTimeoutMs = 15_000 }: AppOptions) {
  // RNF4: fail to a safe state. Until the lock reports otherwise, assume locked.
  if (!getLockStatus(db)) {
    setLockStatus(db, { locked: true, updatedAt: new Date().toISOString() })
  }

  lock.onStatusPush((status) => setLockStatus(db, status))
  lock.onAccessEvent((event) => addAccessEvent(db, event, new Date().toISOString()))

  const services = createServices(db, lock, lockTimeoutMs)
  const server = createHttpServer(db, lock, services)
  return { server, services }
}
