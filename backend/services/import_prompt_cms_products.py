"""Import products from the prompt-cms service into the local ipl SQLite database.

The CMS endpoint returns a paginated list shaped as
``{"items": [...], "pagination": {...}}``. Each item has at least
``id`` (the source id), ``name``, ``series``, ``spec``, ``selling_points``,
``created_at`` and ``updated_at``.

The import is idempotent: it only inserts rows whose ``source_id`` is
not already known. Existing rows are updated in place so that the
local copy reflects the latest upstream state on every ipl restart.

The function is safe to call from ``create_app`` and is wrapped in
``try/except`` by the caller so that a CMS outage does not prevent
the ipl backend from starting.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from backend.db import connect, init_db

DEFAULT_PROMPT_CMS_BASE = "http://192.168.1.200:5002"
PRODUCTS_ENDPOINT = "/api/v1/products"
REQUEST_TIMEOUT_SECONDS = 5


class PromptCmsImportError(RuntimeError):
    """Raised when the prompt-cms product import cannot complete."""


def _fetch_remote_products(base_url: str) -> list[dict[str, Any]]:
    """Fetch the product list from the prompt-cms service.

    The endpoint is paginated; we only consume the first page because
    the local product library is small (a few dozen rows at most).
    """
    url = base_url.rstrip("/") + PRODUCTS_ENDPOINT
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            payload_text = response.read().decode("utf-8")
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as exc:
        raise PromptCmsImportError(f"Failed to fetch products from {url}: {exc}") from exc

    try:
        payload = json.loads(payload_text)
    except json.JSONDecodeError as exc:
        raise PromptCmsImportError(f"Invalid JSON from {url}: {exc}") from exc

    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict):
        items = payload.get("items")
        if isinstance(items, list):
            return [item for item in items if isinstance(item, dict)]
    raise PromptCmsImportError(f"Unexpected payload shape from {url}")


def _coerce_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return str(value)


def import_prompt_cms_products(library_path: Path | str, *, base_url: str | None = None) -> dict[str, int]:
    """Import products from prompt-cms into the local ipl SQLite.

    Returns a summary dict with ``fetched``, ``inserted``, ``updated``
    and ``total`` counters. Raises :class:`PromptCmsImportError` on
    transport / schema failures.
    """
    library = Path(library_path)
    init_db(library)
    resolved_base = base_url or DEFAULT_PROMPT_CMS_BASE

    remote_items = _fetch_remote_products(resolved_base)
    # Sort by source id so that SQLite assigns the auto-increment ``id``
    # column in prompt-cms order. This keeps ``id`` deterministic across
    # restarts and matches the expected order in the product library UI.
    remote_items = sorted(remote_items, key=lambda item: item.get("id") if isinstance(item.get("id"), int) else 0)
    summary = {"fetched": len(remote_items), "inserted": 0, "updated": 0, "skipped": 0, "total": 0}

    with connect(library) as conn:
        existing_source_ids = {
            row["source_id"]
            for row in conn.execute("SELECT source_id FROM products").fetchall()
        }
        for item in remote_items:
            source_id = item.get("id")
            if not isinstance(source_id, int):
                summary["skipped"] += 1
                continue
            name = _coerce_text(item.get("name")) or ""
            if not name:
                summary["skipped"] += 1
                continue
            series = _coerce_text(item.get("series"))
            spec = _coerce_text(item.get("spec"))
            selling_points = _coerce_text(item.get("selling_points"))
            created_at = _coerce_text(item.get("created_at"))
            updated_at = _coerce_text(item.get("updated_at"))
            if source_id in existing_source_ids:
                conn.execute(
                    """
                    UPDATE products
                       SET name = ?,
                           series = ?,
                           spec = ?,
                           selling_points = ?,
                           updated_at = ?
                     WHERE source_id = ?
                    """,
                    (name, series, spec, selling_points, updated_at, source_id),
                )
                summary["updated"] += 1
            else:
                conn.execute(
                    """
                    INSERT INTO products(
                        source_id, name, series, spec, selling_points, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (source_id, name, series, spec, selling_points, created_at, updated_at),
                )
                existing_source_ids.add(source_id)
                summary["inserted"] += 1
        summary["total"] = conn.execute("SELECT COUNT(*) FROM products").fetchone()[0]
        conn.commit()
    return summary
