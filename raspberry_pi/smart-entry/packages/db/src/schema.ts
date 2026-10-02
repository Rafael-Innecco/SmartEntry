export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY CHECK (id BETWEEN 0 AND 9),
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

CREATE TABLE IF NOT EXISTS access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slot INTEGER,
  method TEXT NOT NULL CHECK (method IN ('totp', 'rfid', 'remote')),
  result TEXT NOT NULL CHECK (result IN ('success', 'failure')),
  received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS link_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  hmac_counter INTEGER NOT NULL
);
`
