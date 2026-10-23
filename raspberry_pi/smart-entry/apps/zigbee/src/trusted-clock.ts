import { execFile } from "node:child_process"
import { promisify } from "node:util"

import { ClockUnsyncedError } from "./errors.js"

export interface TrustedClock {
  unixSeconds(): Promise<number | undefined>
}

const exec = promisify(execFile)

/** Fail closed, including on Windows, missing timedatectl and command timeout. */
export function createTrustedClock(
  check: () => Promise<string> = async () =>
    (
      await exec(
        "timedatectl",
        ["show", "--property=NTPSynchronized", "--value"],
        {
          timeout: 1500,
          maxBuffer: 1024,
        }
      )
    ).stdout,
  now: () => number = Date.now
): TrustedClock {
  return {
    async unixSeconds() {
      try {
        if ((await check()).trim() !== "yes") return undefined
        const seconds = Math.floor(now() / 1000)
        if (seconds < 946684800 || seconds > 0xfffffff0) return undefined
        return seconds
      } catch {
        return undefined
      }
    },
  }
}

export async function requireTrustedTime(clock: TrustedClock): Promise<number> {
  const time = await clock.unixSeconds()
  if (time === undefined) throw new ClockUnsyncedError()
  return time
}

/** ZCL Time values: invalid time and timeStatus=0 when NTP is unavailable. */
export async function timeAttributes(clock: TrustedClock) {
  const unix = await clock.unixSeconds()
  return {
    time: unix === undefined ? 0xffffffff : unix - 946684800,
    timeStatus: unix === undefined ? 0 : 3, // master + synchronized
  }
}
