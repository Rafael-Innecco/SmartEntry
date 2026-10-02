import { z } from "zod"

/** A lock slot number. The lock has exactly 10 slots, one per user. */
export const slotIdSchema = z.number().int().min(0).max(9)

const userNameSchema = z.string().trim().min(1).max(64)

/**
 * A user slot as replicated on the Raspberry Pi. The lock (fechadura) is the
 * source of truth for credentials, so this shape intentionally omits the TOTP
 * secret and the raw RFID tag value — the replica only needs to know whether
 * each factor has been set up. The name is Pi-owned metadata: the lock never
 * stores it.
 */
export const userSchema = z.object({
  id: slotIdSchema,
  name: userNameSchema,
  hasTotp: z.boolean(),
  hasRfid: z.boolean(),
  createdAt: z.string().datetime(),
  syncedAt: z.string().datetime().nullable(),
})
export type User = z.infer<typeof userSchema>

export const newUserSchema = z.object({
  id: slotIdSchema,
  name: userNameSchema,
})
export type NewUser = z.infer<typeof newUserSchema>

/** What the lock reports for an occupied slot during a sync. */
export const lockSlotSchema = userSchema.pick({ id: true, hasTotp: true, hasRfid: true })
export type LockSlot = z.infer<typeof lockSlotSchema>

export const renameUserRequestSchema = z.object({
  name: userNameSchema,
})
