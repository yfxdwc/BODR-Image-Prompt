-- Migration 012: product category (2026-07-04 主人拍)
-- 背景: 主人在 ProductModal 顶部显示产品型号 (= product.name),
--       左栏产品信息在"产品名"前增加"产品类别"字段。
-- 字段: products.category TEXT (可空, 与 series/spec 同级)
--
-- 注: import_prompt_cms_products 同步流程会从 prompt-cms 拉数据,
--     类别字段若无则留空, 前端显示 "—" 占位。

ALTER TABLE products ADD COLUMN category TEXT;