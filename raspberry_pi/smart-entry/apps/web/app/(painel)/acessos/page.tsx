import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"

import { AccessLogTable } from "@/components/access-log-table"
import { verifySession } from "@/lib/dal"
import { errorMessage } from "@/lib/messages"
import { zigbee } from "@/lib/zigbee"

const PAGE_SIZE = 200

export default async function AcessosPage() {
  await verifySession()
  const accessLog = await zigbee.accessLog(PAGE_SIZE)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Acessos</CardTitle>
        <CardDescription>
          Tentativas de entrada pelo teclado e destravamentos pelo painel, da mais recente para a mais
          antiga. Mostra os últimos {PAGE_SIZE} eventos.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {accessLog.ok ? (
          <AccessLogTable entries={accessLog.data.entries} />
        ) : (
          <p className="text-xs text-muted-foreground">{errorMessage(accessLog.error)}</p>
        )}
      </CardContent>
    </Card>
  )
}
