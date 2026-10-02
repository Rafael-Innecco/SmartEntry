import assert from "node:assert/strict"
import { test } from "node:test"

import { base32Encode, buildOtpauthUri, generateTotpSecret } from "./totp.js"

test("base32Encode matches the RFC 4648 test vectors (unpadded)", () => {
  const vectors: [string, string][] = [
    ["", ""],
    ["f", "MY"],
    ["fo", "MZXQ"],
    ["foo", "MZXW6"],
    ["foob", "MZXW6YQ"],
    ["fooba", "MZXW6YTB"],
    ["foobar", "MZXW6YTBOI"],
  ]
  for (const [input, expected] of vectors) {
    assert.equal(base32Encode(Buffer.from(input)), expected)
  }
})

test("generateTotpSecret returns 20 random bytes", () => {
  const a = generateTotpSecret()
  assert.equal(a.length, 20)
  assert.notDeepEqual(a, generateTotpSecret())
})

test("buildOtpauthUri carries the parameters the lock expects", () => {
  const uri = new URL(buildOtpauthUri("Alice Souza", Buffer.from("foobar")))
  assert.equal(uri.protocol, "otpauth:")
  assert.equal(uri.host, "totp")
  assert.equal(decodeURIComponent(uri.pathname), "/SmartEntry:Alice Souza")
  assert.equal(uri.searchParams.get("secret"), "MZXW6YTBOI")
  assert.equal(uri.searchParams.get("issuer"), "SmartEntry")
  assert.equal(uri.searchParams.get("algorithm"), "SHA1")
  assert.equal(uri.searchParams.get("digits"), "6")
  assert.equal(uri.searchParams.get("period"), "30")
})
