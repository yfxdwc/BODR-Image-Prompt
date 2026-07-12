"""2026-07-11 BIP auth/RBAC: 首次启动检测无 admin 时, 从 .env INITIAL_ADMIN_* 创建第一个 admin.

只创建一次. 已有 admin 则跳过 (即使 env 改了). 防覆盖.
"""
from __future__ import annotations

import os
from pathlib import Path

from ..db import connect
from .passwords import hash_password
from .repositories import UserRepository
from .audit import write_audit


def bootstrap_initial_admin(library_path: Path | str) -> bool:
    """返回 True 表示创建了新 admin; False 表示已有 admin 跳过."""
    library = Path(library_path)
    email = os.environ.get("INITIAL_ADMIN_EMAIL", "").strip()
    username = os.environ.get("INITIAL_ADMIN_USERNAME", "").strip()
    password = os.environ.get("INITIAL_ADMIN_PASSWORD", "")
    display = os.environ.get("INITIAL_ADMIN_DISPLAY_NAME", "").strip() or username or "Admin"

    with connect(library) as conn:
        users = UserRepository(library)
        admin_count = users.count_admins(conn)
        if admin_count > 0:
            return False
        if not email or not username or not password:
            print("[ipl] auth: no admin exists; set INITIAL_ADMIN_EMAIL/USERNAME/PASSWORD env to bootstrap", flush=True)
            return False
        if len(password) < 8:
            print("[ipl] auth: INITIAL_ADMIN_PASSWORD must be >= 8 chars, skipped", flush=True)
            return False
        pw_hash = hash_password(password)
        user = users.create(
            conn, email=email, username=username, password_hash=pw_hash,
            role="admin", display_name=display,
        )
        write_audit(
            conn, user_id=user.id, action="bootstrap_initial_admin",
            resource_type="user", resource_id=user.id,
            metadata={"username": username, "source": "INITIAL_ADMIN_* env"},
        )
        conn.commit()
        print(f"[ipl] auth: bootstrapped initial admin '{username}' ({email}) — change password after first login", flush=True)
        return True
