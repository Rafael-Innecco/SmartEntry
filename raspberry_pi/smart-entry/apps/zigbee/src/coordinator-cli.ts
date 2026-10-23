import { setTimeout as delay } from "node:timers/promises"

import {
  initializeNetwork,
  readCoordinatorConfig,
} from "./coordinator-config.js"
import {
  acquireCoordinatorLease,
  createCoordinator,
  runCoordinatorSession,
} from "./coordinator.js"
import { installTimeGuard } from "./herdsman-radio.js"
import { createTrustedClock } from "./trusted-clock.js"

async function main(): Promise<void> {
  const [command, argument, ...extra] = process.argv.slice(2)
  if (
    !["init", "diagnose", "pair", "probe"].includes(command ?? "") ||
    extra.length
  ) {
    throw new Error(
      "Usage: coordinator init <channel 11..26> | diagnose | pair <seconds 1..180> | probe"
    )
  }
  if (
    (command === "diagnose" || command === "probe") &&
    argument !== undefined
  ) {
    throw new Error(`${command} does not accept arguments`)
  }
  const config = readCoordinatorConfig(process.env)
  if (command === "init") {
    initializeNetwork(config.stateDir, Number(argument))
    console.log("Network identity created. This has not yet started the radio.")
    return
  }
  if ((command === "pair" || command === "probe") && !config.lockIeee) {
    throw new Error("SMART_ENTRY_LOCK_IEEE is required for pair/probe")
  }
  const seconds = Number(argument)
  if (
    command === "pair" &&
    (!Number.isInteger(seconds) || seconds < 1 || seconds > 180)
  ) {
    throw new Error(
      "Pairing duration must be an integer between 1 and 180 seconds"
    )
  }

  const controller = createCoordinator(config)
  const clock = createTrustedClock()
  controller.on("message", ({ device }) => installTimeGuard(device, clock))
  controller.on("deviceJoined", ({ device }) => installTimeGuard(device, clock))
  const release = acquireCoordinatorLease(config.stateDir)
  const abort = new AbortController()
  const interrupt = () => abort.abort()
  process.once("SIGINT", interrupt)
  process.once("SIGTERM", interrupt)
  controller.on("adapterDisconnected", interrupt)
  // Only metadata is printed: never raw payloads, credentials or keys.
  controller.on("deviceInterview", ({ device, status }) => {
    console.log(
      JSON.stringify({ event: "interview", ieee: device.ieeeAddr, status })
    )
  })
  try {
    await runCoordinatorSession(controller, abort.signal, async () => {
      for (const device of controller.getDevicesIterator())
        installTimeGuard(device, clock)
      console.log(
        JSON.stringify(
          {
            firmware: await controller.getCoordinatorVersion(),
            network: await controller.getNetworkParameters(),
            devices: [...controller.getDevicesIterator()].map((device) => ({
              ieee: device.ieeeAddr,
              type: device.type,
              interview: device.interviewState,
              endpoints: device.endpoints.map((endpoint) => ({
                id: endpoint.ID,
                inputClusters: endpoint.inputClusters,
                outputClusters: endpoint.outputClusters,
              })),
            })),
          },
          null,
          2
        )
      )
      abort.signal.throwIfAborted()
      if (command === "pair") {
        console.log(
          `Pairing permitted for ${seconds} seconds; only ${config.lockIeee} is accepted.`
        )
        await controller.permitJoin(seconds)
        await delay(seconds * 1000, undefined, { signal: abort.signal })
        const lock = controller.getDeviceByIeeeAddr(config.lockIeee!)
        if (lock?.interviewState !== "SUCCESSFUL") {
          throw new Error(
            "Pairing window ended without a successful interview of the configured lock"
          )
        }
        console.log(JSON.stringify({ event: "paired", ieee: config.lockIeee }))
      } else if (command === "probe") {
        const device = controller.getDeviceByIeeeAddr(config.lockIeee!)
        const endpoint = device?.getEndpoint(1)
        if (!endpoint)
          throw new Error(
            "Configured lock endpoint 1 not found; pair and diagnose first"
          )
        // Basic read verifies a real request/response without inventing lock commands.
        const basic = await endpoint.read(
          "genBasic",
          ["manufacturerName", "modelId"],
          {
            timeout: 10_000,
            disableRecovery: true,
          }
        )
        console.log(
          JSON.stringify({ event: "probe", ieee: config.lockIeee, basic })
        )
      }
    })
  } finally {
    process.removeListener("SIGINT", interrupt)
    process.removeListener("SIGTERM", interrupt)
    controller.removeListener("adapterDisconnected", interrupt)
    release()
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : "Coordinator failed")
  process.exitCode = 1
})
