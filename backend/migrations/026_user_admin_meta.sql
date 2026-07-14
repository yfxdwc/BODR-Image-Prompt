-- 2026-07-14 主人拍: 管理员给用户加备注名 + 锁定开关.
ALTER TABLE users ADD COLUMN note_name TEXT;
ALTER TABLE users ADD COLUMN is_locked INTEGER NOT NULL DEFAULT 0;
-- 锁定原因 (admin 在用户中心填), 登录被拒时返回给前端.
ALTER TABLE users ADD COLUMN locked_reason TEXT;
