-- 2026-07-11 BIP auth/RBAC: session 表 + JWT jti 跟踪. 用于吊销/审计/同设备管理.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  access_jti TEXT UNIQUE NOT NULL,
  refresh_token_hash TEXT NOT NULL,
  user_agent TEXT,
  ip TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  refresh_expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
CREATE INDEX idx_sessions_jti ON sessions(access_jti);
