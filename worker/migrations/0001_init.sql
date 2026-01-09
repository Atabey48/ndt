CREATE TABLE IF NOT EXISTS manufacturers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  theme_primary TEXT,
  theme_secondary TEXT
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manufacturer_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  pdf_url TEXT NOT NULL,
  revision_date TEXT,
  tags TEXT,
  uploaded_at TEXT NOT NULL,
  FOREIGN KEY (manufacturer_id) REFERENCES manufacturers(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_type TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);
