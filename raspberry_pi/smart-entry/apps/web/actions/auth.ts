"use server"

import { redirect } from "next/navigation"

import { createLoginLimiter } from "@/lib/login-limiter"
import type { LoginState } from "@/lib/messages"
import { verifyPassword } from "@/lib/password"
import { getSession } from "@/lib/session"

const TOO_MANY_ATTEMPTS = "Muitas tentativas. Aguarde 1 minuto."

// One admin and one process: a module-level limiter is enough.
const limiter = createLoginLimiter()

export async function login(_previous: LoginState, formData: FormData): Promise<LoginState> {
  if (limiter.isLocked()) return { error: TOO_MANY_ATTEMPTS }

  const hash = process.env.ADMIN_PASSWORD_HASH
  if (!hash) {
    return { error: "O painel ainda não tem senha. Configure ADMIN_PASSWORD_HASH com pnpm hash-password." }
  }

  const password = formData.get("password")
  if (typeof password !== "string" || !(await verifyPassword(password, hash))) {
    limiter.recordFailure()
    return { error: limiter.isLocked() ? TOO_MANY_ATTEMPTS : "Senha incorreta." }
  }

  limiter.reset()
  const session = await getSession()
  session.admin = true
  session.loggedInAt = Date.now()
  await session.save()
  redirect("/")
}

export async function logout(): Promise<void> {
  const session = await getSession()
  session.destroy()
  redirect("/login")
}
