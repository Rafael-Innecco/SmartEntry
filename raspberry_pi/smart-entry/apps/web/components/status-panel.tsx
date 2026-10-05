"use client"

import { useCallback, useEffect, useState, useTransition } from "react"

import { lockStatusSchema, type LockStatus } from "@workspace/shared"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { cn } from "@workspace/ui/lib/utils"
import { LockIcon, LockOpenIcon } from "lucide-react"
import { toast } from "sonner"

import { unlockDoor } from "@/actions/lock"
import { formatTime } from "@/lib/format"

const POLL_INTERVAL_MS = 3000

export function StatusPanel({ initialStatus }: { initialStatus: LockStatus | null }) {
  const [status, setStatus] = useState(initialStatus)
  const [stale, setStale] = useState(initialStatus === null)
  const [unlockError, setUnlockError] = useState<string | null>(null)
  const [unlocking, startUnlock] = useTransition()

  const refreshStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/status", { cache: "no-store" })
      if (response.status === 401) {
        window.location.assign("/login")
        return
      }
      if (!response.ok) throw new Error(`status ${response.status}`)
      setStatus(lockStatusSchema.parse(await response.json()))
      setStale(false)
    } catch {
      setStale(true)
    }
  }, [])

  useEffect(() => {
    const poll = () => {
      if (document.visibilityState === "visible") void refreshStatus()
    }
    const timer = window.setInterval(poll, POLL_INTERVAL_MS)
    document.addEventListener("visibilitychange", poll)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", poll)
    }
  }, [refreshStatus])

  function handleUnlock() {
    setUnlockError(null)
    startUnlock(async () => {
      const result = await unlockDoor()
      if (result.ok) toast.success("Porta destravada.")
      else setUnlockError(result.message)
      await refreshStatus()
    })
  }

  const locked = status?.locked ?? true
  const Icon = locked ? LockIcon : LockOpenIcon

  return (
    <Card>
      <CardHeader>
        <CardDescription>Estado da porta</CardDescription>
        <CardTitle className="flex items-center gap-2 text-2xl">
          {status ? (
            <>
              <Icon
                className={cn("size-6", locked ? "text-foreground" : "text-amber-600 dark:text-amber-400")}
                aria-hidden
              />
              {locked ? "Travada" : "Destravada"}
            </>
          ) : (
            "Desconhecido"
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {status && `Desde ${formatTime(status.updatedAt)}`}
          {stale && (status ? " · sem atualização no momento" : "Não foi possível ler o estado da porta.")}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Button onClick={handleUnlock} disabled={unlocking} size="lg" className="w-full sm:w-fit">
          <LockOpenIcon data-icon="inline-start" aria-hidden />
          {unlocking ? "Aguardando a fechadura…" : "Destravar"}
        </Button>
        {unlockError && (
          <p role="alert" className="text-xs text-destructive">
            {unlockError}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
