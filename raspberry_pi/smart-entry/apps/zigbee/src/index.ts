import { createDb, getLockStatus, setLockStatus } from "@workspace/db"

import { createFakeLockTransport } from "./fake-lock-transport.js"
import { createHttpServer } from "./server.js"

const dbPath = process.env.SMART_ENTRY_DB_PATH ?? "./data/smart-entry.sqlite3"
const port = Number(process.env.SMART_ENTRY_ZIGBEE_PORT ?? 4000)

const db = createDb(dbPath)

// RNF4: never lose configuration and fail to a safe state. On a fresh DB (or
// after power loss before any status was ever pushed), assume locked until
// the lock says otherwise.
if (!getLockStatus(db)) {
  setLockStatus(db, { locked: true, updatedAt: new Date().toISOString() })
}

const lock = createFakeLockTransport()
lock.onStatusPush((status) => {
  setLockStatus(db, status)
})

const server = createHttpServer(db, lock)
server.listen(port, "127.0.0.1", () => {
  console.log(`apps/zigbee listening on 127.0.0.1:${port}`)
})
