import { mkdirSync } from "node:fs"
import { dirname } from "node:path"

import Database from "better-sqlite3"

import { SCHEMA_SQL } from "./schema.js"

export type SmartEntryDb = Database.Database

export function createDb(path: string): SmartEntryDb {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true })
  }
  const db = new Database(path)
  db.pragma("journal_mode = WAL")
  db.exec(SCHEMA_SQL)
  return db
}
