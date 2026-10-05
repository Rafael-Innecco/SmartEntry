import { mkdirSync } from "node:fs"
import { dirname } from "node:path"

import Database from "better-sqlite3"

import { MIGRATIONS } from "./schema.js"

export type SmartEntryDb = Database.Database

export function migrate(db: SmartEntryDb): void {
  const applied = db.pragma("user_version", { simple: true }) as number
  MIGRATIONS.slice(applied).forEach((sql, index) => {
    db.transaction(() => {
      db.exec(sql)
      db.pragma(`user_version = ${applied + index + 1}`)
    })()
  })
}

export function createDb(path: string): SmartEntryDb {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true })
  }
  const db = new Database(path)
  db.pragma("journal_mode = WAL")
  migrate(db)
  return db
}
