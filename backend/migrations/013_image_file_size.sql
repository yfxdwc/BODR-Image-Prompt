-- Migration 013: file_size_bytes (2026-07-04 21:51 主人拍)
-- 背景: 右栏提示词增加图片比例 / 文件大小 / 像素 / 格式等基础信息 (自动识别, 只读).
--       这些来自图片元数据 (width/height 已存), 文件大小需要新列.
-- 字段: product_images.file_size_bytes INTEGER (stat 磁盘文件得出, 一次性 backfill)
--
-- 注: backfill 走 migration 内部的 UPDATE, 失败的文件 size=0 (不影响查询, 前端显示 "—").

ALTER TABLE product_images ADD COLUMN file_size_bytes INTEGER;

-- Backfill: 尝试从文件系统 stat 每条记录的 original_path, 找不到则留 NULL
-- 注: SQL 没法直接 stat 磁盘, 但我们可以根据 file_sha256 + 已知扩展名构造 path
--     actual backfill 在 Python 端 init_db 后跑 (见 db.py)

-- 索引 (按 file_size_bytes 排序时有用, 可选)
-- CREATE INDEX IF NOT EXISTS idx_product_images_size ON product_images(file_size_bytes);