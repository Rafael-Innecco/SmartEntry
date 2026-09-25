import Database from "better-sqlite3"

import { SCHEMA_SQL } from "./schema.js"

export type SmartEntryDb = Database.Database

export function createDb(path: string): SmartEntryDb {
  const db = new Database(path)
  db.pragma("journal_mode = WAL")
  db.exec(SCHEMA_SQL)
  return db
}
