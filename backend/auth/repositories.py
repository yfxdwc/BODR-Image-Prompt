"""2026-07-11 BIP auth/RBAC: UserRepository / SessionRepository / RegistrationRepository.

完全复用现有 repositories.py 模式 (构造函数接 library_path, 内部调 connect(library)).
"""
from __future__ import annotations

import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from ..db import connect


@dataclass
class UserRecord:
    id: str
    email: str
    username: str
    password_hash: str
    role: str
    display_name: Optional[str]
    created_at: str
    approved_at: Optional[str]
    approved_by: Optional[str]
    rejected_at: Optional[str]
    rejected_reason: Optional[str]
    last_login_at: Optional[str]


def _row_to_user(row: sqlite3.Row) -> UserRecord:
    return UserRecord(
        id=row["id"],
        email=row["email"],
        username=row["username"],
        password_hash=row["password_hash"],
        role=row["role"],
        display_name=row["display_name"],
        created_at=row["created_at"],
        approved_at=row["approved_at"],
        approved_by=row["approved_by"],
        rejected_at=row["rejected_at"],
        rejected_reason=row["rejected_reason"],
        last_login_at=row["last_login_at"],
    )


class UserRepository:
    def __init__(self, library_path: Path | str):
        self.library_path = Path(library_path)

    # ── create ────────────────────────────────────────────────────────────────
    def create(
        self,
        conn: sqlite3.Connection,
        *,
        email: str,
        username: str,
        password_hash: str,
        role: str,
        display_name: Optional[str] = None,
    ) -> UserRecord:
        user_id = f"usr_{uuid.uuid4().hex[:24]}"
        now = datetime.now(timezone.utc).isoformat()
        approved_at = now if role in ("admin", "user") else None
        approved_by = None
        conn.execute(
            "INSERT INTO users (id, email, username, password_hash, role, display_name, created_at, approved_at, approved_by) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (user_id, email, username, password_hash, role, display_name, now, approved_at, approved_by),
        )
        return UserRecord(
            id=user_id,
            email=email,
            username=username,
            password_hash=password_hash,
            role=role,
            display_name=display_name,
            created_at=now,
            approved_at=approved_at,
            approved_by=None,
            rejected_at=None,
            rejected_reason=None,
            last_login_at=None,
        )

    def count(self, conn: sqlite3.Connection) -> int:
        row = conn.execute("SELECT COUNT(*) AS n FROM users").fetchone()
        return row["n"]

    def count_admins(self, conn: sqlite3.Connection) -> int:
        row = conn.execute("SELECT COUNT(*) AS n FROM users WHERE role='admin'").fetchone()
        return row["n"]

    # ── lookups ───────────────────────────────────────────────────────────────
    def get_by_id(self, conn: sqlite3.Connection, user_id: str) -> Optional[UserRecord]:
        row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        return _row_to_user(row) if row else None

    def get_by_username(self, conn: sqlite3.Connection, username_or_email: str) -> Optional[UserRecord]:
        row = conn.execute(
            "SELECT * FROM users WHERE username=? OR email=?",
            (username_or_email, username_or_email),
        ).fetchone()
        return _row_to_user(row) if row else None

    def get_by_email(self, conn: sqlite3.Connection, email: str) -> Optional[UserRecord]:
        row = conn.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
        return _row_to_user(row) if row else None

    def list_all(self, conn: sqlite3.Connection) -> list[UserRecord]:
        rows = conn.execute("SELECT * FROM users ORDER BY created_at DESC").fetchall()
        return [_row_to_user(r) for r in rows]

    # ── mutations ─────────────────────────────────────────────────────────────
    def update_password_hash(self, conn: sqlite3.Connection, user_id: str, new_hash: str) -> None:
        conn.execute("UPDATE users SET password_hash=? WHERE id=?", (new_hash, user_id))

    def touch_last_login(self, conn: sqlite3.Connection, user_id: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        conn.execute("UPDATE users SET last_login_at=? WHERE id=?", (now, user_id))

    def set_role(
        self,
        conn: sqlite3.Connection,
        user_id: str,
        *,
        new_role: str,
        approved_by: Optional[str] = None,
        rejected_reason: Optional[str] = None,
    ) -> None:
        now = datetime.now(timezone.utc).isoformat()
        if new_role == "user":
            conn.execute(
                "UPDATE users SET role=?, approved_at=?, approved_by=?, rejected_at=NULL, rejected_reason=NULL WHERE id=?",
                (new_role, now, approved_by, user_id),
            )
        elif new_role == "rejected":
            conn.execute(
                "UPDATE users SET role=?, rejected_at=?, rejected_reason=?, approved_at=NULL, approved_by=NULL WHERE id=?",
                (new_role, now, rejected_reason, user_id),
            )
        else:
            conn.execute("UPDATE users SET role=? WHERE id=?", (new_role, user_id))


@dataclass
class SessionRecord:
    id: str
    user_id: str
    access_jti: str
    refresh_token_hash: str
    user_agent: Optional[str]
    ip: Optional[str]
    created_at: str
    expires_at: str
    refresh_expires_at: str
    revoked_at: Optional[str]


def _row_to_session(row: sqlite3.Row) -> SessionRecord:
    return SessionRecord(
        id=row["id"],
        user_id=row["user_id"],
        access_jti=row["access_jti"],
        refresh_token_hash=row["refresh_token_hash"],
        user_agent=row["user_agent"],
        ip=row["ip"],
        created_at=row["created_at"],
        expires_at=row["expires_at"],
        refresh_expires_at=row["refresh_expires_at"],
        revoked_at=row["revoked_at"],
    )


class SessionRepository:
    def __init__(self, library_path: Path | str):
        self.library_path = Path(library_path)

    def create(
        self,
        conn: sqlite3.Connection,
        *,
        sid: str,
        user_id: str,
        jti: str,
        refresh_hash: str,
        user_agent: Optional[str],
        ip: Optional[str],
        access_expires_at: str,
        refresh_expires_at: str,
    ) -> None:
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "INSERT INTO sessions (id, user_id, access_jti, refresh_token_hash, user_agent, ip, created_at, expires_at, refresh_expires_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (sid, user_id, jti, refresh_hash, user_agent, ip, now, access_expires_at, refresh_expires_at),
        )

    def get_by_id(self, conn: sqlite3.Connection, sid: str) -> Optional[SessionRecord]:
        row = conn.execute("SELECT * FROM sessions WHERE id=?", (sid,)).fetchone()
        return _row_to_session(row) if row else None

    def get_by_refresh_hash(self, conn: sqlite3.Connection, refresh_hash: str) -> Optional[SessionRecord]:
        row = conn.execute(
            "SELECT * FROM sessions WHERE refresh_token_hash=? AND revoked_at IS NULL",
            (refresh_hash,),
        ).fetchone()
        return _row_to_session(row) if row else None

    def revoke(self, conn: sqlite3.Connection, sid: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        conn.execute("UPDATE sessions SET revoked_at=? WHERE id=?", (now, sid))

    def revoke_all_for_user(self, conn: sqlite3.Connection, user_id: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL",
            (now, user_id),
        )

    def cleanup_expired(self, conn: sqlite3.Connection) -> int:
        cur = conn.execute(
            "DELETE FROM sessions WHERE refresh_expires_at < datetime('now')"
        )
        return cur.rowcount


@dataclass
class RegistrationRequestRecord:
    id: str
    user_id: str
    requested_at: str
    reason: Optional[str]
    status: str
    reviewed_at: Optional[str]
    reviewed_by: Optional[str]
    review_note: Optional[str]


def _row_to_regreq(row: sqlite3.Row) -> RegistrationRequestRecord:
    return RegistrationRequestRecord(
        id=row["id"],
        user_id=row["user_id"],
        requested_at=row["requested_at"],
        reason=row["reason"],
        status=row["status"],
        reviewed_at=row["reviewed_at"],
        reviewed_by=row["reviewed_by"],
        review_note=row["review_note"],
    )


class RegistrationRepository:
    def __init__(self, library_path: Path | str):
        self.library_path = Path(library_path)

    def create(
        self,
        conn: sqlite3.Connection,
        *,
        user_id: str,
        reason: Optional[str],
    ) -> RegistrationRequestRecord:
        rid = f"req_{uuid.uuid4().hex[:24]}"
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "INSERT INTO registration_requests (id, user_id, requested_at, reason, status) "
            "VALUES (?, ?, ?, ?, 'pending')",
            (rid, user_id, now, reason),
        )
        return RegistrationRequestRecord(
            id=rid,
            user_id=user_id,
            requested_at=now,
            reason=reason,
            status="pending",
            reviewed_at=None,
            reviewed_by=None,
            review_note=None,
        )

    def get_by_user_id(self, conn: sqlite3.Connection, user_id: str) -> Optional[RegistrationRequestRecord]:
        row = conn.execute(
            "SELECT * FROM registration_requests WHERE user_id=? ORDER BY requested_at DESC LIMIT 1",
            (user_id,),
        ).fetchone()
        return _row_to_regreq(row) if row else None

    def list_pending(self, conn: sqlite3.Connection) -> list[dict]:
        rows = conn.execute(
            "SELECT r.*, u.email AS user_email, u.username AS user_username "
            "FROM registration_requests r JOIN users u ON u.id = r.user_id "
            "WHERE r.status='pending' ORDER BY r.requested_at ASC"
        ).fetchall()
        return [dict(r) for r in rows]

    def list_all(self, conn: sqlite3.Connection) -> list[dict]:
        rows = conn.execute(
            "SELECT r.*, u.email AS user_email, u.username AS user_username "
            "FROM registration_requests r JOIN users u ON u.id = r.user_id "
            "ORDER BY r.requested_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]

    def get_by_id(self, conn: sqlite3.Connection, rid: str) -> Optional[RegistrationRequestRecord]:
        row = conn.execute("SELECT * FROM registration_requests WHERE id=?", (rid,)).fetchone()
        return _row_to_regreq(row) if row else None

    def decide(
        self,
        conn: sqlite3.Connection,
        rid: str,
        *,
        status: str,
        reviewer_id: str,
        review_note: Optional[str],
    ) -> None:
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "UPDATE registration_requests SET status=?, reviewed_at=?, reviewed_by=?, review_note=? WHERE id=?",
            (status, now, reviewer_id, review_note, rid),
        )
