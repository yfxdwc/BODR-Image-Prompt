-- Migration 014: product name UNIQUE + category/series 字典化 (2026-07-06 主人拍)
-- 背景: 主人要求产品名唯一, 类别和系列做下拉列表 (唯一 + 字典化).
-- 设计:
--   1. products.name 加 UNIQUE 索引 (sqlite 用 唯一索引实现, 不是 ALTER ... ADD CONSTRAINT)
--   2. categories(id, name UNIQUE, created_at) 字典表
--   3. series_dict(id, name UNIQUE, created_at) 字典表
--   4. products 加 category_id INTEGER 外键 -> categories.id (可空, 兼容现有数据)
--   5. products 加 series_id INTEGER 外键 -> series_dict.id (可空, 兼容现有数据)
--   6. 现有的 products.category / products.series TEXT 列保留 (作 fallback 显示, deprecated 但兼容)
-- 数据迁移 (本 migration 内):
--   - 把现有 distinct category / series 写进字典 (id 自动递增)
--   - 把 products.category 文本对应到 categories.id, 填到 category_id
--   - 同理 series
-- 注意:
--   - 未来前端读取时优先 category_id -> 字典表回查 name. category TEXT 仅作 fallback.
--   - 已有数据有 1 条: category=浴霸, series=祥云.

-- 1. 字典表
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS series_dict (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. products 加外键列 (sqlite 直接 ALTER, 不需要重建)
ALTER TABLE products ADD COLUMN category_id INTEGER REFERENCES categories(id);
ALTER TABLE products ADD COLUMN series_id INTEGER REFERENCES series_dict(id);

-- 3. UNIQUE 索引 (延迟到数据迁移后再建, 否则现有同名会冲突 — 现在数据不冲突, 但幂等为先)
-- 现有数据检查: products 1 条, name='祥云901' 唯一, 安全建索引.
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_name_unique ON products(name);

-- 4. 索引
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_series_id ON products(series_id);

-- 5. 数据迁移: 把现有 distinct category / series 写进字典 (用 INSERT OR IGNORE 幂等)
INSERT OR IGNORE INTO categories(name) 
  SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND TRIM(category) <> '';

INSERT OR IGNORE INTO series_dict(name) 
  SELECT DISTINCT series FROM products WHERE series IS NOT NULL AND TRIM(series) <> '';

-- 6. 回填 products.category_id / series_id (用子查询匹配字典)
UPDATE products SET category_id = (SELECT id FROM categories WHERE name = products.category)
  WHERE category_id IS NULL AND category IS NOT NULL;

UPDATE products SET series_id = (SELECT id FROM series_dict WHERE name = products.series)
  WHERE series_id IS NULL AND series IS NOT NULL;
