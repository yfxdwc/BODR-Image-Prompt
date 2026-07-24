-- 2026-07-24 主人拍: 每张 product_image 累计被复制/下载次数, 用于识别团队偏好.
ALTER TABLE product_images ADD COLUMN copy_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE product_images ADD COLUMN download_count INTEGER NOT NULL DEFAULT 0;
-- 索引加速排序: 找"最热门"用 ORDER BY (copy_count + download_count) DESC
CREATE INDEX IF NOT EXISTS idx_product_images_popularity ON product_images(copy_count + download_count DESC);
