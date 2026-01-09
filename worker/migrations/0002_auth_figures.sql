-- 0002_auth_figures.sql
-- Adds auth tables (users, sessions), figures table, and missing columns in existing tables.

-- USERS
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL
);

-- SESSIONS
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

-- FIGURES
CREATE TABLE IF NOT EXISTS figures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,
  section_id INTEGER,
  page_number INTEGER,
  caption_text TEXT,
  order_index INTEGER NOT NULL
);

-- ADD uploaded_by to documents if missing
ALTER TABLE documents ADD COLUMN uploaded_by INTEGER;

-- ADD user_id to audit_logs if missing
ALTER TABLE audit_logs ADD COLUMN user_id INTEGER;

-- Optional: ensure manufacturers have the 4 target manufacturers (safe inserts)
INSERT OR IGNORE INTO manufacturers (name, theme_primary, theme_secondary) VALUES ('Airbus', '#00205B', '#e5eef9');
INSERT OR IGNORE INTO manufacturers (name, theme_primary, theme_secondary) VALUES ('Boeing', '#0033A1', '#dce7f7');
INSERT OR IGNORE INTO manufacturers (name, theme_primary, theme_secondary) VALUES ('Embraer', '#1E3137', '#e6fffa');
INSERT OR IGNORE INTO manufacturers (name, theme_primary, theme_secondary) VALUES ('Bombardier', '#89674a', '#e6fffa');

-- Seed default users if table empty
INSERT OR IGNORE INTO users (username, password, role) VALUES ('admin', 'admin123', 'admin');
INSERT OR IGNORE INTO users (username, password, role) VALUES ('user', 'user123', 'user');
