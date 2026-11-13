import { readFileSync, statSync } from "node:fs"

import { createDb, listUsers } from "@workspace/db"

import { createApp } from "./app.js"
import { readCoordinatorConfig } from "./coordinator-config.js"
import { acquireCoordinatorLease } from "./coordinator.js"
import { ConfigError } from "./errors.js"
import { createFakeLockTransport } from "./fake-lock-transport.js"
import { HerdsmanRadio } from "./herdsman-radio.js"
import type { LockTransport } from "./lock-transport.js"
import { createTrustedClock } from "./trusted-clock.js"
import { ZigbeeLockTransport } from "./zigbee-lock-transport.js"
import { superviseRadio } from "./zigbee-supervisor.js"

function errorCode(err: unknown): string {
  return (err as NodeJS.ErrnoException).code ?? "error"
}

/** Reads the 32-byte HMAC key. Errors name the file, never its content. */
function readLockKey(keyPath: string): Buffer {
  let key: Buffer
  try {
    if (
      process.platform !== "win32" &&
      (statSync(keyPath).mode & 0o077) !== 0
    ) {
      throw new ConfigError(
        `HMAC key file ${keyPath} must not be accessible by group or others (use chmod 600)`
      )
    }
    key = readFileSync(keyPath)
  } catch (err) {
    if (err instanceof ConfigError) throw err
    throw new ConfigError(
      `Cannot read the HMAC key file ${keyPath} (${errorCode(err)}); see docs/protocolo-zigbee-v1.md`
    )
  }
  if (key.length !== 32)
    throw new ConfigError(
      `HMAC key file ${keyPath} must contain exactly 32 raw bytes`
    )
  return key
}

async function main(): Promise<void> {
  const transport = process.env.SMART_ENTRY_TRANSPORT ?? "fake"
  if (transport !== "fake" && transport !== "zigbee")
    throw new ConfigError(
      `SMART_ENTRY_TRANSPORT must be "fake" or "zigbee", got "${transport}"`
    )
  const port = Number(process.env.SMART_ENTRY_ZIGBEE_PORT ?? 4000)
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new ConfigError("SMART_ENTRY_ZIGBEE_PORT must be between 1 and 65535")
  const dbPath = process.env.SMART_ENTRY_DB_PATH ?? "./data/smart-entry.sqlite3"
  let db: ReturnType<typeof createDb>
  try {
    db = createDb(dbPath)
  } catch (err) {
    throw new ConfigError(
      `Cannot open the database at ${dbPath} (${errorCode(err)})`
    )
  }
  const abort = new AbortController()
  let release: (() => void) | undefined
  let radio: HerdsmanRadio | undefined
  let lock: LockTransport
  try {
    if (transport === "zigbee") {
      if (process.env.SMART_ENTRY_ZIGBEE_PROTOCOL !== "smart-entry-v1") {
        throw new ConfigError(
          "Real transport requires explicit SMART_ENTRY_ZIGBEE_PROTOCOL=smart-entry-v1; firmware must implement the proposed contract"
        )
      }
      const config = readCoordinatorConfig(process.env)
      if (!config.lockIeee)
        throw new ConfigError("SMART_ENTRY_LOCK_IEEE is required")
      const keyPath = process.env.SMART_ENTRY_LOCK_HMAC_KEY_PATH
      if (!keyPath)
        throw new ConfigError("SMART_ENTRY_LOCK_HMAC_KEY_PATH is required")
      const key = readLockKey(keyPath)
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
      const onError = (err: unknown) =>
        reject(
          new ConfigError(
            `Cannot listen on 127.0.0.1:${port} (${errorCode(err)})`
          )
        )
      server.once("error", onError)
      server.listen(port, "127.0.0.1", () => {
        server.removeListener("error", onError)
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

main().catch((err: unknown) => {
  // Driver errors may include key material; only our own setup checks are printed.
  console.error(
    err instanceof ConfigError
      ? `SmartEntry startup failed: ${err.message}`
      : "SmartEntry startup/shutdown failed; check configuration, state directory and coordinator access"
  )
  process.exitCode = 1
  const force = setTimeout(() => process.exit(1), 1000)
  force.unref()
})
