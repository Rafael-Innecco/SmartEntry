import type { z } from "zod"

import type { healthResponseSchema } from "@workspace/shared"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { ServerOffIcon, UnplugIcon } from "lucide-react"

import { errorMessage } from "@/lib/messages"
import type { ZigbeeResult } from "@/lib/zigbee-client"

type Health = ZigbeeResult<z.infer<typeof healthResponseSchema>>

export function HealthBanner({ health }: { health: Health }) {
  if (!health.ok) {
    return (
      <Alert variant="destructive">
        <ServerOffIcon aria-hidden />
        <AlertTitle>Sem comunicação com a fechadura</AlertTitle>
        <AlertDescription>{errorMessage(health.error)}</AlertDescription>
      </Alert>
    )
  }

  if (!health.data.lockConnected) {
    return (
      <Alert variant="destructive">
        <UnplugIcon aria-hidden />
        <AlertTitle>Fechadura desconectada</AlertTitle>
        <AlertDescription>
          Destravar, cadastrar e sincronizar não vão funcionar até ela voltar. Confira se ela está
          ligada e perto do Raspberry Pi.
        </AlertDescription>
      </Alert>
    )
  }

  return null
}
