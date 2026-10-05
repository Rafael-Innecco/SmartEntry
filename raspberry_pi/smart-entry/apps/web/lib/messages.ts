import type { ZigbeeError } from "./zigbee-client"

export type ActionResult = { ok: true } | { ok: false; message: string }

export type LoginState = { error: string | null }

/** The QR code and secret are returned only here, once; the Pi never stores them. */
export type RegisterResult =
  | { ok: true; name: string; slot: number; qrSvg: string; secret: string }
  | { ok: false; message: string }

const MESSAGES: Record<ZigbeeError, string> = {
  "lock-unreachable": "A fechadura não respondeu. Confira se ela está ligada e perto do Raspberry Pi.",
  "lock-timeout":
    "A fechadura demorou para responder. Tente de novo. Se o comando chegou atrasado, a próxima sincronização corrige.",
  "slot-in-use": "Esse slot já está em uso. Escolha outro.",
  "not-found": "Esse usuário não existe mais. Atualize a página.",
  invalid: "Os dados enviados não são válidos.",
  "service-down": "O serviço da fechadura está fora do ar. Reinicie o serviço smart-locker-zigbee.",
  internal: "O serviço da fechadura encontrou um erro. Veja o log do smart-locker-zigbee.",
}

const UNLOCK_TIMEOUT =
  "A fechadura demorou para confirmar. Ela pode ter destravado mesmo assim; confira o status."

export function errorMessage(error: ZigbeeError, action: "unlock" | "other" = "other"): string {
  if (action === "unlock" && error === "lock-timeout") return UNLOCK_TIMEOUT
  return MESSAGES[error]
}
