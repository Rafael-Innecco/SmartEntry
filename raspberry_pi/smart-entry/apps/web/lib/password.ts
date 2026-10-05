import { randomBytes, scrypt, timingSafeEqual } from "node:crypto"

// Stored as "scrypt:N:r:p:salt:hash" with base64url parts. No "$" and no "#":
// Next's .env loader would read "$..." as a variable reference and "#" as a comment.
const COST = 32768
const BLOCK_SIZE = 8
const PARALLELISM = 1
const KEY_LENGTH = 64
const MAX_MEMORY = 64 * 1024 * 1024

function derive(password: string, salt: Buffer, cost: number, blockSize: number, parallelism: number) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_LENGTH,
      { N: cost, r: blockSize, p: parallelism, maxmem: MAX_MEMORY },
      (err, key) => (err ? reject(err) : resolve(key))
    )
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await derive(password, salt, COST, BLOCK_SIZE, PARALLELISM)
  return ["scrypt", COST, BLOCK_SIZE, PARALLELISM, salt.toString("base64url"), key.toString("base64url")].join(":")
}

/** Throws if `stored` is not a hash produced by hashPassword: that is a configuration error, not a wrong password. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, cost, blockSize, parallelism, salt, hash] = stored.split(":")
  const params = [cost, blockSize, parallelism].map(Number)
  if (algorithm !== "scrypt" || !salt || !hash || !params.every(Number.isInteger)) {
    throw new Error("ADMIN_PASSWORD_HASH is not a valid scrypt hash; generate one with `pnpm hash-password`")
  }
  const [n = 0, r = 0, p = 0] = params
  const expected = Buffer.from(hash, "base64url")
  const actual = await derive(password, Buffer.from(salt, "base64url"), n, r, p)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
