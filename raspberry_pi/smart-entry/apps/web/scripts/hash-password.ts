import { randomBytes } from "node:crypto"
import { stdin, stdout } from "node:process"

import { hashPassword } from "../lib/password"

function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    stdout.write(prompt)
    stdin.setRawMode(true)
    stdin.setEncoding("utf8")
    stdin.resume()
    let value = ""

    const finish = (error?: Error) => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.off("data", onData)
      stdout.write("\n")
      if (error) reject(error)
      else resolve(value)
    }

    function onData(chunk: string) {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") return finish()
        if (char === "\u0003") return finish(new Error("cancelado"))
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1)
        else value += char
      }
    }

    stdin.on("data", onData)
  })
}

if (!stdin.isTTY) {
  console.error("Rode este comando num terminal interativo: ele pede a senha sem mostrá-la.")
  process.exit(1)
}

const password = await readHidden("Nova senha do painel: ")
const confirmation = await readHidden("Repita a senha: ")

if (password !== confirmation) {
  console.error("As senhas não conferem.")
  process.exit(1)
}
if (password.length < 8) {
  console.error("Use pelo menos 8 caracteres.")
  process.exit(1)
}

console.log("\nCole estas linhas em apps/web/.env.local (no Pi, em /etc/smart-entry/web.env):\n")
console.log(`ADMIN_PASSWORD_HASH=${await hashPassword(password)}`)
console.log(`SESSION_SECRET=${randomBytes(32).toString("base64url")}`)
