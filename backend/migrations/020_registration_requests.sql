-- 2026-07-11 BIP auth/RBAC: 申请制注册. registration_requests 跟 users 行 1:1 (一个用户最多一条 active request)
CREATE TABLE registration_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  requested_at TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
  reviewed_at TEXT,
  reviewed_by TEXT REFERENCES users(id),
  review_note TEXT
);
CREATE INDEX idx_regreq_status ON registration_requests(status);
CREATE INDEX idx_regreq_user ON registration_requests(user_id);
