import { z } from "zod"

import { slotIdSchema } from "./user.js"

/** `remote` is logged by the Pi for web unlocks; the lock only reports keypad/RFID attempts. */
export const accessMethodSchema = z.enum(["totp", "rfid", "remote"])
export type AccessMethod = z.infer<typeof accessMethodSchema>

export const accessResultSchema = z.enum(["success", "failure"])
export type AccessResult = z.infer<typeof accessResultSchema>

export const accessEventSchema = z.object({
  slot: slotIdSchema.nullable(),
  method: accessMethodSchema,
  result: accessResultSchema,
})
export type AccessEvent = z.infer<typeof accessEventSchema>

export const accessLogEntrySchema = accessEventSchema.extend({
  id: z.number().int(),
  receivedAt: z.string().datetime(),
})
export type AccessLogEntry = z.infer<typeof accessLogEntrySchema>
