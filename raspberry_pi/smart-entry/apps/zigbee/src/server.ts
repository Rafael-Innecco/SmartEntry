import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"

import {
  ACCESS_LOG_MAX_ENTRIES,
  getLockStatus,
  listAccessLog,
  listUsers,
  type SmartEntryDb,
} from "@workspace/db"
import { newUserSchema, renameUserRequestSchema, slotIdSchema } from "@workspace/shared"
import { z } from "zod"

import { ConflictError, LockTimeoutError, LockUnreachableError, NotFoundError } from "./errors.js"
import type { LockTransport } from "./lock-transport.js"
import type { Services } from "./services.js"

const accessLogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(ACCESS_LOG_MAX_ENTRIES).default(50),
})

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req as AsyncIterable<Buffer>) {
    chunks.push(chunk)
  }
  if (chunks.length === 0) return undefined
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(body))
}

function toErrorResponse(err: unknown): [number, object] {
  if (err instanceof z.ZodError) return [400, { error: "invalid request", issues: err.issues }]
  if (err instanceof SyntaxError) return [400, { error: "invalid JSON body" }]
  if (err instanceof NotFoundError) return [404, { error: err.message }]
  if (err instanceof ConflictError) return [409, { error: err.message }]
  if (err instanceof LockUnreachableError) return [503, { error: err.message }]
  if (err instanceof LockTimeoutError) return [504, { error: err.message }]
  console.error(err)
  return [500, { error: "internal error" }]
}

/** The internal HTTP API on 127.0.0.1:4000. Payload shapes live in @workspace/shared. */
export function createHttpServer(db: SmartEntryDb, lock: LockTransport, services: Services): Server {
  return createServer((req, res) => {
    route(db, lock, services, req, res).catch((err: unknown) => {
      const [status, body] = toErrorResponse(err)
      sendJson(res, status, body)
    })
  })
}

async function route(
  db: SmartEntryDb,
  lock: LockTransport,
  services: Services,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1")
  const { pathname } = url
  const method = req.method

  if (method === "GET" && pathname === "/health") {
    return sendJson(res, 200, { ok: true, lockConnected: lock.isConnected() })
  }

  if (method === "GET" && pathname === "/status") {
    return sendJson(res, 200, getLockStatus(db))
  }

  if (method === "POST" && pathname === "/unlock") {
    await services.unlock()
    return sendJson(res, 200, { ok: true })
  }

  if (method === "GET" && pathname === "/users") {
    return sendJson(res, 200, { users: listUsers(db) })
  }

  if (method === "POST" && pathname === "/users") {
    const newUser = newUserSchema.parse(await readJsonBody(req))
    return sendJson(res, 200, await services.registerUser(newUser))
  }

  const userMatch = /^\/users\/(\d+)$/.exec(pathname)
  if (userMatch && (method === "PATCH" || method === "DELETE")) {
    const id = slotIdSchema.parse(Number(userMatch[1]))
    if (method === "PATCH") {
      const { name } = renameUserRequestSchema.parse(await readJsonBody(req))
      return sendJson(res, 200, { user: services.renameUser(id, name) })
    }
    await services.removeUser(id)
    return sendJson(res, 200, { ok: true })
  }

  if (method === "POST" && pathname === "/sync") {
    return sendJson(res, 200, await services.sync())
  }

  if (method === "GET" && pathname === "/access-log") {
    const { limit } = accessLogQuerySchema.parse(Object.fromEntries(url.searchParams))
    return sendJson(res, 200, { entries: listAccessLog(db, limit) })
  }

  sendJson(res, 404, { error: "not found" })
}
