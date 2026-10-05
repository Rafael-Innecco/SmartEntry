"use server"

import { refresh } from "next/cache"

import { verifySession } from "@/lib/dal"
import { errorMessage, type ActionResult } from "@/lib/messages"
import { zigbee } from "@/lib/zigbee"

export async function unlockDoor(): Promise<ActionResult> {
  await verifySession()
  const result = await zigbee.unlock()
  // Success or failure, the access log changed.
  refresh()
  return result.ok ? { ok: true } : { ok: false, message: errorMessage(result.error, "unlock") }
}
