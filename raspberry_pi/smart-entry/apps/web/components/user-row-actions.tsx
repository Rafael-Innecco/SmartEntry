"use client"

import { useState, useTransition, type FormEvent } from "react"

import type { User } from "@workspace/shared"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog"
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
import { PencilIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import { removeUser, renameUser } from "@/actions/users"

export function RenameUserDialog({ user }: { user: User }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleOpenChange(next: boolean) {
    if (!next && pending) return
    setOpen(next)
    setError(null)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = String(new FormData(event.currentTarget).get("name") ?? "")
    startTransition(async () => {
      const result = await renameUser(user.id, name)
      if (result.ok) {
        toast.success("Nome atualizado.")
        setOpen(false)
      } else {
        setError(result.message)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Renomear ${user.name}`} />}>
        <PencilIcon aria-hidden />
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Renomear slot {user.id}</DialogTitle>
            <DialogDescription>O nome fica só no painel; a fechadura não guarda nomes.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`rename-${user.id}`}>Nome</Label>
            <Input
              id={`rename-${user.id}`}
              name="name"
              defaultValue={user.name}
              required
              maxLength={64}
              autoComplete="off"
            />
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function RemoveUserDialog({ user }: { user: User }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleOpenChange(next: boolean) {
    if (!next && pending) return
    setOpen(next)
    setError(null)
  }

  function handleRemove() {
    startTransition(async () => {
      const result = await removeUser(user.id)
      if (result.ok) {
        toast.success(`${user.name} foi removido.`)
        setOpen(false)
      } else {
        setError(result.message)
      }
    })
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Remover ${user.name}`} />}>
        <Trash2Icon aria-hidden />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remover {user.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            A fechadura apaga o segredo TOTP do slot {user.id} e essa pessoa deixa de conseguir entrar. Para
            voltar a ter acesso, ela precisa ser cadastrada de novo.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={handleRemove} disabled={pending}>
            {pending ? "Aguardando a fechadura…" : "Remover"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
