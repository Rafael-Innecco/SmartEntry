import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"

import { deleteUser, getLockStatus, listUsers, replaceAllUsers, upsertUser, type SmartEntryDb } from "@workspace/db"
import { newUserSchema, removeUserRequestSchema } from "@workspace/shared"

import type { LockTransport } from "./lock-transport.js"

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

/**
 * The internal HTTP API on 127.0.0.1:4000, per the architecture doc:
 * GET /status, GET+POST+DELETE /users, POST /unlock, POST /sync.
 * apps/web is the only intended caller.
 */
export function createHttpServer(db: SmartEntryDb, lock: LockTransport): Server {
  return createServer((req, res) => {
    handleRequest(db, lock, req, res).catch((err: unknown) => {
      sendJson(res, 400, { error: err instanceof Error ? err.message : "bad request" })
    })
  })
}

async function handleRequest(
  db: SmartEntryDb,
  lock: LockTransport,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method === "GET" && req.url === "/status") {
    sendJson(res, 200, getLockStatus(db))
    return
  }

  if (req.method === "GET" && req.url === "/users") {
    sendJson(res, 200, { users: listUsers(db) })
    return
  }

  if (req.method === "POST" && req.url === "/users") {
    const newUser = newUserSchema.parse(await readJsonBody(req))
    const user = await lock.registerUser(newUser)
    upsertUser(db, user)
    sendJson(res, 200, { user })
    return
  }

  if (req.method === "DELETE" && req.url === "/users") {
    const { id } = removeUserRequestSchema.parse(await readJsonBody(req))
    await lock.removeUser(id)
    deleteUser(db, id)
    sendJson(res, 200, { ok: true })
    return
  }

  if (req.method === "POST" && req.url === "/unlock") {
    await lock.unlock()
    sendJson(res, 200, { ok: true })
    return
  }

  if (req.method === "POST" && req.url === "/sync") {
    const users = await lock.syncUsers()
    replaceAllUsers(db, users)
    sendJson(res, 200, { users, syncedAt: new Date().toISOString() })
    return
  }

  sendJson(res, 404, { error: "not found" })
}
