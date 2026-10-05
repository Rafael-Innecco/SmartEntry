import "server-only"

import { redirect } from "next/navigation"
import { cache } from "react"

import { getSession } from "./session"

/**
 * The real session check, used by every page, Server Action and route
 * handler. proxy.ts only redirects early when the cookie is missing.
 */
export const isAdmin = cache(async (): Promise<boolean> => (await getSession()).admin === true)

export async function verifySession(): Promise<void> {
  if (!(await isAdmin())) redirect("/login")
}
