import { z } from "zod"

/**
 * A user slot as replicated on the Raspberry Pi. The lock (fechadura) is the
 * source of truth for credentials, so this shape intentionally omits the TOTP
 * secret and the raw RFID tag value — the replica only needs to know whether
 * each factor has been set up, for display and sync-staleness tracking.
 */
export const userSchema = z.object({
  id: z.number().int().min(0).max(9),
  name: z.string().min(1).max(64),
  hasTotp: z.boolean(),
  hasRfid: z.boolean(),
  createdAt: z.string().datetime(),
  syncedAt: z.string().datetime().nullable(),
})
export type User = z.infer<typeof userSchema>

export const newUserSchema = z.object({
  id: z.number().int().min(0).max(9),
  name: z.string().min(1).max(64),
})
export type NewUser = z.infer<typeof newUserSchema>
