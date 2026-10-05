import {
  accessLogResponseSchema,
  healthResponseSchema,
  okResponseSchema,
  registerUserResponseSchema,
  renameUserResponseSchema,
  statusResponseSchema,
  syncResponseSchema,
  usersResponseSchema,
  type NewUser,
} from "@workspace/shared"
import type { z } from "zod"

export type ZigbeeError =
  | "invalid"
  | "not-found"
  | "slot-in-use"
  | "lock-unreachable"
  | "lock-timeout"
  | "service-down"
  | "internal"

export type ZigbeeResult<T> = { ok: true; data: T } | { ok: false; error: ZigbeeError }

const ERROR_BY_STATUS: Partial<Record<number, ZigbeeError>> = {
  400: "invalid",
  404: "not-found",
  409: "slot-in-use",
  503: "lock-unreachable",
  504: "lock-timeout",
}

/** A bit longer than apps/zigbee's own 15 s lock timeout, so its 504 arrives first. */
const REQUEST_TIMEOUT_MS = 20_000

/** Typed client for apps/zigbee's internal API. Never throws for transport or HTTP errors. */
export function createZigbeeClient(baseUrl: string, timeoutMs = REQUEST_TIMEOUT_MS) {
  async function request<S extends z.ZodType>(
    schema: S,
    method: string,
    path: string,
    body?: unknown
  ): Promise<ZigbeeResult<z.infer<S>>> {
    let response: Response
    try {
      response = await fetch(new URL(path, baseUrl), {
        method,
        cache: "no-store",
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch {
      return { ok: false, error: "service-down" }
    }
    if (!response.ok) return { ok: false, error: ERROR_BY_STATUS[response.status] ?? "internal" }
    return { ok: true, data: schema.parse(await response.json()) }
  }

  return {
    health: () => request(healthResponseSchema, "GET", "/health"),
    status: () => request(statusResponseSchema, "GET", "/status"),
    unlock: () => request(okResponseSchema, "POST", "/unlock"),
    listUsers: () => request(usersResponseSchema, "GET", "/users"),
    registerUser: (user: NewUser) => request(registerUserResponseSchema, "POST", "/users", user),
    renameUser: (id: number, name: string) =>
      request(renameUserResponseSchema, "PATCH", `/users/${id}`, { name }),
    removeUser: (id: number) => request(okResponseSchema, "DELETE", `/users/${id}`),
    sync: () => request(syncResponseSchema, "POST", "/sync"),
    accessLog: (limit: number) => request(accessLogResponseSchema, "GET", `/access-log?limit=${limit}`),
  }
}

export type ZigbeeClient = ReturnType<typeof createZigbeeClient>
