-- 0002_auth_figures_activity.sql

-- 1) Auth tables
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

-- 2) Figures table (optional but requested)
CREATE TABLE IF NOT EXISTS figures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,
  section_id INTEGER,
  page_number INTEGER,
  caption_text TEXT,
  order_index INTEGER NOT NULL
);

-- 3) Add missing columns (they DO NOT exist in your DB -> safe to add once)
ALTER TABLE documents ADD COLUMN uploaded_by INTEGER;
ALTER TABLE audit_logs ADD COLUMN user_id INTEGER;

-- 4) Ensure manufacturers + themes you requested (English names)
INSERT OR IGNORE INTO manufacturers (name, theme_primary, theme_secondary) VALUES ('Airbus', '#00205B', '#E5EEF9');
INSERT OR IGNORE INTO manufacturers (name, theme_primary, theme_secondary) VALUES ('Boeing', '#0033A1', '#DCE7F7');
INSERT OR IGNORE INTO manufacturers (name, theme_primary, theme_secondary) VALUES ('Embraer', '#1E3137', '#E7EEF0');
INSERT OR IGNORE INTO manufacturers (name, theme_primary, theme_secondary) VALUES ('Bombardier', '#89674a', '#F2ECE6');

-- 5) Seed default users (plain for now)
INSERT OR IGNORE INTO users (username, password, role) VALUES ('admin', 'admin123', 'admin');
INSERT OR IGNORE INTO users (username, password, role) VALUES ('user', 'user123', 'user');
