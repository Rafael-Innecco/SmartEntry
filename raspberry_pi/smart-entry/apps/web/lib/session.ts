import "server-only"

import { getIronSession } from "iron-session"
import { cookies } from "next/headers"

import { SESSION_COOKIE } from "./session-cookie"

interface SessionData {
  admin: true
  loggedInAt: number
}

const SESSION_TTL_SECONDS = 12 * 60 * 60

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set to at least 32 characters; generate one with `pnpm hash-password`")
  }
  return secret
}

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), {
    cookieName: SESSION_COOKIE,
    password: sessionSecret(),
    ttl: SESSION_TTL_SECONDS,
    cookieOptions: {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    },
    onUnsealError: (reason) => {
      if (reason !== "expired") console.warn(`rejected session cookie: ${reason}`)
    },
  })
}
