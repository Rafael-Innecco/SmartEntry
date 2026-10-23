import { randomBytes, randomInt } from "node:crypto"
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { z } from "zod"

const networkSchema = z.object({
  version: z.literal(1),
  channel: z.number().int().min(11).max(26),
  panID: z.number().int().min(1).max(65534),
  extendedPanID: z.string().regex(/^[a-f0-9]{16}$/),
  networkKey: z.string().regex(/^[a-f0-9]{32}$/),
})

export type NetworkIdentity = z.infer<typeof networkSchema>

export function readCoordinatorConfig(env: NodeJS.ProcessEnv) {
  const serialPath = env.SMART_ENTRY_ZIGBEE_SERIAL_PATH?.trim()
  if (!serialPath) throw new Error("SMART_ENTRY_ZIGBEE_SERIAL_PATH is required")
  const adapter = env.SMART_ENTRY_ZIGBEE_ADAPTER ?? "zstack"
  if (adapter !== "zstack")
    throw new Error("Only zstack is supported by this coordinator setup")
  const lockIeee = env.SMART_ENTRY_LOCK_IEEE?.trim().toLowerCase()
  if (lockIeee && !/^0x[a-f0-9]{16}$/.test(lockIeee)) {
    throw new Error(
      "SMART_ENTRY_LOCK_IEEE must be 0x followed by 16 hexadecimal digits"
    )
  }
  const baudRate = Number(env.SMART_ENTRY_ZIGBEE_BAUD_RATE ?? 115200)
  if (![115200, 230400, 460800].includes(baudRate))
    throw new Error("Unsupported Zigbee baud rate")
  return {
    serialPath,
    adapter,
    baudRate,
    lockIeee,
    stateDir: resolve(env.SMART_ENTRY_ZIGBEE_STATE_DIR ?? "./data/zigbee"),
  }
}

/** Explicit first-time setup only. Never replace a missing identity on startup. */
export function initializeNetwork(stateDir: string, channel: number): void {
  if (!Number.isInteger(channel) || channel < 11 || channel > 26) {
    throw new Error("Zigbee channel must be an integer between 11 and 26")
  }
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  if (readdirSync(stateDir).length !== 0) {
    throw new Error(
      "Network initialization requires an empty state directory; preserve existing network data"
    )
  }
  const identity: NetworkIdentity = {
    version: 1,
    channel,
    panID: randomInt(1, 65535),
    extendedPanID: randomBytes(8).toString("hex"),
    networkKey: randomBytes(16).toString("hex"),
  }
  writeFileSync(
    join(stateDir, "network.json"),
    JSON.stringify(identity, null, 2) + "\n",
    {
      flag: "wx",
      mode: 0o600,
    }
  )
}

export function loadNetwork(stateDir: string): NetworkIdentity {
  let raw: string
  try {
    raw = readFileSync(join(stateDir, "network.json"), "utf8")
  } catch {
    throw new Error(
      "Cannot read network.json; restore the network identity or run coordinator init for a new network"
    )
  }
  // Never include the invalid input in diagnostics: it contains the network key.
  try {
    return networkSchema.parse(JSON.parse(raw))
  } catch {
    throw new Error("Invalid network.json; restore a valid network identity")
  }
}
