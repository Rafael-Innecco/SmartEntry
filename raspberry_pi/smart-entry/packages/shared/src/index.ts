// Kept as a single file on purpose: apps/web compiles this package with
// Turbopack, which cannot resolve NodeNext-style "./x.js" imports to ".ts"
// sources. With no relative imports it works under Next, tsx and tsc alike.
import { z } from "zod"

// Users

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

// Lock status

export const lockStatusSchema = z.object({
  locked: z.boolean(),
  updatedAt: z.string().datetime(),
})
export type LockStatus = z.infer<typeof lockStatusSchema>

// Access log

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

/** `userName` is the slot's name when the event was recorded; null for remote unlocks or unknown slots. */
export const accessLogEntrySchema = accessEventSchema.extend({
  id: z.number().int(),
  userName: z.string().nullable(),
  receivedAt: z.string().datetime(),
})
export type AccessLogEntry = z.infer<typeof accessLogEntrySchema>

// Internal API

/**
 * Payload shapes for apps/zigbee's internal HTTP API (127.0.0.1:4000),
 * consumed by apps/web. The ZigBee wire protocol itself (what apps/zigbee
 * sends the lock) is not modeled here.
 *
 * Errors come back as `{ error }` with: 400 invalid input, 404 unknown
 * user/route, 409 slot already in use, 503 lock unreachable, 504 lock did
 * not answer in time.
 */

export const errorResponseSchema = z.object({
  error: z.string(),
})

export const okResponseSchema = z.object({
  ok: z.literal(true),
})

/** GET /health */
export const healthResponseSchema = z.object({
  ok: z.literal(true),
  lockConnected: z.boolean(),
})

/** GET /status */
export const statusResponseSchema = lockStatusSchema

/** POST /unlock → okResponseSchema */

/** GET /users */
export const usersResponseSchema = z.object({
  users: z.array(userSchema),
})

/** POST /users — `totpUri` holds the secret and is returned only this once; show it as a QR code and drop it. */
export const registerUserRequestSchema = newUserSchema
export const registerUserResponseSchema = z.object({
  user: userSchema,
  totpUri: z.string().startsWith("otpauth://totp/"),
})

/** PATCH /users/:id — request body is renameUserRequestSchema */
export const renameUserResponseSchema = z.object({
  user: userSchema,
})

/** DELETE /users/:id → okResponseSchema */

/** POST /sync */
export const syncResponseSchema = z.object({
  users: z.array(userSchema),
  syncedAt: z.string().datetime(),
})

/** GET /access-log?limit=N (newest first) */
export const accessLogResponseSchema = z.object({
  entries: z.array(accessLogEntrySchema),
})
