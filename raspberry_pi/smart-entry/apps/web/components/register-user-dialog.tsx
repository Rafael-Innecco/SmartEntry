"use client"

import { useState, useTransition, type FormEvent } from "react"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { UserPlusIcon } from "lucide-react"

import { registerUser } from "@/actions/users"
import type { RegisterResult } from "@/lib/messages"

type Created = Extract<RegisterResult, { ok: true }>

const SELECT_CLASS =
  "h-7 w-full rounded-md border border-input bg-input/20 px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 md:text-xs/relaxed dark:bg-input/30"

export function RegisterUserDialog({ freeSlots }: { freeSlots: number[] }) {
  const [open, setOpen] = useState(false)
  const [created, setCreated] = useState<Created | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  // Once the QR is on screen it must not be dismissed by accident: it is shown only once.
  const locked = pending || created !== null

  function handleOpenChange(next: boolean) {
    if (!next && locked) return
    setOpen(next)
    if (!next) setError(null)
  }

  function finish() {
    setOpen(false)
    setCreated(null)
    setError(null)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const input = { id: Number(form.get("slot")), name: String(form.get("name") ?? "") }
    setError(null)
    startTransition(async () => {
      const result = await registerUser(input)
      if (result.ok) setCreated(result)
      else setError(result.message)
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} disablePointerDismissal={locked}>
      <DialogTrigger render={<Button size="sm" disabled={freeSlots.length === 0} />}>
        <UserPlusIcon data-icon="inline-start" aria-hidden />
        Cadastrar usuário
      </DialogTrigger>
      <DialogContent showCloseButton={!locked}>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Escaneie o QR code agora</DialogTitle>
              <DialogDescription>
                {created.name} (slot {created.slot}) foi cadastrado na fechadura. Abra um app autenticador
                (Google Authenticator, Aegis, Authy) e escaneie o código. Ele não será mostrado de novo.
              </DialogDescription>
            </DialogHeader>
            {/* eslint-disable-next-line @next/next/no-img-element -- inline data: SVG, next/image adds nothing */}
            <img
              src={`data:image/svg+xml;utf8,${encodeURIComponent(created.qrSvg)}`}
              alt={`QR code do SmartEntry para ${created.name}`}
              className="mx-auto size-56 rounded-md bg-white p-2"
            />
            <div className="flex flex-col gap-1">
              <p className="text-xs text-muted-foreground">Sem câmera? Digite este código no app:</p>
              <code className="rounded-md bg-muted px-2 py-1.5 font-mono text-xs break-all select-all">
                {created.secret.match(/.{1,4}/g)?.join(" ")}
              </code>
            </div>
            <p className="text-xs text-muted-foreground">
              Para entrar, a pessoa digita na fechadura o slot e o código do app, seguidos de #. Exemplo:{" "}
              <span className="font-mono">{created.slot}123456#</span>
            </p>
            <DialogFooter>
              <Button onClick={finish}>Já escaneei</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Cadastrar usuário</DialogTitle>
              <DialogDescription>
                A fechadura recebe um segredo TOTP novo. Em seguida você verá o QR code para a pessoa
                configurar o app autenticador.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="register-name">Nome</Label>
              <Input id="register-name" name="name" required maxLength={64} autoComplete="off" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="register-slot">Slot</Label>
              <select id="register-slot" name="slot" className={SELECT_CLASS} defaultValue={freeSlots[0]}>
                {freeSlots.map((slot) => (
                  <option key={slot} value={slot}>
                    {slot}
                  </option>
                ))}
              </select>
            </div>
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? "Aguardando a fechadura…" : "Cadastrar"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
