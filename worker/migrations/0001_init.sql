-- Manufacturers
CREATE TABLE IF NOT EXISTS manufacturers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  theme_primary TEXT,
  theme_secondary TEXT
);

-- Users (PBKDF2 hash)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','user')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- Session tokens
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_path TEXT,
  ip TEXT,
  user_agent TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Documents (metadata in D1, file in R2)
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manufacturer_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  revision_date TEXT,
  tags TEXT,
  r2_key TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  uploaded_by INTEGER NOT NULL,
  uploaded_at TEXT NOT NULL,
  FOREIGN KEY (manufacturer_id) REFERENCES manufacturers(id),
  FOREIGN KEY (uploaded_by) REFERENCES users(id)
);

-- Audit logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  role TEXT,
  action_type TEXT NOT NULL,
  path TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

-- Seed manufacturers if empty
INSERT OR IGNORE INTO manufacturers (id, name, theme_primary, theme_secondary)
VALUES
  (1, 'Boeing', '#0033A0', '#E6EEF9'),
  (2, 'Airbus', '#00205B', '#E5EEF9'),
  (3, 'Other',  '#2F855A', '#E6FFFA');
