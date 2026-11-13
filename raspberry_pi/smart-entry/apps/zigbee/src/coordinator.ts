import { linkSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { Controller, setLogger } from "zigbee-herdsman"

import {
  loadNetwork,
  type readCoordinatorConfig,
} from "./coordinator-config.js"
import { ConfigError } from "./errors.js"

type CoordinatorConfig = ReturnType<typeof readCoordinatorConfig>

export function createCoordinator(config: CoordinatorConfig): Controller {
  // The default driver logger prints command payloads, including TOTP secrets.
  setLogger({
    debug() {},
    info() {},
    warning() {},
    error(_message, namespace) {
      console.error(`Zigbee driver error (${namespace})`)
    },
  })
  const network = loadNetwork(config.stateDir)
  return new Controller({
    network: {
      panID: network.panID,
      extendedPanID: [...Buffer.from(network.extendedPanID, "hex")],
      networkKey: [...Buffer.from(network.networkKey, "hex")],
      channelList: [network.channel],
      networkKeyDistribute: false,
    },
    transport: {
      path: config.serialPath,
      adapter: "zstack",
      baudRate: config.baudRate,
      rtscts: false,
    },
    adapter: { disableLED: false, concurrent: 1 },
    databasePath: join(config.stateDir, "database.db"),
    databaseBackupPath: join(config.stateDir, "database.db.backup"),
    backupPath: join(config.stateDir, "coordinator-backup.json"),
    acceptJoiningDeviceHandler: async (ieee) =>
      ieee.toLowerCase() === config.lockIeee,
  })
}

const BOOT_ID_PATH = "/proc/sys/kernel/random/boot_id"
const UNKNOWN_BOOT = "-"

/** Linux's random id for the current boot; null where unavailable (e.g. Windows). */
function currentBootId(): string | null {
  try {
    return readFileSync(BOOT_ID_PATH, "utf8").trim() || null
  } catch {
    return null
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM: the process exists but belongs to another user.
    return (err as NodeJS.ErrnoException).code === "EPERM"
  }
}

/**
 * Whether an existing lock was left by a coordinator that no longer runs:
 * written in an earlier boot (power loss, reboot) or by a process that died
 * (crash, SIGKILL). Locks are "<pid>\n<boot id>\n"; older versions wrote only
 * "<pid>\n" and could leave an empty file if power failed mid-write.
 */
export function isStaleLease(
  content: string,
  bootId: string | null,
  ownPid = process.pid,
  alive: (pid: number) => boolean = isProcessAlive
): boolean {
  const [pidText = "", recordedBoot = ""] = content.trim().split("\n")
  const pid = Number(pidText)
  if (!Number.isInteger(pid) || pid <= 0) return true
  const knownBoots =
    bootId !== null && recordedBoot !== "" && recordedBoot !== UNKNOWN_BOOT
  if (knownBoots && recordedBoot !== bootId) return true
  // A pid-only lock carrying our own pid can only come from a previous boot.
  if (pid === ownPid) return recordedBoot === ""
  return !alive(pid)
}

function readLease(path: string): string {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return ""
  }
}

/**
 * Excludes a second SmartEntry coordinator (service or bench CLI) using this
 * state directory, and reclaims a lock abandoned by a power loss or crash so
 * the service can come back without manual intervention.
 */
export function acquireCoordinatorLease(stateDir: string): () => void {
  const path = join(stateDir, "coordinator.lock")
  const bootId = currentBootId()
  const content = `${process.pid}\n${bootId ?? UNKNOWN_BOOT}\n`
  const temp = `${path}.${process.pid}.tmp`
  try {
    writeFileSync(temp, content, { mode: 0o600 })
  } catch (err) {
    throw new ConfigError(
      `Cannot write to ${stateDir} (${(err as NodeJS.ErrnoException).code ?? "error"}); check that the state directory exists and belongs to the service user`
    )
  }
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        // link() publishes the lock with its full content in one step, or fails if one exists.
        linkSync(temp, path)
        break
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
          throw new ConfigError(
            `Cannot create coordinator.lock in ${stateDir} (${(err as NodeJS.ErrnoException).code ?? "error"})`
          )
        }
        const existing = readLease(path)
        if (attempt > 1 || !isStaleLease(existing, bootId)) {
          const holder = existing.trim().split("\n")[0] || "unknown"
          throw new ConfigError(
            `coordinator.lock is held by running process ${holder}; stop that coordinator (service or bench CLI) first`
          )
        }
        try {
          unlinkSync(path)
        } catch (unlinkErr) {
          if ((unlinkErr as NodeJS.ErrnoException).code !== "ENOENT") throw unlinkErr
        }
        console.warn("Removed stale coordinator.lock left by a previous run")
      }
    }
  } finally {
    try {
      unlinkSync(temp)
    } catch {
      // Already gone; nothing to clean up.
    }
  }
  return () => {
    // Never delete a lock that another coordinator took over in the meantime.
    if (readLease(path) === content) unlinkSync(path)
  }
}

type SessionController = Pick<Controller, "start" | "permitJoin" | "stop">

/** Joining is closed before any action and on every normal/error exit. */
export async function runCoordinatorSession<T>(
  controller: SessionController,
  signal: AbortSignal,
  action: () => Promise<T>
): Promise<T> {
  const failures: unknown[] = []
  let result!: T
  try {
    await controller.start(signal)
    signal.throwIfAborted()
    await controller.permitJoin(0)
    result = await action()
  } catch (err) {
    failures.push(err)
  }
  try {
    await controller.permitJoin(0)
  } catch (err) {
    failures.push(err)
  }
  try {
    await controller.stop()
  } catch (err) {
    failures.push(err)
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) {
    throw new AggregateError(
      failures,
      failures
        .map((err) =>
          err instanceof Error ? err.message : "Coordinator operation failed"
        )
        .join("; ")
    )
  }
  return result
}
