CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  source_id INTEGER UNIQUE NOT NULL,
  name TEXT NOT NULL,
  series TEXT,
  spec TEXT,
  selling_points TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_products_source_id ON products(source_id);
