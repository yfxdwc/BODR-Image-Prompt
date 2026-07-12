-- Migration 016: product_images 加 6 字段专业摄影 schema (2026-07-06 主人拍)
-- 状态: 【2026-07-06 16:42 主人修改 — 改成 ALTER ADD COLUMN, 不重建表】
-- 背景: 主人 4 字段不足, 8 字段覆盖商业摄影维度.
--   1. slogan           (保留, 011 已加)
--   2. subject_angle    (≤30) 新加
--   3. composition      (≤30) 新加
--   4. lighting         (≤50) 新加 (16:42 净化: 仅灯光, 不再含 logo)
--   5. material_texture (≤30) 新加
--   6. background       (≤30) 新加
--   7. style            (保留, 011 已加)
--   8. color_tone       (≤30) 新加
--
-- 16:42 主人调整: 不重建表 (会丢 scene/display_stage 历史), 改成 ALTER ADD COLUMN
-- 旧 4 字段保留: scene / display_stage / logo_presentation (017 加回)
--
-- 治本原因: 原 016 走"重建表"路线, 但实际 DB 只跑到 010, 010 表无 scene 列
--   导致 016 跑会 `no such column: scene` 崩溃. 改成 ALTER ADD COLUMN 后
--   兼容 010 → 011 → 015(NOP) → 016 → 017 渐进升级.

-- 新加 6 字段 (011 已加的 5 字段: style/scene/display_stage/logo_presentation/slogan 不动)
ALTER TABLE product_images ADD COLUMN subject_angle TEXT;
ALTER TABLE product_images ADD COLUMN composition TEXT;
ALTER TABLE product_images ADD COLUMN lighting TEXT;
ALTER TABLE product_images ADD COLUMN material_texture TEXT;
ALTER TABLE product_images ADD COLUMN background TEXT;
ALTER TABLE product_images ADD COLUMN color_tone TEXT;
