import type { AccessLogEntry, AccessMethod, User } from "@workspace/shared"

// Fixed zone so server and browser render the same text (no hydration mismatch).
const TIME_ZONE = "America/Sao_Paulo"

const dateTimeFormat = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "medium",
  timeZone: TIME_ZONE,
})

const timeFormat = new Intl.DateTimeFormat("pt-BR", { timeStyle: "medium", timeZone: TIME_ZONE })

export function formatDateTime(iso: string): string {
  return dateTimeFormat.format(new Date(iso))
}

export function formatTime(iso: string): string {
  return timeFormat.format(new Date(iso))
}

export const ACCESS_METHOD_LABEL: Record<AccessMethod, string> = {
  totp: "Teclado (TOTP)",
  rfid: "Cartão RFID",
  remote: "Remoto (painel)",
}

export function describeAccessor(entry: AccessLogEntry): string {
  if (entry.userName) return entry.userName
  if (entry.method === "remote") return "Painel web"
  if (entry.slot !== null) return `Slot ${entry.slot} (sem cadastro)`
  return "Desconhecido"
}

/** The most recent sync across all users, or null if none was ever synced. */
export function lastSyncedAt(users: User[]): string | null {
  return users.reduce<string | null>(
    (latest, user) => (user.syncedAt && (!latest || user.syncedAt > latest) ? user.syncedAt : latest),
    null
  )
}
