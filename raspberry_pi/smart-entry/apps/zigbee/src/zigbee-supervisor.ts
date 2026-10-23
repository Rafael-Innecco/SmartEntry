import { setTimeout as sleep } from "node:timers/promises"

export interface SupervisedRadio {
  start(signal: AbortSignal): Promise<void>
  stop(): Promise<void>
  isRunning(): boolean
  readonly disconnectSignal: AbortSignal
}

/** No reconnect overlaps an earlier controller; stop failure is fatal to the supervisor. */
export async function superviseRadio(options: {
  radio: SupervisedRadio
  sync: () => Promise<unknown>
  signal: AbortSignal
  report?: (message: string) => void
  pollMs?: number
  retryMs?: number
}): Promise<void> {
  const { radio, sync, signal, report = console.warn } = options
  let backoff = options.retryMs ?? 1000
  while (!signal.aborted) {
    try {
      await radio.start(signal)
      backoff = options.retryMs ?? 1000
      while (!signal.aborted && radio.isRunning()) {
        try {
          await sync()
        } catch {
          report("Zigbee sync pending; existing replica retained")
        }
        await sleep(options.pollMs ?? 30_000, undefined, {
          signal: AbortSignal.any([signal, radio.disconnectSignal]),
        })
      }
    } catch {
      if (!signal.aborted)
        report("Zigbee connection unavailable; reconnect scheduled")
    } finally {
      // Exit on cleanup errors so systemd restarts the entire process.
      await radio.stop()
    }
    if (!signal.aborted) {
      try {
        await sleep(backoff, undefined, { signal })
      } catch {
        break
      }
      backoff = Math.min(backoff * 2, 30_000)
    }
  }
}
