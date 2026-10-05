import Link from "next/link"

import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"

import { AccessLogTable } from "@/components/access-log-table"
import { StatusPanel } from "@/components/status-panel"
import { verifySession } from "@/lib/dal"
import { formatDateTime, lastSyncedAt } from "@/lib/format"
import { errorMessage } from "@/lib/messages"
import { zigbee } from "@/lib/zigbee"

const SLOT_COUNT = 10

export default async function DashboardPage() {
  await verifySession()
  const [status, users, accessLog] = await Promise.all([
    zigbee.status(),
    zigbee.listUsers(),
    zigbee.accessLog(3),
  ])

  const syncedAt = users.ok ? lastSyncedAt(users.data.users) : null

  return (
    <>
      <StatusPanel initialStatus={status.ok ? status.data : null} />

      <div className="grid gap-5 md:grid-cols-[1fr_2fr]">
        <Card>
          <CardHeader>
            <CardDescription>Usuários cadastrados</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {users.ok ? `${users.data.users.length} de ${SLOT_COUNT}` : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-xs text-muted-foreground">
            {users.ok ? (
              <p>Última sincronização: {syncedAt ? formatDateTime(syncedAt) : "nunca"}</p>
            ) : (
              <p>{errorMessage(users.error)}</p>
            )}
            <Link href="/usuarios" className="font-medium text-foreground underline-offset-4 hover:underline">
              Gerenciar usuários
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Acessos recentes</CardTitle>
            <CardAction>
              <Link href="/acessos" className="text-xs font-medium underline-offset-4 hover:underline">
                Ver todos
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
            {accessLog.ok ? (
              <AccessLogTable entries={accessLog.data.entries} />
            ) : (
              <p className="text-xs text-muted-foreground">{errorMessage(accessLog.error)}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
