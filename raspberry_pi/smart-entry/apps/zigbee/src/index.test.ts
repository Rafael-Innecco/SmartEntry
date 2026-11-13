import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const entry = fileURLToPath(new URL("./index.ts", import.meta.url))

/** Starts the real service process and returns what it printed to stderr. */
function startService(env: Record<string, string>, dir: string) {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("SMART_ENTRY_"))
  )
  const result = spawnSync(process.execPath, ["--import", "tsx", entry], {
    cwd: dirname(dirname(entry)),
    env: { ...inherited, SMART_ENTRY_DB_PATH: join(dir, "db.sqlite3"), ...env },
    encoding: "utf8",
    timeout: 30_000,
  })
  return { status: result.status, stderr: result.stderr }
}

function withTempDir(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "smart-entry-startup-"))
  try {
    run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const ZIGBEE = {
  SMART_ENTRY_TRANSPORT: "zigbee",
  SMART_ENTRY_ZIGBEE_PROTOCOL: "smart-entry-v1",
  SMART_ENTRY_ZIGBEE_SERIAL_PATH: "/dev/serial/by-id/test",
  SMART_ENTRY_LOCK_IEEE: "0x00124b0000000001",
}

test("startup names the configuration problem in the log", () => {
  withTempDir((dir) => {
    const cases: [Record<string, string>, RegExp][] = [
      [{ SMART_ENTRY_TRANSPORT: "zigbe" }, /must be "fake" or "zigbee", got "zigbe"/],
      [{ SMART_ENTRY_TRANSPORT: "zigbee" }, /requires explicit SMART_ENTRY_ZIGBEE_PROTOCOL/],
      [{ ...ZIGBEE, SMART_ENTRY_ZIGBEE_SERIAL_PATH: "" }, /SMART_ENTRY_ZIGBEE_SERIAL_PATH is required/],
      [
        { ...ZIGBEE, SMART_ENTRY_LOCK_HMAC_KEY_PATH: join(dir, "missing.key") },
        /Cannot read the HMAC key file .*missing\.key \(ENOENT\)/,
      ],
    ]
    for (const [env, expected] of cases) {
      const { status, stderr } = startService(env, dir)
      assert.equal(status, 1, stderr)
      assert.match(stderr, /SmartEntry startup failed: /)
      assert.match(stderr, expected)
    }
  })
})

test("startup errors never print the key content", () => {
  withTempDir((dir) => {
    const keyPath = join(dir, "short.key")
    writeFileSync(keyPath, "SECRET-KEY-MATERIAL", { mode: 0o600 })
    const { status, stderr } = startService(
      { ...ZIGBEE, SMART_ENTRY_LOCK_HMAC_KEY_PATH: keyPath },
      dir
    )
    assert.equal(status, 1, stderr)
    assert.match(stderr, /must contain exactly 32 raw bytes/)
    assert.equal(stderr.includes("SECRET-KEY-MATERIAL"), false)
  })
})
