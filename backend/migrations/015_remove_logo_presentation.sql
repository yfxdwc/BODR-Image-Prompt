-- Migration 015: 删 product_images.logo_presentation (2026-07-06 主人拍)
-- 状态: 【2026-07-06 16:42 主人推翻 — 改成 NOP】
-- 背景 (历史): 2026-07-06 上午主人拍"合并到 display_stage" → 删 logo_presentation 列
-- 推翻: 2026-07-06 16:42 主人重新拍"展台正面的 logo 独立" → logo_presentation 重新独立
-- 治本: 此 migration 改成 NOP, 直接在 migration 017 把 logo_presentation 加回来
-- 警告: 不要恢复原 SQL (会跟 16:42 主人意图冲突)
--
-- 原 SQL (已废止, 留作历史参考):
--   PRAGMA foreign_keys=OFF;
--   CREATE TABLE IF NOT EXISTS product_images_new (...);
--   INSERT INTO product_images_new (...) SELECT ... FROM product_images;
--   DROP TABLE product_images;
--   ALTER TABLE product_images_new RENAME TO product_images;
--   PRAGMA foreign_keys=ON;

-- NOP: 什么都不做 (16:42 主人重新设计推翻 015)
SELECT 1;
