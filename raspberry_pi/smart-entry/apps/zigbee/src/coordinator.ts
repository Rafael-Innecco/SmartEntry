import { closeSync, openSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { Controller, setLogger } from "zigbee-herdsman"

import {
  loadNetwork,
  type readCoordinatorConfig,
} from "./coordinator-config.js"

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

/** Excludes a second SmartEntry coordinator using this state directory. */
export function acquireCoordinatorLease(stateDir: string): () => void {
  const path = join(stateDir, "coordinator.lock")
  let fd: number
  try {
    fd = openSync(path, "wx", 0o600)
  } catch {
    throw new Error(
      "Cannot acquire coordinator.lock; check permissions and whether a coordinator is already running"
    )
  }
  try {
    writeFileSync(fd, `${process.pid}\n`)
  } finally {
    closeSync(fd)
  }
  return () => unlinkSync(path)
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
