-- Migration 010: product image group + cover selection
-- 2026-06-17 cc 自执行 (T-2026-06-17-ipl-product-image-group)
-- Spec: 一个 product 可挂 N 张图, 选 1 张做封面
-- 设计: 新建 product_images 表 (不依赖 images.item_id NOT NULL 约束), 存储复用 image_store 路径
-- 注意: 4caf16a 之上加, 不动 products 表已有字段

-- 1. products 表加 cover_image_id 列 (指向 product_images.id, 留作可空)
ALTER TABLE products ADD COLUMN cover_image_id TEXT;

-- 2. 新建 product_images 表 (一对多: product → N 张图)
CREATE TABLE product_images (
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
  FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- 3. 索引
CREATE INDEX IF NOT EXISTS idx_product_images_product_id ON product_images(product_id);
CREATE INDEX IF NOT EXISTS idx_product_images_product_position ON product_images(product_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_product_images_product_cover ON product_images(product_id, is_cover);
CREATE INDEX IF NOT EXISTS idx_products_cover_image_id ON products(cover_image_id);
