import { createDb, listUsers } from "@workspace/db"

import { createApp } from "./app.js"
import { createFakeLockTransport } from "./fake-lock-transport.js"

const dbPath = process.env.SMART_ENTRY_DB_PATH ?? "./data/smart-entry.sqlite3"
const port = Number(process.env.SMART_ENTRY_ZIGBEE_PORT ?? 4000)

const db = createDb(dbPath)

// A real lock keeps its slots in flash across restarts. Seeding the fake from
// the replica mimics that, so the startup sync doesn't wipe users in dev.
const lock = createFakeLockTransport({ initialSlots: listUsers(db) })

const { server, services } = createApp({ db, lock })

server.listen(port, "127.0.0.1", () => {
  console.log(`apps/zigbee listening on 127.0.0.1:${port}`)
  services.sync().then(
    ({ users }) => console.log(`startup sync done: ${users.length} user(s)`),
    (err: unknown) => {
      const reason = err instanceof Error ? err.message : String(err)
      console.warn(`startup sync failed, serving the existing replica: ${reason}`)
    }
  )
})
