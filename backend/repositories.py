from __future__ import annotations
import re
import json, re, uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from contextlib import suppress
from typing import Optional  # 2026-07-06: for category/series dict helpers
from .db import connect, init_db
from .schemas import ClusterRecord, ImageRecord, ItemCreate, ItemDetail, ItemList, ItemSummary, ItemUpdate, MAX_REFERENCE_IMAGES, MAX_RESULT_IMAGES, PromptIn, PromptRecord, TagRecord
from .services.text_normalize import to_traditional

TEMPLATE_TAG_NAME = "template"
_PROMPT_TEMPLATE_RE = re.compile(r"{{([^{}]*)}}")


def prompt_has_template_variables(text: str) -> bool:
    for match in _PROMPT_TEMPLATE_RE.finditer(text or ""):
        if match.start() > 0 and text[match.start() - 1] == "\\":
            continue
        previous_open = text.rfind("{{", 0, match.start())
        previous_close = text.rfind("}}", 0, match.start())
        if previous_open > previous_close:
            continue
        if match.group(1).strip():
            return True
    return False


def _sync_template_tag_names(tags: list[str], prompts: list[PromptIn]) -> list[str]:
    clean_tags = [tag.strip() for tag in tags if tag and tag.strip() and tag.strip() != TEMPLATE_TAG_NAME]
    if any(prompt_has_template_variables(prompt.text) for prompt in prompts):
        clean_tags.append(TEMPLATE_TAG_NAME)
    return list(dict.fromkeys(clean_tags))


def now() -> str:
    return datetime.now(timezone.utc).isoformat()

def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"

def slugify(text: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff]+", "-", text.strip().lower()).strip("-")
    return slug or uuid.uuid4().hex[:8]

@dataclass
class StoredImageInput:
    original_path: str
    thumb_path: str | None = None
    preview_path: str | None = None
    remote_url: str | None = None
    width: int | None = None
    height: int | None = None
    file_sha256: str | None = None
    role: str = "result_image"

class ItemRepository:
    def __init__(self, library_path: Path | str):
        self.library_path = Path(library_path)
        init_db(self.library_path)

    def _unique_slug(self, conn, base: str, current_id: str | None = None) -> str:
        slug = slugify(base)
        candidate = slug
        i = 2
        while True:
            row = conn.execute("SELECT id FROM items WHERE slug=?", (candidate,)).fetchone()
            if not row or row["id"] == current_id:
                return candidate
            candidate = f"{slug}-{i}"
            i += 1

    def ensure_cluster(self, conn, name: str | None, cluster_id: str | None = None):
        if cluster_id:
            return cluster_id
        if not name:
            return None
        existing = conn.execute("SELECT id FROM clusters WHERE name=?", (name,)).fetchone()
        if existing:
            return existing["id"]
        cid = new_id("clu")
        ts = now()
        conn.execute("INSERT INTO clusters(id,name,created_at,updated_at) VALUES(?,?,?,?)", (cid, name, ts, ts))
        return cid

    def update_cluster_names(self, cluster_id: str | None, names: dict[str, str] | None) -> None:
        if not cluster_id or not names:
            return
        clean = {str(key): str(value).strip() for key, value in names.items() if str(value).strip()}
        if not clean:
            return
        with connect(self.library_path) as conn:
            conn.execute("UPDATE clusters SET names=?, updated_at=? WHERE id=?", (json.dumps(clean, ensure_ascii=False), now(), cluster_id))
            conn.commit()

    def _cluster_names_from_row(self, row) -> dict[str, str]:
        raw = row["cluster_names"] if "cluster_names" in row.keys() else row["names"] if "names" in row.keys() else None
        if isinstance(raw, str) and raw.strip():
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, dict):
                    return {str(key): str(value) for key, value in parsed.items() if str(value).strip()}
            except json.JSONDecodeError:
                return {}
        return {}

    def ensure_tag(self, conn, name: str, kind: str = "general") -> str:
        clean = name.strip()
        row = conn.execute("SELECT id FROM tags WHERE name=?", (clean,)).fetchone()
        if row:
            return row["id"]
        tid = new_id("tag")
        conn.execute("INSERT INTO tags(id,name,kind,created_at) VALUES(?,?,?,?)", (tid, clean, kind, now()))
        return tid

    def delete_empty_clusters(self, conn):
        rows = conn.execute("""
            SELECT c.id
            FROM clusters c
            LEFT JOIN items active_items ON active_items.cluster_id = c.id AND active_items.archived = 0
            GROUP BY c.id
            HAVING COUNT(active_items.id) = 0
        """).fetchall()
        cluster_ids = [row["id"] for row in rows]
        if not cluster_ids:
            return
        placeholders = ",".join("?" for _ in cluster_ids)
        conn.execute(f"UPDATE items SET cluster_id=NULL, updated_at=? WHERE cluster_id IN ({placeholders})", (now(), *cluster_ids))
        conn.execute(f"DELETE FROM clusters WHERE id IN ({placeholders})", cluster_ids)

    def _normalized_prompts(self, prompts: list[PromptIn], *, strict_original: bool = False) -> list[PromptIn]:
        normalized = list(prompts)
        languages = {p.language for p in normalized}
        if strict_original:
            self._validate_explicit_original(normalized)
        zh_hans = next((p for p in normalized if p.language == "zh_hans" and p.text.strip()), None)
        if zh_hans and "zh_hant" not in languages:
            provenance = {
                "kind": "conversion",
                "source_language": zh_hans.language,
                "derived_from": zh_hans.language,
                "method": "opencc-s2t",
            }
            normalized.insert(0, PromptIn(
                language="zh_hant",
                text=to_traditional(zh_hans.text),
                is_primary=zh_hans.is_primary,
                is_original=False,
                provenance=provenance,
            ))
            if zh_hans.is_primary:
                zh_hans.is_primary = False
        return self._with_single_original(normalized)

    def _validate_explicit_original(self, prompts: list[PromptIn]) -> None:
        usable = [prompt for prompt in prompts if prompt.text.strip()]
        has_explicit_provenance = any(bool(prompt.provenance) for prompt in usable)
        has_explicit_original_marker = any("is_original" in getattr(prompt, "model_fields_set", set()) for prompt in usable)
        if not (has_explicit_provenance or has_explicit_original_marker):
            return
        if sum(1 for prompt in usable if prompt.is_original) != 1:
            raise ValueError("Exactly one prompt must be marked as source/original")

    def _with_single_original(self, prompts: list[PromptIn]) -> list[PromptIn]:
        usable = [prompt for prompt in prompts if prompt.text.strip()]
        if not usable:
            return prompts
        originals = [prompt for prompt in usable if prompt.is_original]
        source_language = (originals[0] if originals else next((p for p in usable if p.is_primary), usable[0])).language
        original_assigned = False
        for prompt in usable:
            is_original = bool(prompt.is_original and prompt.language == source_language and not original_assigned)
            if not originals and prompt.language == source_language and not original_assigned:
                is_original = True
            prompt.is_original = is_original
            if is_original:
                original_assigned = True
                prompt.provenance = {
                    **({} if not prompt.provenance else prompt.provenance),
                    "kind": prompt.provenance.get("kind") or "manual",
                    "source_language": prompt.provenance.get("source_language") or prompt.language,
                    "derived_from": prompt.provenance.get("derived_from"),
                    "method": prompt.provenance.get("method"),
                }
            else:
                prompt.provenance = {
                    **({} if not prompt.provenance else prompt.provenance),
                    "kind": prompt.provenance.get("kind") or "manual",
                    "source_language": prompt.provenance.get("source_language") or source_language,
                    "derived_from": prompt.provenance.get("derived_from") or source_language,
                    "method": prompt.provenance.get("method"),
                }
        return prompts

    def _insert_prompt(self, conn, item_id: str, prompt: PromptIn, is_primary: bool, timestamp: str) -> None:
        conn.execute(
            """INSERT INTO prompts(id,item_id,language,text,is_primary,is_original,provenance,created_at,updated_at)
                VALUES(?,?,?,?,?,?,?,?,?)""",
            (
                new_id("prm"),
                item_id,
                prompt.language,
                prompt.text,
                int(is_primary),
                int(prompt.is_original),
                json.dumps(prompt.provenance or {}, ensure_ascii=False),
                timestamp,
                timestamp,
            ),
        )

    def create_item(self, payload: ItemCreate, imported: bool = False, forced_id: str | None = None) -> ItemDetail:
        with connect(self.library_path) as conn:
            iid = forced_id or new_id("itm")
            ts = now()
            cluster_id = self.ensure_cluster(conn, payload.cluster_name, payload.cluster_id)
            slug = self._unique_slug(conn, payload.slug or payload.title)
            conn.execute("""INSERT INTO items(id,title,slug,model,media_type,source_name,source_url,author,cluster_id,rating,favorite,archived,notes,created_at,updated_at,imported_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (iid, payload.title, slug, payload.model, payload.media_type, payload.source_name, payload.source_url, payload.author, cluster_id, payload.rating, int(payload.favorite), int(payload.archived), payload.notes, ts, ts, ts if imported else None))
            normalized_prompts = self._normalized_prompts(payload.prompts, strict_original=not imported)
            for idx, prompt in enumerate(normalized_prompts):
                self._insert_prompt(conn, iid, prompt, prompt.is_primary or idx == 0, ts)
            for tag in _sync_template_tag_names(payload.tags, normalized_prompts):
                if tag.strip():
                    tid = self.ensure_tag(conn, tag)
                    conn.execute("INSERT OR IGNORE INTO item_tags(item_id,tag_id) VALUES(?,?)", (iid, tid))
            self.rebuild_search(conn, iid)
            conn.commit()
        return self.get_item(iid)

    def update_item(self, item_id: str, payload: ItemUpdate) -> ItemDetail:
        data = payload.model_dump(exclude_unset=True)
        scalar = {k:v for k,v in data.items() if k in {"title","model","source_name","source_url","author","rating","notes"}}
        with connect(self.library_path) as conn:
            existing_item = conn.execute("SELECT cluster_id FROM items WHERE id=?", (item_id,)).fetchone()
            if existing_item is None:
                raise KeyError(item_id)
            previous_cluster_id = existing_item["cluster_id"]
            if "cluster_name" in data or "cluster_id" in data:
                scalar["cluster_id"] = self.ensure_cluster(conn, data.get("cluster_name"), data.get("cluster_id"))
            for bool_key in ("favorite","archived"):
                if bool_key in data: scalar[bool_key] = int(data[bool_key])
            if scalar:
                scalar["updated_at"] = now()
                sets = ", ".join(f"{k}=?" for k in scalar)
                conn.execute(f"UPDATE items SET {sets} WHERE id=?", (*scalar.values(), item_id))
            prompts_for_template_tag = None
            if "prompts" in data and data["prompts"] is not None:
                raw_prompts = [PromptIn.model_validate(prompt) if isinstance(prompt, dict) else prompt for prompt in (payload.prompts or [])]
                prompts_for_template_tag = self._normalized_prompts(raw_prompts, strict_original=True)
            if prompts_for_template_tag is None:
                prompts_for_template_tag = self._prompts(conn, item_id)
            if "tags" in data and data["tags"] is not None:
                conn.execute("DELETE FROM item_tags WHERE item_id=?", (item_id,))
                for tag in _sync_template_tag_names(data["tags"], prompts_for_template_tag):
                    if tag.strip():
                        conn.execute("INSERT OR IGNORE INTO item_tags(item_id,tag_id) VALUES(?,?)", (item_id, self.ensure_tag(conn, tag)))
            elif "prompts" in data and data["prompts"] is not None:
                existing_tags = [row["name"] for row in conn.execute("SELECT t.name FROM tags t JOIN item_tags it ON it.tag_id=t.id WHERE it.item_id=?", (item_id,)).fetchall()]
                conn.execute("DELETE FROM item_tags WHERE item_id=?", (item_id,))
                for tag in _sync_template_tag_names(existing_tags, prompts_for_template_tag):
                    conn.execute("INSERT OR IGNORE INTO item_tags(item_id,tag_id) VALUES(?,?)", (item_id, self.ensure_tag(conn, tag)))
            if "prompts" in data and data["prompts"] is not None:
                conn.execute("DELETE FROM prompts WHERE item_id=?", (item_id,))
                ts = now()
                for idx, prompt in enumerate(prompts_for_template_tag):
                    self._insert_prompt(conn, item_id, prompt, prompt.is_primary or idx == 0, ts)
            self.rebuild_search(conn, item_id)
            if ("cluster_id" in scalar and scalar["cluster_id"] != previous_cluster_id) or scalar.get("archived") == 1:
                self.delete_empty_clusters(conn)
            conn.commit()
        return self.get_item(item_id)

    def set_archived(self, item_id: str, archived: bool=True) -> ItemDetail:
        return self.update_item(item_id, ItemUpdate(archived=archived))

    def _safe_library_file(self, rel_path: str | None) -> Path | None:
        if not rel_path:
            return None
        candidate = (self.library_path / rel_path).resolve()
        library = self.library_path.resolve()
        try:
            if not candidate.is_relative_to(library):
                return None
        except AttributeError:
            if library not in candidate.parents and candidate != library:
                return None
        return candidate

    def _remove_unreferenced_media_files(self, paths: set[str]) -> None:
        for rel_path in sorted(path for path in paths if path):
            file_path = self._safe_library_file(rel_path)
            if not file_path or not file_path.is_file():
                continue
            with suppress(OSError):
                file_path.unlink()

    def delete_item(self, item_id: str) -> ItemDetail:
        detail = self.get_item(item_id)
        candidate_paths = {
            path
            for image in detail.images
            for path in (image.original_path, image.thumb_path, image.preview_path)
            if path
        }
        with connect(self.library_path) as conn:
            if conn.execute("SELECT 1 FROM items WHERE id=?", (item_id,)).fetchone() is None:
                raise KeyError(item_id)
            conn.execute("DELETE FROM item_search WHERE item_id=?", (item_id,))
            conn.execute("DELETE FROM items WHERE id=?", (item_id,))
            self.delete_empty_clusters(conn)
            still_used = set()
            for rel_path in candidate_paths:
                row = conn.execute(
                    """SELECT 1 FROM images
                       WHERE original_path=? OR thumb_path=? OR preview_path=?
                       LIMIT 1""",
                    (rel_path, rel_path, rel_path),
                ).fetchone()
                if row is not None:
                    still_used.add(rel_path)
            conn.commit()
        self._remove_unreferenced_media_files(candidate_paths - still_used)
        return detail

    def toggle_favorite(self, item_id: str) -> ItemDetail:
        with connect(self.library_path) as conn:
            row = conn.execute("SELECT favorite FROM items WHERE id=?", (item_id,)).fetchone()
        if not row:
            raise KeyError(item_id)
        return self.update_item(item_id, ItemUpdate(favorite=not bool(row["favorite"])))

    def add_image(self, item_id: str, image: StoredImageInput) -> ImageRecord:
        if image.role not in {"result_image", "reference_image"}:
            raise ValueError("Invalid image role")
        with connect(self.library_path) as conn:
            iid = new_id("img")
            ts = now()
            order = conn.execute("SELECT COALESCE(MAX(sort_order),-1)+1 FROM images WHERE item_id=?", (item_id,)).fetchone()[0]
            # 2026-07-09 20:44: migration 018 主人拍 E — uploaded_at 跟 created_at 同 ts (实操同语义, 但语义清晰)
            conn.execute("""INSERT INTO images(id,item_id,original_path,thumb_path,preview_path,remote_url,width,height,file_sha256,role,sort_order,created_at,uploaded_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""", (iid,item_id,image.original_path,image.thumb_path,image.preview_path,image.remote_url,image.width,image.height,image.file_sha256,image.role,order,ts,ts))
            conn.commit()
        return self._image_by_id(iid)

    # ── Multi-image editor (2026-06-20) ──────────────────────────────────────
    @staticmethod
    def _max_for_role(role: str) -> int:
        return MAX_RESULT_IMAGES if role == "result_image" else MAX_REFERENCE_IMAGES

    def _count_by_role(self, conn, item_id: str, role: str) -> int:
        return conn.execute(
            "SELECT COUNT(*) FROM images WHERE item_id=? AND role=?",
            (item_id, role),
        ).fetchone()[0]

    def assert_role_capacity(self, item_id: str, role: str, additional: int) -> None:
        """校验: role 图总数 + additional <= 限制. 超限抛 ValueError."""
        if role not in {"result_image", "reference_image"}:
            raise ValueError("Invalid image role")
        limit = self._max_for_role(role)
        with connect(self.library_path) as conn:
            current = self._count_by_role(conn, item_id, role)
        total = current + additional
        if total > limit:
            kind_label = "result_image" if role == "result_image" else "reference_image"
            raise ValueError(f"{kind_label} limit {limit} exceeded (current {current} + new {additional} = {total})")

    def append_images(self, item_id: str, images: list[StoredImageInput]) -> list[ImageRecord]:
        """追加多张图 (去重基于 file_sha256 + role). 每次插入前会校验总数 <= 限制."""
        if not images:
            return []
        # 按 role 分组预校验
        by_role: dict[str, int] = {}
        for img in images:
            if img.role not in {"result_image", "reference_image"}:
                raise ValueError("Invalid image role")
            by_role[img.role] = by_role.get(img.role, 0) + 1
        for role, count in by_role.items():
            self.assert_role_capacity(item_id, role, count)
        added: list[ImageRecord] = []
        with connect(self.library_path) as conn:
            inserted_ids: list[str] = []
            for image in images:
                if image.file_sha256:
                    dup = conn.execute(
                        "SELECT id FROM images WHERE item_id=? AND role=? AND file_sha256=?",
                        (item_id, image.role, image.file_sha256),
                    ).fetchone()
                    if dup:
                        inserted_ids.append(dup["id"])
                        continue
                iid = new_id("img")
                ts = now()
                order = conn.execute("SELECT COALESCE(MAX(sort_order),-1)+1 FROM images WHERE item_id=?", (item_id,)).fetchone()[0]
                # 2026-07-09 20:44: migration 018 主人拍 E — uploaded_at 跟 created_at 同 ts
                conn.execute("""INSERT INTO images(id,item_id,original_path,thumb_path,preview_path,remote_url,width,height,file_sha256,role,sort_order,created_at,uploaded_at)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""", (iid,item_id,image.original_path,image.thumb_path,image.preview_path,image.remote_url,image.width,image.height,image.file_sha256,image.role,order,ts,ts))
                inserted_ids.append(iid)
            conn.commit()
            for iid in inserted_ids:
                row = conn.execute("SELECT * FROM images WHERE id=?", (iid,)).fetchone()
                added.append(ImageRecord(**dict(row)))
        return added

    def remove_image(self, item_id: str, image_id: str) -> ImageRecord:
        """删除单张图. 返回被删的 record (含 path 用于上层清理文件). 不存在抛 KeyError."""
        with connect(self.library_path) as conn:
            row = conn.execute("SELECT * FROM images WHERE id=? AND item_id=?", (image_id, item_id)).fetchone()
            if row is None:
                raise KeyError(image_id)
            conn.execute("DELETE FROM images WHERE id=?", (image_id,))
            conn.commit()
        return ImageRecord(**dict(row))

    def set_result_image_cover(self, item_id: str, image_id: str) -> ImageRecord:
        """把指定 result_image 设为封面: 把它以及它同 role 的所有图片 sort_order 重排成 0..N-1,
        让该图排第一. 仅作用于 result_image 角色."""
        with connect(self.library_path) as conn:
            target = conn.execute("SELECT * FROM images WHERE id=? AND item_id=? AND role='result_image'", (image_id, item_id)).fetchone()
            if target is None:
                raise KeyError(image_id)
            # 现有 result 图按 sort_order 升序
            rows = conn.execute(
                "SELECT id FROM images WHERE item_id=? AND role='result_image' ORDER BY sort_order ASC, created_at ASC",
                (item_id,),
            ).fetchall()
            ids = [r["id"] for r in rows]
            ids = [image_id] + [i for i in ids if i != image_id]
            for i, iid in enumerate(ids):
                conn.execute("UPDATE images SET sort_order=? WHERE id=?", (i, iid))
            conn.commit()
        return self._image_by_id(image_id)

    def rotate_result_images_by_cover_index(self, item_id: str, cover_index: int) -> None:
        """编辑场景: cover_index 指定某个现有 result_image 排第一. 不修改/添加图片, 只重排 sort_order."""
        with connect(self.library_path) as conn:
            rows = conn.execute(
                "SELECT id FROM images WHERE item_id=? AND role='result_image' ORDER BY sort_order ASC, created_at ASC",
                (item_id,),
            ).fetchall()
            ids = [r["id"] for r in rows]
            if not ids or cover_index <= 0:
                return
            if cover_index >= len(ids):
                cover_index = 0
            ordered = ids[cover_index:] + ids[:cover_index]
            for i, iid in enumerate(ordered):
                conn.execute("UPDATE images SET sort_order=? WHERE id=?", (i, iid))
            conn.commit()

    def reorder_result_images(self, item_id: str, image_ids: list[str]) -> "ItemDetail":
        """拖拽 follow-up: 把指定顺序的 result_image ids 应用为新的 sort_order (0..N-1).
        image_ids 必须涵盖该 item 全部 result_image, 顺序即新顺序, 第 1 张自动为 cover.
        返回更新后的 ItemDetail."""
        with connect(self.library_path) as conn:
            for i, iid in enumerate(image_ids):
                row = conn.execute(
                    "SELECT id FROM images WHERE id=? AND item_id=? AND role='result_image'",
                    (iid, item_id),
                ).fetchone()
                if row is None:
                    raise KeyError(f"image {iid} not a result_image of item {item_id}")
                conn.execute("UPDATE images SET sort_order=? WHERE id=?", (i, iid))
            conn.commit()
        return self.get_item(item_id)

    def _cluster_from_row(self, row) -> ClusterRecord | None:
        if not row or not row["cluster_id"]: return None
        return ClusterRecord(id=row["cluster_id"], name=row["cluster_name"], names=self._cluster_names_from_row(row), description=row["cluster_description"], sort_order=row["cluster_sort_order"] or 0)

    def _image_by_id(self, image_id: str) -> ImageRecord:
        with connect(self.library_path) as conn:
            row = conn.execute("SELECT * FROM images WHERE id=?", (image_id,)).fetchone()
            return ImageRecord(**dict(row))

    def _tags(self, conn, item_id: str) -> list[TagRecord]:
        rows = conn.execute("SELECT t.id,t.name,t.kind,0 as count FROM tags t JOIN item_tags it ON it.tag_id=t.id WHERE it.item_id=? ORDER BY t.name", (item_id,)).fetchall()
        return [TagRecord(**dict(r)) for r in rows]

    def _prompts(self, conn, item_id: str) -> list[PromptRecord]:
        rows = conn.execute("SELECT * FROM prompts WHERE item_id=? ORDER BY is_primary DESC, created_at", (item_id,)).fetchall()
        prompts: list[PromptRecord] = []
        for row in rows:
            data = dict(row)
            provenance = data.get("provenance")
            if isinstance(provenance, str) and provenance.strip():
                try:
                    data["provenance"] = json.loads(provenance)
                except json.JSONDecodeError:
                    data["provenance"] = {}
            else:
                data["provenance"] = {}
            data["is_primary"] = bool(data.get("is_primary"))
            data["is_original"] = bool(data.get("is_original"))
            prompts.append(PromptRecord(**data))
        return prompts

    def _images(self, conn, item_id: str) -> list[ImageRecord]:
        return [ImageRecord(**dict(r)) for r in conn.execute("""SELECT * FROM images WHERE item_id=?
            ORDER BY CASE role WHEN 'result_image' THEN 0 ELSE 1 END, sort_order, created_at""", (item_id,)).fetchall()]

    def _summary_from_row(self, conn, row, *, with_images: bool = False) -> ItemSummary:
        prompts = self._prompts(conn, row["id"])
        images = self._images(conn, row["id"])
        return ItemSummary(id=row["id"], title=row["title"], slug=row["slug"], model=row["model"], source_name=row["source_name"], source_url=row["source_url"], cluster=self._cluster_from_row(row), tags=self._tags(conn,row["id"]), prompts=prompts, prompt_snippet=(prompts[0].text[:220] if prompts else None), first_image=(images[0] if images else None), rating=row["rating"], favorite=bool(row["favorite"]), archived=bool(row["archived"]), updated_at=row["updated_at"], created_at=row["created_at"])

    def get_item(self, item_id: str) -> ItemDetail:
        with connect(self.library_path) as conn:
            row = conn.execute("""SELECT i.*, c.id cluster_id, c.name cluster_name, c.names cluster_names, c.description cluster_description, c.sort_order cluster_sort_order FROM items i LEFT JOIN clusters c ON c.id=i.cluster_id WHERE i.id=?""", (item_id,)).fetchone()
            if not row: raise KeyError(item_id)
            summary = self._summary_from_row(conn, row)
            return ItemDetail(**summary.model_dump(exclude={'images'}), images=self._images(conn,item_id), notes=row["notes"], author=row["author"])

    def list_items(self, q: str | None=None, cluster: str | None=None, tag: str | None=None, favorite: bool | None=None, archived: bool | None=False, sort: str="updated_desc", limit: int=100, offset: int=0) -> ItemList:
        where=[]; params=[]
        if archived is not None: where.append("i.archived=?"); params.append(int(archived))
        if cluster: where.append("(i.cluster_id=? OR c.name=?)"); params += [cluster, cluster]
        if tag: where.append("EXISTS (SELECT 1 FROM item_tags it JOIN tags t ON t.id=it.tag_id WHERE it.item_id=i.id AND (t.id=? OR t.name=?))"); params += [tag, tag]
        if favorite is not None: where.append("i.favorite=?"); params.append(int(favorite))
        if q:
            tokens = re.findall(r"[\w\u4e00-\u9fff]+", q)
            like = f"%{q}%"
            if tokens:
                where.append("i.id IN (SELECT item_id FROM item_search WHERE item_search MATCH ? UNION SELECT i2.id FROM items i2 LEFT JOIN prompts p2 ON p2.item_id=i2.id LEFT JOIN item_tags it2 ON it2.item_id=i2.id LEFT JOIN tags t2 ON t2.id=it2.tag_id LEFT JOIN clusters c2 ON c2.id=i2.cluster_id WHERE (i2.title LIKE ? OR p2.text LIKE ? OR t2.name LIKE ? OR c2.name LIKE ? OR i2.notes LIKE ?))")
                match = ' '.join(part + '*' for part in tokens)
                params += [match, like, like, like, like, like]
            else:
                where.append("i.id IN (SELECT i2.id FROM items i2 LEFT JOIN prompts p2 ON p2.item_id=i2.id LEFT JOIN item_tags it2 ON it2.item_id=i2.id LEFT JOIN tags t2 ON t2.id=it2.tag_id LEFT JOIN clusters c2 ON c2.id=i2.cluster_id WHERE (i2.title LIKE ? OR p2.text LIKE ? OR t2.name LIKE ? OR c2.name LIKE ? OR i2.notes LIKE ?))")
                params += [like, like, like, like, like]
        where_sql = "WHERE " + " AND ".join(where) if where else ""
        order = {"created_desc":"i.created_at DESC", "title_asc":"i.title COLLATE NOCASE ASC", "rating_desc":"i.rating DESC, i.updated_at DESC"}.get(sort, "i.updated_at DESC")
        with connect(self.library_path) as conn:
            total = conn.execute(f"SELECT COUNT(DISTINCT i.id) FROM items i LEFT JOIN clusters c ON c.id=i.cluster_id {where_sql}", params).fetchone()[0]
            rows = conn.execute(f"""SELECT i.*, c.id cluster_id, c.name cluster_name, c.names cluster_names, c.description cluster_description, c.sort_order cluster_sort_order FROM items i LEFT JOIN clusters c ON c.id=i.cluster_id {where_sql} GROUP BY i.id ORDER BY {order} LIMIT ? OFFSET ?""", (*params, limit, offset)).fetchall()
            summaries = [self._summary_from_row(conn,r) for r in rows]
            # 填充 images 字段 (用于卡片多图堆叠)
            for summary in summaries:
                summary.images = self._images(conn, summary.id)
            return ItemList(items=summaries, total=total, limit=limit, offset=offset)

    def list_clusters(self) -> list[ClusterRecord]:
        with connect(self.library_path) as conn:
            self.delete_empty_clusters(conn)
            conn.commit()
            rows = conn.execute("""SELECT c.*, COUNT(i.id) count FROM clusters c LEFT JOIN items i ON i.cluster_id=c.id AND i.archived=0 GROUP BY c.id HAVING count > 0 ORDER BY c.sort_order, c.name""").fetchall()
            out=[]
            for r in rows:
                previews = [x[0] for x in conn.execute("""SELECT COALESCE(img.thumb_path,img.preview_path,img.original_path)
                    FROM images img JOIN items i ON i.id=img.item_id
                    WHERE i.cluster_id=? AND i.archived=0
                      AND NOT EXISTS (
                        SELECT 1 FROM images better
                        WHERE better.item_id=img.item_id AND (
                          CASE better.role WHEN 'result_image' THEN 0 ELSE 1 END < CASE img.role WHEN 'result_image' THEN 0 ELSE 1 END
                          OR (CASE better.role WHEN 'result_image' THEN 0 ELSE 1 END = CASE img.role WHEN 'result_image' THEN 0 ELSE 1 END AND better.sort_order < img.sort_order)
                          OR (CASE better.role WHEN 'result_image' THEN 0 ELSE 1 END = CASE img.role WHEN 'result_image' THEN 0 ELSE 1 END AND better.sort_order = img.sort_order AND better.created_at < img.created_at)
                        )
                      )
                    ORDER BY CASE img.role WHEN 'result_image' THEN 0 ELSE 1 END, img.sort_order LIMIT 4""",(r["id"],)).fetchall() if x[0]]
                out.append(ClusterRecord(id=r["id"], name=r["name"], names=self._cluster_names_from_row(r), description=r["description"], sort_order=r["sort_order"], count=r["count"], preview_images=previews))
            return out

    def list_tags(self) -> list[TagRecord]:
        with connect(self.library_path) as conn:
            rows = conn.execute("""SELECT t.id,t.name,t.kind,COUNT(i.id) count FROM tags t LEFT JOIN item_tags it ON it.tag_id=t.id LEFT JOIN items i ON i.id=it.item_id AND i.archived=0 GROUP BY t.id ORDER BY t.name""").fetchall()
            return [TagRecord(**dict(r)) for r in rows]

    def rebuild_search(self, conn, item_id: str):
        conn.execute("DELETE FROM item_search WHERE item_id=?", (item_id,))
        row = conn.execute("SELECT i.title,i.source_name,i.source_url,i.notes,c.name cluster FROM items i LEFT JOIN clusters c ON c.id=i.cluster_id WHERE i.id=?", (item_id,)).fetchone()
        if not row: return
        prompts = "\n".join(r[0] for r in conn.execute("SELECT text FROM prompts WHERE item_id=?", (item_id,)).fetchall())
        tags = " ".join(r[0] for r in conn.execute("SELECT t.name FROM tags t JOIN item_tags it ON it.tag_id=t.id WHERE it.item_id=?", (item_id,)).fetchall())
        source = " ".join(x or "" for x in (row["source_name"], row["source_url"]))
        conn.execute("INSERT INTO item_search(item_id,title,prompts,tags,cluster,source,notes) VALUES(?,?,?,?,?,?,?)", (item_id,row["title"],prompts,tags,row["cluster"] or "",source,row["notes"] or ""))


# ── ProductRepository (T-2026-06-17-ipl-product-image-group, 在 4caf16a 之上加) ──
import uuid as _uuid
from .services.image_store import store_image

def _new_product_image_id() -> str:
    return f"pi_{_uuid.uuid4().hex[:24]}"


class ProductRepository:
    """产品多图管理: 列表/详情/上传/设封面/重排/删除.
    兼容 4caf16a 的旧 Product 模型, 新接口返回 ProductDetail (含 images + cover)."""

    def __init__(self, library_path):
        self.library_path = library_path

    # 2026-07-10 主人拍: 瀑布流时间线用的上传日期兑底.
    # 优先 created_at (ISO 字符串); 不存在/全同月时兑底到 original_path 文件 mtime (真实上传到磁盘的时间).
    # 返回 ISO 8601 字符串. 读不到时 = created_at; 都读不到 = None.
    def _effective_uploaded_at(self, created_at: Optional[str], original_path: Optional[str]) -> Optional[str]:
        # 1) created_at 优先
        if created_at:
            return created_at
        # 2) 文件系统 mtime 兑底
        if original_path:
            try:
                # original_path 是相对路径, 在 library/originals/ 下面
                full = Path(self.library_path) / original_path
                if full.exists():
                    ts = full.stat().st_mtime
                    # 输出 ISO 格式跟 created_at 对齐
                    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(timespec='seconds')
            except (OSError, ValueError):
                pass
        return None

    def _row_to_image(self, row) -> "ProductImageRecord":
        from .schemas import ProductImageRecord
        d = dict(row)
        d["effective_uploaded_at"] = self._effective_uploaded_at(d.get("created_at"), d.get("original_path"))
        return ProductImageRecord(**d)

    def _row_to_product(self, row, *, with_images: bool = False) -> "ProductDetail":
        from .schemas import ProductDetail, ProductImageRecord
        keys = row.keys() if hasattr(row, "keys") else []
        def _opt(col: str):
            return row[col] if col in keys else None
        if not with_images:
            return ProductDetail(
                id=row["id"],
                source_id=row["source_id"],
                name=row["name"],
                series=row["series"],
                category=_opt("category"),
                spec=row["spec"],
                selling_points=row["selling_points"],
                after_sales=_opt("after_sales"),
                certifications=_opt("certifications"),
                created_at=row["created_at"],
                updated_at=row["updated_at"],
            )
        # 查 images (含 10 字段提示词, 2026-07-06 16:42 主人拍: 展台 + 展台正面的 logo 独立)
        with connect(self.library_path) as conn:
            img_rows = conn.execute(
                "SELECT id, product_id, original_path, thumb_path, preview_path, remote_url, "
                "width, height, file_sha256, file_size_bytes, sort_order, is_cover, created_at, "
                "slogan, subject_angle, composition, lighting, display_stage_and_logo, "
                "material_texture, background, style, color_tone "
                "FROM product_images WHERE product_id=? ORDER BY sort_order ASC, created_at ASC",
                (row["id"],),
            ).fetchall()
        images = [self._row_to_image(r) for r in img_rows]
        cover_image = next((i for i in images if i.is_cover), None)
        return ProductDetail(
            id=row["id"],
            source_id=row["source_id"],
            name=row["name"],
            series=row["series"],
            category=_opt("category"),
            spec=row["spec"],
            selling_points=row["selling_points"],
            after_sales=_opt("after_sales"),
            certifications=_opt("certifications"),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            cover_image_id=_opt("cover_image_id"),
            cover_image=cover_image,
            images=images,
        )

    def list_products(self, q: Optional[str] = None, category_id: Optional[int] = None, series_id: Optional[int] = None):
        """Product Library 列表. 2026-07-12 主人拍: 支持 TopBar 搜索 + 品类/系列快速筛选胶囊.

        过滤:
          q          → LIKE 匹配 name/series/category/spec/selling_points/after_sales/certifications
          category_id → products.category_id = N
          series_id  → products.series_id = N

        排序保持原状: 最近上传了图片的卡片排最前.
        """
        from .schemas import ProductDetailList
        where = []
        params: list = []
        if category_id is not None:
            where.append("p.category_id = ?")
            params.append(category_id)
        if series_id is not None:
            where.append("p.series_id = ?")
            params.append(series_id)
        if q:
            like = f"%{q}%"
            # 2026-07-14 主人拍: 搜索时按"型号 > 规格"优先级排序. 简化用 LIKE 即可
            # (FTS5 偶发 syntax error, 281 条产品 LIKE 性能无压力).
            where.append(
                "p.id IN (SELECT p2.id FROM products p2 WHERE "
                "(p2.name LIKE ? OR p2.series LIKE ? OR p2.category LIKE ? "
                "OR p2.spec LIKE ? OR p2.selling_points LIKE ? "
                "OR p2.after_sales LIKE ? OR p2.certifications LIKE ?))"
            )
            params += [like, like, like, like, like, like, like]
        where_sql = ("WHERE " + " AND ".join(where)) if where else ""
        with connect(self.library_path) as conn:
            if q:
                # 2026-07-14 主人拍: 搜索结果优先级. 优先按"匹配度"排序, 再按最近图片/ID.
                # 评分: name LIKE 4 > series 2 > spec 1 > 其它字段 0.
                # 多个 token 全部 LIKE 命中再加一个奖励分 (防止部分 token 命中后靠前).
                tokens = re.findall(r"[\w\u4e00-\u9fff]+", q)
                match_clauses=[]
                score_params=[]
                for needle in tokens:
                    n=f"%{needle}%"
                    match_clauses.append(
                        "(CASE WHEN p.name LIKE ? THEN 4 ELSE 0 END"
                        "+CASE WHEN p.series LIKE ? THEN 2 ELSE 0 END"
                        "+CASE WHEN p.spec LIKE ? THEN 1 ELSE 0 END"
                        "+CASE WHEN p.category LIKE ? THEN 1 ELSE 0 END"
                        "+CASE WHEN p.selling_points LIKE ? THEN 1 ELSE 0 END"
                        "+CASE WHEN p.after_sales LIKE ? THEN 1 ELSE 0 END"
                        "+CASE WHEN p.certifications LIKE ? THEN 1 ELSE 0 END)"
                    )
                    score_params += [n,n,n,n,n,n,n]
                # 全部 token 命中加分
                all_match=[]
                for needle in tokens:
                    n=f"%{needle}%"
                    all_match.append("(CASE WHEN p.name LIKE ? OR p.series LIKE ? OR p.spec LIKE ? OR p.category LIKE ? OR p.selling_points LIKE ? OR p.after_sales LIKE ? OR p.certifications LIKE ? THEN 1 ELSE 0 END)")
                    score_params += [n,n,n,n,n,n,n]
                bonus = " + ".join(all_match)
                score_expr = " + ".join(match_clauses) + (" + " + bonus if bonus else "")
                rows = conn.execute(
                    f"SELECT id, source_id, name, series, category, spec, selling_points, "
                    f"after_sales, certifications, "
                    f"created_at, updated_at, cover_image_id, "
                    f"({score_expr}) AS score "
                    f"FROM products p {where_sql} "
                    f"ORDER BY score DESC, "
                    f"(SELECT MAX(pi.created_at) FROM product_images pi WHERE pi.product_id=p.id) DESC, "
                    f"id DESC",
                    tuple(params + score_params),
                ).fetchall()
            else:
                # 2026-07-10 13:51 主人拍: grid 网格页"最近上传了图片的卡片排最前"
                # ORDER BY: 最近 product_images.created_at 倒序, 无图 product 排最后
                rows = conn.execute(
                    f"SELECT id, source_id, name, series, category, spec, selling_points, "
                    f"after_sales, certifications, "
                    f"created_at, updated_at, cover_image_id "
                    f"FROM products p {where_sql} "
                    f"ORDER BY (SELECT MAX(pi.created_at) FROM product_images pi WHERE pi.product_id=p.id) DESC, "
                    f"id DESC",
                    tuple(params),
                ).fetchall()
        return ProductDetailList(items=[self._row_to_product(r, with_images=True) for r in rows], total=len(rows))

    def rebuild_product_search(self, conn, product_id: int):
        """2026-07-12 主人拍: 同步 product_search FTS5 表.
        在 create_product / update_info 末尾调用, 让 list_products(q=...) 命中."""
        conn.execute("DELETE FROM product_search WHERE product_id=?", (product_id,))
        row = conn.execute(
            "SELECT name, series, category, spec, selling_points, after_sales, certifications "
            "FROM products WHERE id=?", (product_id,)
        ).fetchone()
        if not row:
            return
        conn.execute(
            "INSERT INTO product_search(product_id, name, series, category, spec, "
            "selling_points, after_sales, certifications) VALUES (?,?,?,?,?,?,?,?)",
            (product_id,
             row["name"] or "",
             row["series"] or "",
             row["category"] or "",
             row["spec"] or "",
             row["selling_points"] or "",
             row["after_sales"] or "",
             row["certifications"] or ""),
        )

    def get_product(self, product_id: int):
        with connect(self.library_path) as conn:
            row = conn.execute(
                "SELECT id, source_id, name, series, category, spec, selling_points, "
                "after_sales, certifications, "
                "created_at, updated_at, cover_image_id "
                "FROM products WHERE id=?",
                (product_id,),
            ).fetchone()
        if row is None:
            raise KeyError(product_id)
        return self._row_to_product(row, with_images=True)

    def create_product(self, body) -> "ProductDetail":
        """2026-07-05 09:07 主人拍 A 方案: 新建产品.
        source_id 自动分配 = max(source_id) + 1 (UNIQUE NOT NULL 约束).
        name 必填; 其他字段可选 (model_fields_set 区分"未传 vs 传 None/空").

        2026-07-06: 加 name UNIQUE 检测, name 重复 = ValueError("duplicate_product_name").
        2026-07-06: category / series 文本 → 自动 _get_or_create_*_id, 回填 _id 字段.
        """
        from .schemas import ProductInfoUpdate
        now = datetime.now(timezone.utc).isoformat()
        with connect(self.library_path) as conn:
            # 1) name UNIQUE 检测 (UNIQUE 索引已存在, 这里友好抛 ValueError)
            dup = conn.execute(
                "SELECT id FROM products WHERE name=? COLLATE NOCASE",
                (body.name.strip(),),
            ).fetchone()
            if dup is not None:
                raise ValueError(f"duplicate_product_name:{dup['id']}")
            # 2) category / series 文本 → 字典 id (空文本视为 None)
            cat_id = self._get_or_create_category_id(
                conn, getattr(body, "category", None) if "category" in getattr(body, "model_fields_set", set()) else None
            )
            ser_id = self._get_or_create_series_id(
                conn, getattr(body, "series", None) if "series" in getattr(body, "model_fields_set", set()) else None,
                category_id=cat_id
            )
            # 3) 分配 source_id
            row = conn.execute("SELECT COALESCE(MAX(source_id), 0) AS max_source FROM products").fetchone()
            new_source_id = (row["max_source"] or 0) + 1
            # 4) 构建插入字段 (含 category_id / series_id)
            fields = ["source_id", "name", "created_at", "updated_at"]
            placeholders = ["?", "?", "?", "?"]
            params: list = [new_source_id, body.name, now, now]
            if cat_id is not None:
                fields.append("category_id"); placeholders.append("?"); params.append(cat_id)
            if ser_id is not None:
                fields.append("series_id"); placeholders.append("?"); params.append(ser_id)
            for field in ("category", "series", "spec", "selling_points", "after_sales", "certifications"):
                if field in getattr(body, "model_fields_set", set()):
                    fields.append(field)
                    placeholders.append("?")
                    params.append(getattr(body, field))
            cur = conn.execute(
                f"INSERT INTO products ({', '.join(fields)}) VALUES ({', '.join(placeholders)})",
                params,
            )
            new_id = cur.lastrowid
            self.rebuild_product_search(conn, new_id)
        return self.get_product(new_id)

    # ── Dictionary helpers: categories / series ─────────────────────────────
    # 2026-07-06 主人拍: 类别 + 系列做下拉列表, 需要字典化供前端 SELECT.
    # 设计: 两个独立方法 _get_or_create_*_id, 接受 None / 空字符串视为 None.
    # 名称去重统一在数据库层 (UNIQUE 约束), race-condition 安全.

    def _get_or_create_category_id(self, conn, name: Optional[str]) -> Optional[int]:
        if name is None:
            return None
        clean = name.strip()
        if not clean:
            return None
        row = conn.execute("SELECT id FROM categories WHERE name=? COLLATE NOCASE", (clean,)).fetchone()
        if row is not None:
            return row["id"]
        cur = conn.execute("INSERT INTO categories(name) VALUES(?)", (clean,))
        return cur.lastrowid

    def _get_or_create_series_id(self, conn, name: Optional[str], category_id: Optional[int] = None) -> Optional[int]:
        """2026-07-13 主人拍: series name 全局唯一 (跨 category).
        之前按 (category_id, name) 局部去重导致蝉翼/飓风 重复, 已由 migration 025 合并清理.
        行为: 先按 name COLLATE NOCASE 全库查, 命中即返回; 不命中则 INSERT (新行).
        如果传了 category_id 且现存行的 category_id 跟传入的不同, 更新到传入值 (修正漂移)."""
        if name is None:
            return None
        clean = name.strip()
        if not clean:
            return None
        row = conn.execute(
            "SELECT id, category_id FROM series_dict WHERE name=? COLLATE NOCASE",
            (clean,),
        ).fetchone()
        if row is not None:
            # 修正 category_id 漂移: 字典里的 series 必须跟传入的 category 一致
            if category_id is not None and row["category_id"] != category_id:
                conn.execute(
                    "UPDATE series_dict SET category_id=? WHERE id=?",
                    (category_id, row["id"]),
                )
            return row["id"]
        if category_id is not None:
            cur = conn.execute(
                "INSERT INTO series_dict(name, category_id) VALUES(?, ?)",
                (clean, category_id),
            )
        else:
            cur = conn.execute("INSERT INTO series_dict(name) VALUES(?)", (clean,))
        return cur.lastrowid

    def list_categories(self) -> list:
        """前端下拉: GET /categories 返回 [{id, name, count}, ...]."""
        from .schemas import CategoryRecord
        with connect(self.library_path) as conn:
            rows = conn.execute(
                "SELECT c.id, c.name, c.created_at, COUNT(p.id) AS count "
                "FROM categories c LEFT JOIN products p ON p.category_id = c.id "
                "GROUP BY c.id ORDER BY c.name"
            ).fetchall()
        return [CategoryRecord(**dict(r)) for r in rows]

    def list_series(self, category_id: Optional[int] = None) -> list:
        """前端下拉: GET /series_dict 返回 [{id, name, count}, ...].
        2026-07-07 主人拍 A 方案加 category_id 过滤: 品类和系列父子关系.
        - category_id=None → 返回所有 series (含 count 是该系列所有产品的数量, 不分品类)
        - category_id=N → 仅返回该 category 下的所有 series (count = 该品类下属于此 series 的产品数)
        """
        from .schemas import SeriesRecord
        with connect(self.library_path) as conn:
            if category_id is None:
                # 不带 category: 全量
                rows = conn.execute(
                    "SELECT s.id, s.name, s.created_at, COUNT(p.id) AS count "
                    "FROM series_dict s LEFT JOIN products p ON p.series_id = s.id "
                    "GROUP BY s.id ORDER BY s.name"
                ).fetchall()
            else:
                # 按 category 过滤: 返回该 category 下有产品 (或 series.cat_id 命中) 的所有 series.
                # 2026-07-13 主人拍 ZBAN 案例: ZBAN 系列被 3 个产品用, 跨 浴霸/凉霸/LED灯 3 个 category.
                # 旧逻辑 'WHERE s.category_id = ?' 会让 ZBAN 只在它当前 cat_id=4 (LED灯) 下显示,
                # 浴霸和凉霸下的 ZBAN 产品在 list_series 下拉里看不到自己的 series.
                # 改: 包含 (a) series.cat_id = ? (字典归属) 或 (b) 该 category 下有产品 (产品归属).
                rows = conn.execute(
                    """
                    SELECT s.id, s.name, s.created_at,
                           COUNT(p.id) AS count
                    FROM series_dict s
                    LEFT JOIN products p
                      ON p.series_id = s.id AND p.category_id = ?
                    WHERE s.category_id = ?
                       OR EXISTS (SELECT 1 FROM products p2
                                  WHERE p2.series_id = s.id AND p2.category_id = ?)
                    GROUP BY s.id
                    ORDER BY s.name
                    """,
                    (category_id, category_id, category_id),
                ).fetchall()
        return [SeriesRecord(**dict(r)) for r in rows]  

    def get_product_by_source_id(self, source_id: int):
        with connect(self.library_path) as conn:
            row = conn.execute(
                "SELECT id, source_id, name, series, category, spec, selling_points, "
                "after_sales, certifications, "
                "created_at, updated_at, cover_image_id "
                "FROM products WHERE source_id=?",
                (source_id,),
            ).fetchone()
        if row is None:
            raise KeyError(source_id)
        return self._row_to_product(row, with_images=True)

    def update_info(self, product_id: int, body) -> "ProductDetail":
        """2026-07-04 加: 更新 product 基本信息 (左栏可编辑).
        2026-07-04 21:31 加 category 字段.
        2026-07-06 加: name UNIQUE 检测 (dup → ValueError); category/series 文本回写 category_id/series_id."""
        now = datetime.now(timezone.utc).isoformat()
        with connect(self.library_path) as conn:
            p = conn.execute("SELECT id FROM products WHERE id=?", (product_id,)).fetchone()
            if p is None:
                raise KeyError(product_id)
            # 1) name UNIQUE 检测 (传了 name 才检查, 排除自己)
            if "name" in getattr(body, "model_fields_set", set()):
                dup = conn.execute(
                    "SELECT id FROM products WHERE name=? COLLATE NOCASE AND id<>?",
                    (body.name.strip(), product_id),
                ).fetchone()
                if dup is not None:
                    raise ValueError(f"duplicate_product_name:{dup['id']}")
            # 2) category / series 文本 → 回写 _id
            if "category" in getattr(body, "model_fields_set", set()):
                cat_id = self._get_or_create_category_id(conn, body.category)
                conn.execute(
                    "UPDATE products SET category_id=?, updated_at=? WHERE id=?",
                    (cat_id, now, product_id),
                )
            if "series" in getattr(body, "model_fields_set", set()):
                # 2026-07-13 主人拍: series 全库唯一, 但需要确定它的 category_id.
                # 优先级: body.category > products.category_id > None
                cat_id = None
                if "category" in getattr(body, "model_fields_set", set()) and body.category:
                    cat_row = conn.execute(
                        "SELECT id FROM categories WHERE name=? COLLATE NOCASE", (body.category.strip(),)
                    ).fetchone()
                    cat_id = cat_row["id"] if cat_row else None
                if cat_id is None:
                    cur_row = conn.execute("SELECT category_id FROM products WHERE id=?", (product_id,)).fetchone()
                    cat_id = cur_row["category_id"] if cur_row else None
                ser_id = self._get_or_create_series_id(conn, body.series, category_id=cat_id)
                conn.execute(
                    "UPDATE products SET series_id=?, updated_at=? WHERE id=?",
                    (ser_id, now, product_id),
                )
            # 3) 原文本字段 UPDATE (保留 category / series TEXT 镜像, deprecated fallback)
            updates = []
            params: list = []
            for field in ("name", "category", "series", "spec", "selling_points", "after_sales", "certifications"):
                value = getattr(body, field, None)
                # Pydantic 默认 None = 不传; 但调用方明确传了空字符串视为清空, 用 model_fields_set 区分
                if field in getattr(body, "model_fields_set", set()):
                    updates.append(f"{field}=?")
                    params.append(value)
            if updates:
                updates.append("updated_at=?")
                params.append(now)
                params.append(product_id)
                conn.execute(
                    f"UPDATE products SET {', '.join(updates)} WHERE id=?",
                    params,
                )
            self.rebuild_product_search(conn, product_id)
        return self.get_product(product_id)

    def update_image_prompt(self, product_id: int, image_id: str, body) -> "ProductDetail":
        """2026-07-04 加: 更新单张产品图的 5 字段提示词."""
        now = datetime.now(timezone.utc).isoformat()
        with connect(self.library_path) as conn:
            p = conn.execute("SELECT id FROM products WHERE id=?", (product_id,)).fetchone()
            if p is None:
                raise KeyError(product_id)
            img = conn.execute(
                "SELECT id FROM product_images WHERE id=? AND product_id=?",
                (image_id, product_id),
            ).fetchone()
            if img is None:
                raise KeyError(image_id)
            updates = []
            params: list = []
            # 2026-07-06 17:19 重设计: 9 字段 (合并 display_stage + logo_presentation)
            _MAX_30 = ("subject_angle", "composition",
                       "material_texture", "background", "style", "color_tone")
            _MAX_50 = ("lighting", "display_stage_and_logo")
            _MAX_20 = ("slogan",)
            for field in ("slogan", "subject_angle", "composition", "lighting",
                          "display_stage_and_logo",
                          "material_texture", "background", "style", "color_tone"):
                if field in getattr(body, "model_fields_set", set()):
                    value = getattr(body, field)
                    if isinstance(value, str):
                        if field in _MAX_30 and len(value) > 30:
                            value = value[:30].rstrip()
                        elif field in _MAX_50 and len(value) > 50:
                            value = value[:50].rstrip()
                        elif field in _MAX_20 and len(value) > 20:
                            value = value[:20].rstrip()
                    updates.append(f"{field}=?")
                    params.append(value)
            if not updates:
                return self.get_product(product_id)
            params.append(image_id)
            conn.execute(
                f"UPDATE product_images SET {', '.join(updates)} WHERE id=?",
                params,
            )
            conn.execute("UPDATE products SET updated_at=? WHERE id=?", (now, product_id))
        return self.get_product(product_id)

    def attach_image(self, product_id: int, data: bytes, filename: str, compress: bool = True) -> "ProductDetail":
        from .schemas import ProductImageRecord
        stored = store_image(self.library_path, data, filename, compress=compress)
        img_id = _new_product_image_id()
        now = datetime.now(timezone.utc).isoformat()
        with connect(self.library_path) as conn:
            # 验证 product 存在
            p = conn.execute("SELECT id FROM products WHERE id=?", (product_id,)).fetchone()
            if p is None:
                raise KeyError(product_id)
            # 计算 sort_order = max + 1
            max_order = conn.execute("SELECT COALESCE(MAX(sort_order), -1) FROM product_images WHERE product_id=?", (product_id,)).fetchone()[0]
            # 第一张图自动设为 cover
            is_first = max_order == -1
            # 2026-07-04 21:51: 写入时填 file_size_bytes (新上传图直接填)
            from pathlib import Path as _P
            try:
                size_bytes = _P(self.library_path, stored.original_path).stat().st_size
            except OSError:
                size_bytes = None
            conn.execute(
                "INSERT INTO product_images(id, product_id, original_path, thumb_path, preview_path, width, height, file_sha256, file_size_bytes, sort_order, is_cover, created_at) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                (img_id, product_id, stored.original_path, stored.thumb_path, stored.preview_path,
                 stored.width, stored.height, stored.file_sha256, size_bytes, max_order + 1, 1 if is_first else 0, now),
            )
            if is_first:
                conn.execute("UPDATE products SET cover_image_id=?, updated_at=? WHERE id=?", (img_id, now, product_id))
        return self.get_product(product_id)

    def set_cover(self, product_id: int, image_id: str) -> "ProductDetail":
        now = datetime.now(timezone.utc).isoformat()
        with connect(self.library_path) as conn:
            p = conn.execute("SELECT id FROM products WHERE id=?", (product_id,)).fetchone()
            if p is None:
                raise KeyError(product_id)
            img = conn.execute("SELECT id FROM product_images WHERE id=? AND product_id=?", (image_id, product_id)).fetchone()
            if img is None:
                raise KeyError(image_id)
            conn.execute("UPDATE product_images SET is_cover=0 WHERE product_id=?", (product_id,))
            conn.execute("UPDATE product_images SET is_cover=1 WHERE id=?", (image_id,))
            conn.execute("UPDATE products SET cover_image_id=?, updated_at=? WHERE id=?", (image_id, now, product_id))
        return self.get_product(product_id)

    def remove_image(self, product_id: int, image_id: str) -> "ProductDetail":
        from .schemas import ProductImageRecord
        with connect(self.library_path) as conn:
            p = conn.execute("SELECT id FROM products WHERE id=?", (product_id,)).fetchone()
            if p is None:
                raise KeyError(product_id)
            img = conn.execute("SELECT * FROM product_images WHERE id=? AND product_id=?", (image_id, product_id)).fetchone()
            if img is None:
                raise KeyError(image_id)
            was_cover = bool(img["is_cover"])
            conn.execute("DELETE FROM product_images WHERE id=?", (image_id,))
            if was_cover:
                # 自动选下一张
                new_cover = conn.execute(
                    "SELECT id FROM product_images WHERE product_id=? ORDER BY sort_order ASC, created_at ASC LIMIT 1",
                    (product_id,),
                ).fetchone()
                new_cover_id = new_cover["id"] if new_cover else None
                conn.execute("UPDATE products SET cover_image_id=?, updated_at=? WHERE id=?", (new_cover_id, datetime.now(timezone.utc).isoformat(), product_id))
        return self.get_product(product_id)

    def track_action(self, image_id: str, action: str) -> Optional[Dict[str, Any]]:
        """2026-07-24 主人拍: 复制/下载计数 +1, 返回最新计数. 不存在返回 None.
        不做节流 (节流逻辑放 router 层, 用 audit_log 判)."""
        if action not in ("copy", "download"):
            raise ValueError("action must be copy or download")
        col = "copy_count" if action == "copy" else "download_count"
        with connect(self.library_path) as conn:
            row = conn.execute("SELECT id FROM product_images WHERE id=?", (image_id,)).fetchone()
            if row is None:
                return None
            conn.execute(f"UPDATE product_images SET {col} = {col} + 1 WHERE id=?", (image_id,))
            r = conn.execute("SELECT copy_count, download_count FROM product_images WHERE id=?", (image_id,)).fetchone()
        return {"image_id": image_id, "copy_count": r["copy_count"], "download_count": r["download_count"]}


    def reorder_images(self, product_id: int, image_ids: list) -> "ProductDetail":
        now = datetime.now(timezone.utc).isoformat()
        with connect(self.library_path) as conn:
            p = conn.execute("SELECT id FROM products WHERE id=?", (product_id,)).fetchone()
            if p is None:
                raise KeyError(product_id)
            for i, img_id in enumerate(image_ids):
                conn.execute("UPDATE product_images SET sort_order=? WHERE id=? AND product_id=?", (i, img_id, product_id))

    def delete_product(self, product_id: int) -> int:
        """2026-07-05 09:56 主人拍 A 方案: 删除产品 (级联删 images - ON DELETE CASCADE 已设).
        返回被删除的 product id, 不存在抛 KeyError.
        2026-07-12 主人拍: 同时清理 product_search FTS 索引."""
        with connect(self.library_path) as conn:
            cur = conn.execute("DELETE FROM products WHERE id=?", (product_id,))
            if cur.rowcount == 0:
                raise KeyError(product_id)
            conn.execute("DELETE FROM product_search WHERE product_id=?", (product_id,))
        return product_id
