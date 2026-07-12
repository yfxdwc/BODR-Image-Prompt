-- Migration 018: images.uploaded_at (2026-07-09 20:44 主人拍 E)
-- 背景: 主人 20:44 拍 E = "BODR Image Prompt 项目，每张上传的图片都添加上传日期"
-- 字段: images.uploaded_at TEXT NOT NULL DEFAULT ''
--       跟 created_at 字段并存 (created_at = 记录创建时间, uploaded_at = 上传时间).
--       实操同语义 (后端写入时都设 now()), 但语义清晰, 未来可扩展 EXIF 真实上传时间.
-- SQLite 限制: NOT NULL DEFAULT 不能用非常量 (datetime('now')/CURRENT_TIMESTAMP),
--              所以先用空字符串默认, 然后 init_db.backfill_uploaded_at() 跟 013 同款 backfill 钩子填现有数据.
-- 索引: 不加 (created_at 没索引, uploaded_at 同款不需要).

ALTER TABLE images ADD COLUMN uploaded_at TEXT NOT NULL DEFAULT '';

-- Backfill 在 db.py _backfill_uploaded_at() 跑 (Python 端 now() 填现有行).