import { randomBytes } from "node:crypto"

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

/** RFC 4648 base32 without padding, the form authenticator apps expect. */
export function base32Encode(bytes: Uint8Array): string {
  let output = ""
  let buffer = 0
  let bits = 0
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      output += BASE32_ALPHABET[(buffer >> bits) & 31]
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(buffer << (5 - bits)) & 31]
  }
  return output
}

/** 160 bits, the size RFC 4226 recommends for HMAC-SHA1. */
export function generateTotpSecret(): Buffer {
  return randomBytes(20)
}

/** Parameters must match what the lock computes: SHA1, 6 digits, 30 s period. */
export function buildOtpauthUri(accountName: string, secret: Uint8Array): string {
  const label = encodeURIComponent(`SmartEntry:${accountName}`)
  const params = new URLSearchParams({
    secret: base32Encode(secret),
    issuer: "SmartEntry",
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  })
  return `otpauth://totp/${label}?${params.toString()}`
}
