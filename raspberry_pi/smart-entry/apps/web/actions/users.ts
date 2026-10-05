"use server"

import { newUserSchema, renameUserRequestSchema, slotIdSchema } from "@workspace/shared"
import { refresh } from "next/cache"
import { toString as renderQr } from "qrcode"

import { verifySession } from "@/lib/dal"
import { errorMessage, type ActionResult, type RegisterResult } from "@/lib/messages"
import { zigbee } from "@/lib/zigbee"

const INVALID_NAME = "Use um nome de 1 a 64 caracteres."

export async function registerUser(input: { id: number; name: string }): Promise<RegisterResult> {
  await verifySession()
  const parsed = newUserSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: `${INVALID_NAME} O slot vai de 0 a 9.` }

  const result = await zigbee.registerUser(parsed.data)
  if (!result.ok) return { ok: false, message: errorMessage(result.error) }
  refresh()

  const { user, totpUri } = result.data
  const qrSvg = await renderQr(totpUri, { type: "svg", margin: 1, errorCorrectionLevel: "M" })
  const secret = new URL(totpUri).searchParams.get("secret") ?? ""
  return { ok: true, name: user.name, slot: user.id, qrSvg, secret }
}

export async function renameUser(id: number, name: string): Promise<ActionResult> {
  await verifySession()
  const slot = slotIdSchema.safeParse(id)
  const body = renameUserRequestSchema.safeParse({ name })
  if (!slot.success || !body.success) return { ok: false, message: INVALID_NAME }

  const result = await zigbee.renameUser(slot.data, body.data.name)
  if (!result.ok) return { ok: false, message: errorMessage(result.error) }
  refresh()
  return { ok: true }
}

export async function removeUser(id: number): Promise<ActionResult> {
  await verifySession()
  const slot = slotIdSchema.safeParse(id)
  if (!slot.success) return { ok: false, message: errorMessage("invalid") }

  const result = await zigbee.removeUser(slot.data)
  if (!result.ok) return { ok: false, message: errorMessage(result.error) }
  refresh()
  return { ok: true }
}

export async function syncUsers(): Promise<ActionResult> {
  await verifySession()
  const result = await zigbee.sync()
  if (!result.ok) return { ok: false, message: errorMessage(result.error) }
  refresh()
  return { ok: true }
}
