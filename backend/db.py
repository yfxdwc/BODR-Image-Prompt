import sqlite3
from pathlib import Path
from .config import resolve_library_path

MIGRATIONS = ["001_initial.sql", "002_image_roles.sql", "003_image_role_check.sql", "004_prompt_provenance.sql", "005_cluster_names.sql", "006_import_drafts.sql", "007_generation_jobs.sql", "008_generation_job_cancelled_at.sql", "009_products.sql", "010_product_images.sql", "011_product_detail_prompt.sql", "012_product_category.sql", "013_image_file_size.sql",
    "014_product_unique_constraints.sql",
    "015_remove_logo_presentation.sql",
    "016_8_field_product_prompt.sql",
    "017_merge_display_stage_and_logo.sql",
    "018_image_uploaded_at.sql",
    # 2026-07-11 BIP auth/RBAC (主人拍: 用现有 library/db.sqlite, 不开新库)
    "019_users_and_roles.sql",
    "020_registration_requests.sql",
    "021_sessions.sql",
    "022_audit_log.sql",
    "023_soft_owner.sql",
    # 2026-07-12 主人拍: 搜索增强
    "024_product_search.sql",
    # 2026-07-13 主人拍: 类别/系列 name 全局唯一 COLLATE NOCASE + 清理历史重复
    "025_category_series_unique.sql",]

def get_db_path(library_path=None) -> Path:
    return resolve_library_path(library_path) / "db.sqlite"

def connect(library_path=None) -> sqlite3.Connection:
    conn = sqlite3.connect(get_db_path(library_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_db(library_path=None) -> Path:
    library = resolve_library_path(library_path)
    db_path = library / "db.sqlite"
    with connect(library) as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)")
        done = {r[0] for r in conn.execute("SELECT version FROM schema_migrations")}
        for migration in MIGRATIONS:
            if migration not in done:
                sql = (Path(__file__).parent / "migrations" / migration).read_text(encoding="utf-8")
                conn.executescript(sql)
                conn.execute("INSERT INTO schema_migrations(version, applied_at) VALUES (?, datetime('now'))", (migration,))
        conn.commit()
    # 2026-07-04 21:51: backfill file_size_bytes for migration 013
    _backfill_file_sizes(library)
    # 2026-07-09 20:44: backfill uploaded_at for migration 018 (主人拍 E)
    _backfill_uploaded_at(library)
    return db_path


def _backfill_uploaded_at(library) -> None:
    """Migration 018 (2026-07-09 主人拍 E): 填现有 images.uploaded_at 为 created_at (同语义).
    只填空字符串的行, idempotent."""
    from datetime import datetime, timezone
    library = resolve_library_path(library)
    with connect(library) as conn:
        # 检查列是否存在 (防 migration 018 没跑过)
        cols = {r[1] for r in conn.execute("PRAGMA table_info(images)").fetchall()}
        if "uploaded_at" not in cols:
            return
        rows = conn.execute(
            "SELECT id, created_at FROM images WHERE uploaded_at = '' OR uploaded_at IS NULL"
        ).fetchall()
        for row in rows:
            # 优先用 created_at (已有 ISO datetime), fallback now()
            ts = row["created_at"] or datetime.now(timezone.utc).isoformat()
            conn.execute("UPDATE images SET uploaded_at = ? WHERE id = ?", (ts, row["id"]))
        if rows:
            conn.commit()


def _backfill_file_sizes(library) -> None:
    """Migration 013: stat 磁盘文件填 file_size_bytes. 只填 NULL 的行, idempotent."""
    import os
    library = resolve_library_path(library)
    with connect(library) as conn:
        # 检查列是否存在 (防 migration 013 没跑过)
        cols = {r[1] for r in conn.execute("PRAGMA table_info(product_images)").fetchall()}
        if "file_size_bytes" not in cols:
            return
        rows = conn.execute(
            "SELECT id, original_path FROM product_images WHERE file_size_bytes IS NULL OR file_size_bytes = 0"
        ).fetchall()
        updated = 0
        for row in rows:
            full = library / row["original_path"]
            try:
                size = full.stat().st_size if full.exists() else None
            except OSError:
                size = None
            if size is not None:
                conn.execute(
                    "UPDATE product_images SET file_size_bytes=? WHERE id=?",
                    (size, row["id"]),
                )
                updated += 1
        if updated:
            conn.commit()
