import "server-only"

import { createZigbeeClient } from "./zigbee-client"

export const zigbee = createZigbeeClient(
  process.env.SMART_ENTRY_ZIGBEE_URL ?? "http://127.0.0.1:4000"
)
