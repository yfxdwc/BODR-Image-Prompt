-- Migration 017: 合并 display_stage + logo_presentation → display_stage_and_logo (2026-07-06 17:19 主人拍 a 方案)
-- 背景: 主人 17:19 a = 把展台(底座/材质/光效) + 展台正面的 logo(位置/材质) 二者合并为单字段 "display_stage_and_logo"
-- 设计:
--   1. 加列 display_stage_and_logo TEXT (≤50 字符限制, 由后端 validator + 前端 maxLength 强制)
--   2. 数据迁移: 把旧 display_stage + logo_presentation 拼接 (空白分隔), 自动截断 ≤50 字符
--   3. 删 display_stage + logo_presentation 列 (重建表法)

PRAGMA foreign_keys=OFF;

CREATE TABLE IF NOT EXISTS product_images_new (
  id TEXT PRIMARY KEY,
  product_id INTEGER NOT NULL,
  original_path TEXT NOT NULL,
  thumb_path TEXT,
  preview_path TEXT,
  remote_url TEXT,
  width INTEGER,
  height INTEGER,
  file_sha256 TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_cover INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  -- 2026-07-06 17:19 主人拍: 9 字段 (合并 display_stage + logo_presentation)
  slogan TEXT,
  subject_angle TEXT,
  composition TEXT,
  lighting TEXT,
  display_stage_and_logo TEXT,   -- 合并字段 (≤50 字, 含展台 + 展台正面 logo)
  material_texture TEXT,
  background TEXT,
  style TEXT,
  color_tone TEXT,
  file_size_bytes INTEGER,
  FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- 数据迁移: display_stage + logo_presentation 拼接 (空白分隔, 自动截断 ≤50)
INSERT INTO product_images_new
  (id, product_id, original_path, thumb_path, preview_path, remote_url,
   width, height, file_sha256, sort_order, is_cover, created_at,
   slogan, subject_angle, composition, lighting,
   display_stage_and_logo,
   material_texture, background, style, color_tone, file_size_bytes)
SELECT
  id, product_id, original_path, thumb_path, preview_path, remote_url,
  width, height, file_sha256, sort_order, is_cover, created_at,
  slogan, subject_angle, composition, lighting,
  CASE
    WHEN display_stage IS NOT NULL AND logo_presentation IS NOT NULL THEN
      substr(trim(display_stage) || ' ' || trim(logo_presentation), 1, 50)
    WHEN display_stage IS NOT NULL THEN display_stage
    WHEN logo_presentation IS NOT NULL THEN logo_presentation
    ELSE NULL
  END,
  material_texture, background, style, color_tone, file_size_bytes
FROM product_images;

DROP TABLE product_images;

ALTER TABLE product_images_new RENAME TO product_images;

CREATE INDEX IF NOT EXISTS idx_product_images_product_id ON product_images(product_id);
CREATE INDEX IF NOT EXISTS idx_product_images_product_position ON product_images(product_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_product_images_product_cover ON product_images(product_id, is_cover);

PRAGMA foreign_keys=ON;
