# BODR Image Prompt 数据库迁移

10 个手写 SQL migration（按文件名顺序执行，应用启动时由 `backend/db.py:init_db` 调用）。

**不用 alembic**（决策 2026-06-20）：alembic 收益是自动 diff schema，主人 schema 已稳定，手写 SQL 简单可读。

## 加新 migration 的步骤

1. 在本目录创建 `NNN_xxx.sql`（NNN = 下一个编号）
2. 内容是标准 SQL（`ALTER TABLE` / `CREATE TABLE` 等）
3. 用 `IF NOT EXISTS` / `IF EXISTS` 守卫，确保幂等
4. 在 `backend/db.py:MIGRATIONS` 数组里追加文件名
5. **测试**：重启 backend，检查 db 是否成功迁移
6. **回滚**：手写 DOWN SQL，存到 `rollback/NNN_xxx.sql`（手动执行）

## 已用 migration

| # | 文件 | 目的 |
|---|------|------|
| 001 | `001_initial.sql` | clusters / tags / items / prompts / images 主表 |
| 002 | `002_image_roles.sql` | images 加 role 列 (result/reference) |
| 003 | `003_image_role_check.sql` | images role CHECK 约束 (sqlite 重建表法) |
| 004 | `004_prompt_provenance.sql` | prompts 加 is_original / provenance |
| 005 | `005_cluster_names.sql` | clusters 加 names 多语言 dict |
| 006 | `006_import_drafts.sql` | import_drafts 表（外部素材导入） |
| 007 | `007_generation_jobs.sql` | generation_jobs 表（图片生成任务） |
| 008 | `008_generation_job_cancelled_at.sql` | generation_jobs 加 cancelled_at |
| 009 | `009_products.sql` | products 表（产品库，prompt-cms 同步） |
| 010 | `010_product_images.sql` | product_images 表（产品多图） |

## 警告

- **不要删已应用的 migration** — 旧 db 用得上
- **ALTER TABLE 在 sqlite 是受限的**：列改名 / 删列 / 改类型需要"重建表法"（参见 003, 008）
- **大表迁移前先备份 db**：`cp library/db.sqlite library/db.sqlite.bak-$(date +%Y%m%d-%H%M)`
- **新功能用新表**，避免改老表加列（破坏现有数据）
