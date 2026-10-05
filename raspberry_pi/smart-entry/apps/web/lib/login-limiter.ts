export interface LoginLimiterOptions {
  maxFailures?: number
  windowMs?: number
  lockMs?: number
  now?: () => number
}

/**
 * Global (not per-IP) limit on failed logins: there is a single admin, and
 * locking everyone out for a minute is an acceptable cost on a LAN.
 */
export function createLoginLimiter({
  maxFailures = 5,
  windowMs = 60_000,
  lockMs = 60_000,
  now = Date.now,
}: LoginLimiterOptions = {}) {
  let failures: number[] = []
  let lockedUntil = 0

  return {
    isLocked(): boolean {
      return now() < lockedUntil
    },

    recordFailure(): void {
      const at = now()
      failures = failures.filter((time) => at - time < windowMs)
      failures.push(at)
      if (failures.length >= maxFailures) {
        lockedUntil = at + lockMs
        failures = []
      }
    },

    reset(): void {
      failures = []
      lockedUntil = 0
    },
  }
}
