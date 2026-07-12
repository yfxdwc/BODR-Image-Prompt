-- Migration 024: product_search FTS5 表 (2026-07-12 主人拍)
-- TopBar 搜索框 + 品类/系列快速筛选胶囊落到 ProductLibraryView 时,
-- 后端在 list_products(q=...) 里需要全文检索支持.
-- 复用 items 那套: FTS5 优先 + LIKE 兜底 (repositories.py:list_products).
CREATE VIRTUAL TABLE IF NOT EXISTS product_search USING fts5(
  product_id UNINDEXED,
  name,
  series,
  category,
  spec,
  selling_points,
  after_sales,
  certifications,
  tokenize = 'unicode61'
);
