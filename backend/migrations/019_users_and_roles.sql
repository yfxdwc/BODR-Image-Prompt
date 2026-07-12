-- 2026-07-11 BIP auth/RBAC (主人拍: 用现有 library/db.sqlite, 不开新库)
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','user','pending','rejected')),
  display_name TEXT,
  created_at TEXT NOT NULL,
  approved_at TEXT,
  approved_by TEXT REFERENCES users(id),
  rejected_at TEXT,
  rejected_reason TEXT,
  last_login_at TEXT
);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_email ON users(email);
