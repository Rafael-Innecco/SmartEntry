import { readFileSync, statSync } from "node:fs"

import { createDb, listUsers } from "@workspace/db"

import { createApp } from "./app.js"
import { readCoordinatorConfig } from "./coordinator-config.js"
import { acquireCoordinatorLease } from "./coordinator.js"
import { createFakeLockTransport } from "./fake-lock-transport.js"
import { HerdsmanRadio } from "./herdsman-radio.js"
import type { LockTransport } from "./lock-transport.js"
import { createTrustedClock } from "./trusted-clock.js"
import { ZigbeeLockTransport } from "./zigbee-lock-transport.js"
import { superviseRadio } from "./zigbee-supervisor.js"

async function main(): Promise<void> {
  const transport = process.env.SMART_ENTRY_TRANSPORT ?? "fake"
  if (transport !== "fake" && transport !== "zigbee")
    throw new Error("Unsupported SMART_ENTRY_TRANSPORT")
  const port = Number(process.env.SMART_ENTRY_ZIGBEE_PORT ?? 4000)
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid HTTP port")
  const db = createDb(
    process.env.SMART_ENTRY_DB_PATH ?? "./data/smart-entry.sqlite3"
  )
  const abort = new AbortController()
  let release: (() => void) | undefined
  let radio: HerdsmanRadio | undefined
  let lock: LockTransport
  try {
    if (transport === "zigbee") {
      if (process.env.SMART_ENTRY_ZIGBEE_PROTOCOL !== "smart-entry-v1") {
        throw new Error(
          "Real transport requires explicit SMART_ENTRY_ZIGBEE_PROTOCOL=smart-entry-v1; firmware must implement the proposed contract"
        )
      }
      const config = readCoordinatorConfig(process.env)
      if (!config.lockIeee) throw new Error("SMART_ENTRY_LOCK_IEEE is required")
      const keyPath = process.env.SMART_ENTRY_LOCK_HMAC_KEY_PATH
      if (!keyPath)
        throw new Error("SMART_ENTRY_LOCK_HMAC_KEY_PATH is required")
      if (
        process.platform !== "win32" &&
        (statSync(keyPath).mode & 0o077) !== 0
      ) {
        throw new Error(
          "HMAC key file must not be accessible by group or others"
        )
      }
      const key = readFileSync(keyPath)
      if (key.length !== 32)
        throw new Error("HMAC key file must contain exactly 32 raw bytes")
      const clock = createTrustedClock()
      radio = new HerdsmanRadio(config, clock)
      release = acquireCoordinatorLease(config.stateDir)
      lock = new ZigbeeLockTransport({
        db,
        radio,
        key,
        ieee: config.lockIeee,
        clock,
      })
    } else {
      const fake = createFakeLockTransport({ initialSlots: listUsers(db) })
      fake.configure({
        delayMs: Number(process.env.SMART_ENTRY_FAKE_DELAY_MS ?? 0),
        unreachable: process.env.SMART_ENTRY_FAKE_UNREACHABLE === "1",
      })
      lock = fake
    }
    const { server, services } = createApp({ db, lock })
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(port, "127.0.0.1", () => {
        server.removeListener("error", reject)
        resolve()
      })
    })
    console.log(`apps/zigbee listening on 127.0.0.1:${port} (${transport})`)
    let failed = false
    const supervision = radio
      ? superviseRadio({
          radio,
          sync: () => services.sync(),
          signal: abort.signal,
        }).catch(() => {
          failed = true
          console.error("Zigbee coordinator stopped; process restart required")
          abort.abort()
        })
      : services
          .sync()
          .catch(() =>
            console.warn("Startup sync failed; existing replica retained")
          )
    const stop = () => abort.abort()
    process.once("SIGINT", stop)
    process.once("SIGTERM", stop)
    if (!abort.signal.aborted)
      await new Promise<void>((resolve) =>
        abort.signal.addEventListener("abort", () => resolve(), { once: true })
      )
    const force = setTimeout(() => process.exit(1), 10_000)
    force.unref()
    try {
      const closed = new Promise<void>((resolve) =>
        server.close(() => resolve())
      )
      server.closeIdleConnections()
      await supervision
      await closed
    } finally {
      process.removeListener("SIGINT", stop)
      process.removeListener("SIGTERM", stop)
    }
    if (failed) process.exitCode = 1
  } finally {
    db.close()
    release?.()
  }
}

main().catch(() => {
  // Configuration/driver errors may include key material; never dump raw errors.
  console.error(
    "SmartEntry startup/shutdown failed; check configuration, state directory and coordinator access"
  )
  process.exitCode = 1
  const force = setTimeout(() => process.exit(1), 1000)
  force.unref()
})
