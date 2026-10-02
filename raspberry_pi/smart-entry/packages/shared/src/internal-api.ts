import { z } from "zod"

import { accessLogEntrySchema } from "./access-log.js"
import { lockStatusSchema } from "./lock-status.js"
import { newUserSchema, userSchema } from "./user.js"

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
