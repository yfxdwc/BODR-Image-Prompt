-- 2026-07-11 BIP auth/RBAC: 给现有表加 owner_id (可空, 不破坏旧数据).
-- NULL = "系统所有/孤儿", admin 可认领 (UPDATE owner_id = admin.id).
ALTER TABLE items ADD COLUMN owner_id TEXT REFERENCES users(id);
ALTER TABLE products ADD COLUMN owner_id TEXT REFERENCES users(id);
ALTER TABLE clusters ADD COLUMN owner_id TEXT REFERENCES users(id);
ALTER TABLE import_drafts ADD COLUMN owner_id TEXT REFERENCES users(id);
CREATE INDEX idx_items_owner ON items(owner_id);
CREATE INDEX idx_products_owner ON products(owner_id);
CREATE INDEX idx_clusters_owner ON clusters(owner_id);
CREATE INDEX idx_import_drafts_owner ON import_drafts(owner_id);
