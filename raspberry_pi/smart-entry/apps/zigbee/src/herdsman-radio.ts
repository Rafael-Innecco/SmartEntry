import { Controller, Zcl, type Models } from "zigbee-herdsman"

import { createCoordinator } from "./coordinator.js"
import type { readCoordinatorConfig } from "./coordinator-config.js"
import { LOCK_CLUSTER_ID, LOCK_ENDPOINT } from "./lock-protocol.js"
import { timeAttributes, type TrustedClock } from "./trusted-clock.js"
import type { LockRadio } from "./zigbee-lock-transport.js"

export const smartEntryCluster = {
  ID: LOCK_CLUSTER_ID,
  name: "smartEntry",
  attributes: {},
  commands: {
    request: {
      ID: 0,
      name: "request",
      parameters: [{ name: "payload", type: Zcl.DataType.OCTET_STR }],
    },
  },
  commandsResponse: {
    response: {
      ID: 1,
      name: "response",
      parameters: [{ name: "payload", type: Zcl.DataType.OCTET_STR }],
    },
    event: {
      ID: 2,
      name: "event",
      parameters: [{ name: "payload", type: Zcl.DataType.OCTET_STR }],
    },
  },
} as const

type SmartEntryTypes = {
  attributes: never
  commands: { request: { payload: Buffer } }
  commandResponses: never
}

const TIME_CLUSTER_ID = 0x000a

/**
 * Registers the ZCL Time cluster (0x000a) as a server input cluster on the
 * coordinator's endpoint so that herdsman routes Read Attributes frames from
 * end-devices to the customReadResponse handler instead of rejecting them with
 * a Default Response / UNSUPPORTED_CLUSTER (0xc3).
 */
export function registerTimeClusterOnCoordinator(
  controller: Controller
): void {
  for (const device of controller.getDevicesIterator()) {
    if (device.type !== "Coordinator") continue
    for (const endpoint of device.endpoints) {
      if (!endpoint.inputClusters.includes(TIME_CLUSTER_ID)) {
        endpoint.inputClusters.push(TIME_CLUSTER_ID)
      }
    }
  }
}

/**
 * Installs a customReadResponse hook on the given device (must be the
 * coordinator device, which acts as the ZCL Time Server) so that incoming
 * Read Attributes requests for cluster 0x000a are answered with the
 * NTP-synced system time and the library's default response is suppressed.
 */
export function installTimeGuard(
  device: Models.Device,
  clock: TrustedClock
): void {
  device.customReadResponse = (frame, endpoint) => {
    if (frame.cluster.ID !== TIME_CLUSTER_ID) return false
    const ids = (frame.payload as { attrId: number }[]).map(
      (item) => item.attrId
    )
    void timeAttributes(clock)
      .then(async (attributes) => {
        const response: Record<
          number,
          { value: number | undefined; type: number }
        > = {}
        for (const id of ids) {
          response[id] =
            id === 0
              ? { value: attributes.time, type: Zcl.DataType.UTC }
              : id === 1
                ? { value: attributes.timeStatus, type: Zcl.DataType.BITMAP8 }
                : { value: undefined, type: Zcl.DataType.NO_DATA }
        }
        await endpoint.readResponse(
          TIME_CLUSTER_ID,
          frame.header.transactionSequenceNumber,
          response,
          {
            disableRecovery: true,
            sendPolicy: "immediate",
            timeout: 2000,
          }
        )
      })
      .catch(() => {
        /* No unguarded fallback on errors. */
      })
    return true
  }
}

export class HerdsmanRadio implements LockRadio {
  private controller?: Controller
  private running = false
  private packetHandler?: (payload: Buffer) => void
  private disconnectHandler?: () => void
  private disconnected = new AbortController()
  private startupComplete = false

  constructor(
    private readonly config: ReturnType<typeof readCoordinatorConfig>,
    private readonly clock: TrustedClock
  ) {
    if (!config.lockIeee) throw new Error("SMART_ENTRY_LOCK_IEEE is required")
  }
  onPacket(handler: (payload: Buffer) => void): void {
    this.packetHandler = handler
  }
  onDisconnect(handler: () => void): void {
    this.disconnectHandler = handler
  }
  get disconnectSignal(): AbortSignal {
    return this.disconnected.signal
  }
  isRunning(): boolean {
    return this.running
  }
  isReady(): boolean {
    return (
      this.running &&
      !this.disconnected.signal.aborted &&
      this.controller?.getDeviceByIeeeAddr(this.config.lockIeee!)
        ?.interviewState === "SUCCESSFUL"
    )
  }

  async start(signal: AbortSignal): Promise<void> {
    this.startupComplete = false
    this.disconnected = new AbortController()
    const controller = createCoordinator(this.config)
    this.controller = controller
    const configureLock = (device: Models.Device) => {
      if (device.ieeeAddr.toLowerCase() === this.config.lockIeee)
        device.addCustomCluster("smartEntry", smartEntryCluster)
    }
    controller.on("deviceJoined", ({ device }) => configureLock(device))
    controller.on("deviceAnnounce", ({ device }) => configureLock(device))
    controller.on("adapterDisconnected", () => {
      this.running = false
      this.disconnected.abort()
      this.disconnectHandler?.()
    })
    controller.on("message", (message) => {
      configureLock(message.device)
      if (
        message.device.ieeeAddr.toLowerCase() !== this.config.lockIeee ||
        message.endpoint.ID !== LOCK_ENDPOINT ||
        (message.cluster !== LOCK_CLUSTER_ID &&
          message.cluster !== "smartEntry")
      )
        return
      const raw = message.meta.rawData
      // Cluster-specific, server->client, no manufacturer field. OCTET_STR length is exact.
      if (
        raw.length < 4 ||
        (raw[0]! & 0x0f) !== 9 ||
        ![1, 2].includes(raw[2]!) ||
        raw.length !== raw[3]! + 4
      )
        return
      if (raw[4 + 1] !== raw[2]) return // ZCL response/event must match authenticated kind.
      this.packetHandler?.(raw.subarray(4))
    })
    await controller.start(signal)
    signal.throwIfAborted()
    await controller.permitJoin(0)
    // Register 0x000a as a server input cluster on the coordinator so herdsman
    // routes Read Attributes frames from end-devices (instead of replying with
    // UNSUPPORTED_CLUSTER / 0xc3), then install the customReadResponse guard.
    registerTimeClusterOnCoordinator(controller)
    for (const device of controller.getDevicesIterator()) {
      if (device.type === "Coordinator") installTimeGuard(device, this.clock)
      else configureLock(device)
    }
    this.running = true
    this.startupComplete = true
  }

  async send(payload: Buffer, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    if (!this.isReady()) throw new Error("Radio unavailable")
    const endpoint = this.controller!.getDeviceByIeeeAddr(
      this.config.lockIeee!
    )!.getEndpoint(LOCK_ENDPOINT)
    if (!endpoint) throw new Error("Lock endpoint unavailable")
    signal.throwIfAborted()
    await endpoint.command<"smartEntry", "request", SmartEntryTypes>(
      "smartEntry",
      "request",
      { payload },
      {
        disableResponse: true,
        disableDefaultResponse: true,
        disableRecovery: true,
        sendPolicy: "immediate",
        timeout: 10_000,
      }
    )
  }

  async stop(): Promise<void> {
    this.running = false
    this.disconnected.abort()
    this.disconnectHandler?.()
    const controller = this.controller
    this.controller = undefined
    if (!controller) return
    // Controller.stop closes joining when the adapter is reachable.
    try {
      await controller.stop()
    } finally {
      controller.removeAllListeners()
    }
    if (!this.startupComplete)
      throw new Error(
        "Incomplete coordinator startup; process restart required"
      )
  }
}
