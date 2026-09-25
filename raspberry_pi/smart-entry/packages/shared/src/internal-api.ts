import { z } from "zod"

import { lockStatusSchema } from "./lock-status.js"
import { newUserSchema, userSchema } from "./user.js"

/**
 * Payload shapes for apps/zigbee's internal HTTP API (127.0.0.1:4000),
 * consumed by apps/web's API routes. Only the four routes named in the
 * architecture doc (/status, /unlock, /users, /sync) are covered — exact
 * HTTP methods and paths are an apps/zigbee implementation detail, not
 * fixed here.
 *
 * The ZigBee wire protocol itself (what apps/zigbee actually sends the
 * lock) is a separate, still-open decision and is intentionally not
 * modeled in this package yet.
 */

/** GET /status */
export const statusResponseSchema = lockStatusSchema

/** GET /users */
export const usersResponseSchema = z.object({
  users: z.array(userSchema),
})

/** register a new user (used by the /users route) */
export const registerUserRequestSchema = newUserSchema
export const registerUserResponseSchema = z.object({
  user: userSchema,
})

/** remove a user (used by the /users route) */
export const removeUserRequestSchema = z.object({
  id: z.number().int().min(0).max(9),
})

/** POST /unlock */
export const unlockResponseSchema = z.object({
  ok: z.boolean(),
})

/** POST /sync — pulls the full user list from the lock */
export const syncResponseSchema = z.object({
  users: z.array(userSchema),
  syncedAt: z.string().datetime(),
})
