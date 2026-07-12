"""2026-07-11 BIP auth/RBAC: 写 audit_log. 所有 admin/用户关键操作必走这里."""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from typing import Any, Optional


def write_audit(
    conn: sqlite3.Connection,
    *,
    user_id: Optional[str],
    action: str,
    resource_type: Optional[str] = None,
    resource_id: Optional[str] = None,
    ip: Optional[str] = None,
    user_agent: Optional[str] = None,
    metadata: Optional[dict[str, Any]] = None,
) -> None:
    conn.execute(
        "INSERT INTO audit_log (user_id, action, resource_type, resource_id, ip, user_agent, metadata, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (
            user_id,
            action,
            resource_type,
            resource_id,
            ip,
            user_agent,
            json.dumps(metadata, ensure_ascii=False) if metadata else None,
            datetime.now(timezone.utc).isoformat(),
        ),
    )
