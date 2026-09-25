export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  has_totp INTEGER NOT NULL DEFAULT 0,
  has_rfid INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  synced_at TEXT
);

CREATE TABLE IF NOT EXISTS lock_status (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  locked INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
`
