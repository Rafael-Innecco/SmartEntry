"use client"

import { useTransition } from "react"

import type { User } from "@workspace/shared"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { RefreshCwIcon } from "lucide-react"
import { toast } from "sonner"

import { syncUsers } from "@/actions/users"
import { RegisterUserDialog } from "@/components/register-user-dialog"
import { RemoveUserDialog, RenameUserDialog } from "@/components/user-row-actions"
import { formatDateTime, lastSyncedAt } from "@/lib/format"

const SLOTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

export function UsersManager({ users }: { users: User[] }) {
  const [syncing, startSync] = useTransition()
  const freeSlots = SLOTS.filter((slot) => !users.some((user) => user.id === slot))
  const syncedAt = lastSyncedAt(users)

  function handleSync() {
    startSync(async () => {
      const result = await syncUsers()
      if (result.ok) toast.success("Lista sincronizada com a fechadura.")
      else toast.error(result.message)
    })
  }

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle className="text-base">Usuários</CardTitle>
          <CardDescription>
            {users.length} de {SLOTS.length} slots ocupados · Última sincronização:{" "}
            {syncedAt ? formatDateTime(syncedAt) : "nunca"}
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <RegisterUserDialog freeSlots={freeSlots} />
          <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
            <RefreshCwIcon data-icon="inline-start" className={syncing ? "animate-spin" : undefined} aria-hidden />
            {syncing ? "Sincronizando…" : "Sincronizar com a fechadura"}
          </Button>
        </div>
        {freeSlots.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Os 10 slots estão ocupados. Remova alguém para cadastrar uma nova pessoa.
          </p>
        )}
      </CardHeader>
      <CardContent>
        {users.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nenhum usuário cadastrado ainda. Use &ldquo;Cadastrar usuário&rdquo; para criar o primeiro.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">Slot</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>TOTP</TableHead>
                <TableHead>Sincronizado em</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Ações</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-mono tabular-nums">{user.id}</TableCell>
                  <TableCell className="font-medium">{user.name}</TableCell>
                  <TableCell>
                    <Badge variant={user.hasTotp ? "secondary" : "outline"}>
                      {user.hasTotp ? "Configurado" : "Pendente"}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {user.syncedAt ? formatDateTime(user.syncedAt) : "nunca"}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <RenameUserDialog user={user} />
                      <RemoveUserDialog user={user} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
