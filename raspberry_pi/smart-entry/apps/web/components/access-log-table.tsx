import type { AccessLogEntry } from "@workspace/shared"
import { Badge } from "@workspace/ui/components/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { cn } from "@workspace/ui/lib/utils"

import { ACCESS_METHOD_LABEL, describeAccessor, formatDateTime } from "@/lib/format"

export function AccessLogTable({ entries }: { entries: AccessLogEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-xs text-muted-foreground">Nenhum acesso registrado ainda.</p>
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Quando</TableHead>
          <TableHead>Quem</TableHead>
          <TableHead>Método</TableHead>
          <TableHead>Resultado</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => {
          const denied = entry.result === "failure"
          return (
            <TableRow key={entry.id} className={cn(denied && "bg-destructive/5")}>
              <TableCell className="tabular-nums">{formatDateTime(entry.receivedAt)}</TableCell>
              <TableCell>{describeAccessor(entry)}</TableCell>
              <TableCell>{ACCESS_METHOD_LABEL[entry.method]}</TableCell>
              <TableCell>
                <Badge variant={denied ? "destructive" : "secondary"}>
                  {denied ? "Negado" : "Liberado"}
                </Badge>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
