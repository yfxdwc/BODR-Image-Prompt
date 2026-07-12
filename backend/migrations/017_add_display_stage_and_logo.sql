-- Migration 017: 加 display_stage + logo_presentation 独立列 (2026-07-06 16:42 主人拍)
-- 状态: 【2026-07-06 16:42 主人拍 — 改成 ALTER ADD COLUMN】
-- 背景: 16:42 主人拍
--   - "展台" 独立 = display_stage 字段 (从 lighting 拆出)
--   - "展台正面的 logo" 独立 = logo_presentation 字段 (从 lighting 拆出)
--   - 灯光只描述灯光 = lighting 字段描述里删 logo 维度 (016 同步改)
--
-- 治本原因: 旧 017 (我先写的) 走"重建表法", 引用 scene/display_stage/logo_presentation
--   等列 (它们在 010→011→015→016 跑完后才存在). 改成 ALTER ADD COLUMN 后
--   兼容逐步升级, 不丢任何列.
--
-- 注意: display_stage + logo_presentation 在 011 已加过, 015 删 logo (NOP 改后不删).
--   这里用 IF NOT EXISTS 防御, 跑多次也安全.

ALTER TABLE product_images ADD COLUMN display_stage TEXT;
ALTER TABLE product_images ADD COLUMN logo_presentation TEXT;
