-- Migration 025: 类别/系列 name 全局唯一 (COLLATE NOCASE) (2026-07-13 主人拍)
-- 背景:
--   - 014 原本给 categories.name UNIQUE / series_dict.name UNIQUE, 但 series_dict 后来加 category_id 列时
--     走了 ALTER TABLE (SQLite 不支持加 UNIQUE 约束), 导致 UNIQUE 丢失. 现状: 蝉翼(3 行) / 飓风(2 行) 重复.
--   - categories 的 UNIQUE 是 BINARY 排序, 'A' 和 'a' 被视为不同名, 不合理.
-- 修复:
--   1. 数据清洗: 合并 series_dict 重复行, 把被合并产品 series_id 改到保留行的 id.
--   2. series_dict: 加 UNIQUE INDEX COLLATE NOCASE (全库 name 唯一, 不按 category_id 区分).
--   3. categories: 原 UNIQUE 约束无法 drop (SQLite 限制), 用 BEFORE INSERT/UPDATE 触发器强制 COLLATE NOCASE 唯一.
--      触发器会拦截重复并 raise ABORT, 让 Python 端 IntegrityError → 409.

-- 1. 数据清洗
-- 1.1 蝉翼: 删空引用 id=12/13, 保留 id=14 并把 category_id 改 3 (晾衣机) 跟产品 cat 一致
DELETE FROM series_dict WHERE id IN (12, 13);
UPDATE series_dict SET category_id = 3 WHERE id = 14;

-- 1.2 飓风: 删 id=15, 19 号产品 (飓风711-3C) series_id 15 → 8
UPDATE products SET series_id = 8 WHERE series_id = 15;
DELETE FROM series_dict WHERE id = 15;

-- 2. series_dict UNIQUE INDEX COLLATE NOCASE (全库 name 唯一)
CREATE UNIQUE INDEX IF NOT EXISTS idx_series_dict_name_unique_nocase
  ON series_dict(name COLLATE NOCASE);

-- 3. categories: BEFORE INSERT/UPDATE 触发器做 COLLATE NOCASE 唯一
-- 触发器内部 SELECT RAISE(ABORT) 抛错, Python 端会拿到 IntegrityError.
CREATE TRIGGER IF NOT EXISTS trg_categories_unique_nocase_insert
BEFORE INSERT ON categories
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM categories WHERE name = NEW.name COLLATE NOCASE)
BEGIN
  SELECT RAISE(ABORT, 'UNIQUE constraint failed: categories.name (case-insensitive)');
END;

CREATE TRIGGER IF NOT EXISTS trg_categories_unique_nocase_update
BEFORE UPDATE ON categories
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM categories
  WHERE id <> OLD.id AND name = NEW.name COLLATE NOCASE
)
BEGIN
  SELECT RAISE(ABORT, 'UNIQUE constraint failed: categories.name (case-insensitive)');
END;

-- 4. 防御性: products.category/series 文本字段不被强制等于 categories.name / series_dict.name (无 FK),
--    漂移由 _get_or_create_* 主动修正.
