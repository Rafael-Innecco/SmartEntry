"use client"

import { useActionState } from "react"

import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { LockKeyholeIcon } from "lucide-react"

import { login } from "@/actions/auth"
import type { LoginState } from "@/lib/messages"

const INITIAL_STATE: LoginState = { error: null }

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, INITIAL_STATE)

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <LockKeyholeIcon className="size-4" aria-hidden />
          SmartEntry
        </CardTitle>
        <CardDescription>Entre com a senha do painel para gerenciar a fechadura.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              aria-invalid={state.error ? true : undefined}
              aria-describedby={state.error ? "login-error" : undefined}
            />
          </div>
          {state.error && (
            <p id="login-error" role="alert" className="text-xs text-destructive">
              {state.error}
            </p>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? "Entrando…" : "Entrar"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
