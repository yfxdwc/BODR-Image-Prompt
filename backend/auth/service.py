"""2026-07-11 BIP auth/RBAC: 注册/登录/审批/登出 业务流. 调 repositories + 写 audit_log."""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException

from ..db import connect
from .passwords import hash_password, verify_password, needs_rehash
from .tokens import issue_token_pair, hash_refresh_token
from .repositories import (
    UserRepository,
    SessionRepository,
    RegistrationRepository,
)
from .audit import write_audit

# 简单校验: username 3-32 字符 [a-zA-Z0-9_-]; email 走 pydantic EmailStr 在 router 端校验.
_USERNAME_RE = re.compile(r"^[A-Za-z0-9_-]{3,32}$")


def validate_username(username: str) -> None:
    if not _USERNAME_RE.match(username):
        raise HTTPException(400, "username must be 3-32 chars [A-Za-z0-9_-]")


@dataclass
class AuthContext:
    user_id: str
    role: str


class AuthService:
    def __init__(self, library_path):
        self.library_path = library_path
        self.users = UserRepository(library_path)
        self.sessions = SessionRepository(library_path)
        self.regs = RegistrationRepository(library_path)

    # ── 注册 ─────────────────────────────────────────────────────────────────
    def register(
        self,
        *,
        email: str,
        username: str,
        password: str,
        reason: Optional[str],
        display_name: Optional[str],
        ip: Optional[str] = None,
        user_agent: Optional[str] = None,
    ) -> tuple[str, str]:
        """注册申请. 返回 (user_id, request_id). role='pending'. 不发 token (必须审批)."""
        validate_username(username)
        if len(password) < 8:
            raise HTTPException(400, "password must be at least 8 characters")
        pw_hash = hash_password(password)
        with connect(self.library_path) as conn:
            # 唯一性预检, 给前端友好错误
            if self.users.get_by_email(conn, email):
                raise HTTPException(409, "email already registered")
            if self.users.get_by_username(conn, username):
                raise HTTPException(409, "username already taken")
            user = self.users.create(
                conn,
                email=email,
                username=username,
                password_hash=pw_hash,
                role="pending",
                display_name=display_name or username,
            )
            req = self.regs.create(conn, user_id=user.id, reason=reason)
            write_audit(
                conn,
                user_id=user.id,
                action="register_request",
                resource_type="user",
                resource_id=user.id,
                ip=ip,
                user_agent=user_agent,
                metadata={"username": username, "email": email},
            )
            conn.commit()
        return user.id, req.id

    # ── 登录 ─────────────────────────────────────────────────────────────────
    def login(
        self,
        *,
        username_or_email: str,
        password: str,
        ip: Optional[str] = None,
        user_agent: Optional[str] = None,
    ) -> dict:
        """登录. role='pending'/'rejected' 拒绝. 返回 {access_token, refresh_token, ...}."""
        with connect(self.library_path) as conn:
            user = self.users.get_by_username(conn, username_or_email)
            if not user:
                write_audit(conn, user_id=None, action="login_failed",
                            metadata={"reason": "user_not_found", "input": username_or_email})
                conn.commit()
                raise HTTPException(401, "invalid credentials")
            if not verify_password(user.password_hash, password):
                write_audit(conn, user_id=user.id, action="login_failed",
                            metadata={"reason": "bad_password"})
                conn.commit()
                raise HTTPException(401, "invalid credentials")
            if user.role in ("pending", "rejected"):
                write_audit(conn, user_id=user.id, action="login_blocked",
                            metadata={"role": user.role})
                conn.commit()
                raise HTTPException(403, f"account {user.role}, please contact admin")
            # rehash 升级
            if needs_rehash(user.password_hash):
                self.users.update_password_hash(conn, user.id, hash_password(password))
            tokens = issue_token_pair(user.id, user_agent=user_agent or "", ip=ip or "")
            self.sessions.create(
                conn,
                sid=tokens["sid"],
                user_id=user.id,
                jti=tokens["jti"],
                refresh_hash=hash_refresh_token(tokens["refresh_token"]),
                user_agent=user_agent,
                ip=ip,
                access_expires_at=tokens["access_expires_at"],
                refresh_expires_at=tokens["refresh_expires_at"],
            )
            self.users.touch_last_login(conn, user.id)
            write_audit(conn, user_id=user.id, action="login", ip=ip, user_agent=user_agent,
                        metadata={"sid": tokens["sid"]})
            conn.commit()
            tokens["user"] = {
                "id": user.id,
                "email": user.email,
                "username": user.username,
                "role": user.role,
                "display_name": user.display_name,
                "created_at": user.created_at,
                "approved_at": user.approved_at,
                "last_login_at": datetime.now(timezone.utc).isoformat(),
            }
            return tokens

    # ── 刷新 ─────────────────────────────────────────────────────────────────
    def refresh(self, *, refresh_token: str, ip: Optional[str] = None,
                user_agent: Optional[str] = None) -> dict:
        h = hash_refresh_token(refresh_token)
        with connect(self.library_path) as conn:
            sess = self.sessions.get_by_refresh_hash(conn, h)
            if not sess:
                raise HTTPException(401, "invalid refresh token")
            # 检查 refresh 过期
            if sess.refresh_expires_at < datetime.now(timezone.utc).isoformat():
                raise HTTPException(401, "refresh expired")
            user = self.users.get_by_id(conn, sess.user_id)
            if not user or user.role in ("pending", "rejected"):
                raise HTTPException(403, "account not active")
            # rotate: 旧 sid 吊销, 发新 pair
            self.sessions.revoke(conn, sess.id)
            tokens = issue_token_pair(user.id, user_agent=user_agent or "", ip=ip or "")
            self.sessions.create(
                conn,
                sid=tokens["sid"],
                user_id=user.id,
                jti=tokens["jti"],
                refresh_hash=hash_refresh_token(tokens["refresh_token"]),
                user_agent=user_agent,
                ip=ip,
                access_expires_at=tokens["access_expires_at"],
                refresh_expires_at=tokens["refresh_expires_at"],
            )
            write_audit(conn, user_id=user.id, action="token_refresh",
                        resource_type="session", resource_id=tokens["sid"], ip=ip)
            conn.commit()
            tokens["user"] = {
                "id": user.id, "email": user.email, "username": user.username,
                "role": user.role, "display_name": user.display_name,
                "created_at": user.created_at, "approved_at": user.approved_at,
                "last_login_at": user.last_login_at,
            }
            return tokens

    # ── 登出 ─────────────────────────────────────────────────────────────────
    def logout(self, *, sid: str, user_id: str, ip: Optional[str] = None) -> None:
        with connect(self.library_path) as conn:
            self.sessions.revoke(conn, sid)
            write_audit(conn, user_id=user_id, action="logout",
                        resource_type="session", resource_id=sid, ip=ip)
            conn.commit()

    # ── 审批 ─────────────────────────────────────────────────────────────────
    def approve(self, *, request_id: str, reviewer_id: str, review_note: Optional[str] = None,
                ip: Optional[str] = None) -> dict:
        with connect(self.library_path) as conn:
            req = self.regs.get_by_id(conn, request_id)
            if not req:
                raise HTTPException(404, "request not found")
            if req.status != "pending":
                raise HTTPException(409, f"request already {req.status}")
            self.regs.decide(conn, request_id, status="approved",
                             reviewer_id=reviewer_id, review_note=review_note)
            self.users.set_role(conn, req.user_id, new_role="user", approved_by=reviewer_id)
            user = self.users.get_by_id(conn, req.user_id)
            write_audit(conn, user_id=reviewer_id, action="approve_user",
                        resource_type="user", resource_id=req.user_id, ip=ip,
                        metadata={"request_id": request_id, "note": review_note})
            conn.commit()
            return {
                "user_id": user.id, "email": user.email, "username": user.username,
                "role": user.role, "request_id": request_id,
            }

    def reject(self, *, request_id: str, reviewer_id: str, reason: str,
               ip: Optional[str] = None) -> dict:
        if not reason or len(reason.strip()) < 3:
            raise HTTPException(400, "rejection reason required (min 3 chars)")
        with connect(self.library_path) as conn:
            req = self.regs.get_by_id(conn, request_id)
            if not req:
                raise HTTPException(404, "request not found")
            if req.status != "pending":
                raise HTTPException(409, f"request already {req.status}")
            self.regs.decide(conn, request_id, status="rejected",
                             reviewer_id=reviewer_id, review_note=reason)
            self.users.set_role(conn, req.user_id, new_role="rejected", rejected_reason=reason)
            write_audit(conn, user_id=reviewer_id, action="reject_user",
                        resource_type="user", resource_id=req.user_id, ip=ip,
                        metadata={"request_id": request_id, "reason": reason})
            conn.commit()
            return {"user_id": req.user_id, "request_id": request_id, "reason": reason}

    # ── admin: 直接创建用户 ───────────────────────────────────────────────────
    def admin_create_user(
        self,
        *,
        email: str,
        username: str,
        password: str,
        role: str,
        display_name: Optional[str] = None,
        creator_id: str,
        ip: Optional[str] = None,
    ) -> dict:
        if role not in ("admin", "user"):
            raise HTTPException(400, "role must be admin or user")
        validate_username(username)
        if len(password) < 8:
            raise HTTPException(400, "password must be at least 8 characters")
        pw_hash = hash_password(password)
        with connect(self.library_path) as conn:
            if self.users.get_by_email(conn, email):
                raise HTTPException(409, "email already registered")
            if self.users.get_by_username(conn, username):
                raise HTTPException(409, "username already taken")
            user = self.users.create(
                conn, email=email, username=username, password_hash=pw_hash,
                role=role, display_name=display_name or username,
            )
            write_audit(conn, user_id=creator_id, action="admin_create_user",
                        resource_type="user", resource_id=user.id, ip=ip,
                        metadata={"role": role, "username": username})
            conn.commit()
            return {"id": user.id, "email": user.email, "username": user.username,
                    "role": user.role, "display_name": user.display_name}

    # ── admin: 改用户角色 ─────────────────────────────────────────────────────
    def admin_set_role(self, *, target_user_id: str, new_role: str, reviewer_id: str,
                       ip: Optional[str] = None) -> dict:
        if new_role not in ("admin", "user", "pending", "rejected"):
            raise HTTPException(400, "invalid role")
        with connect(self.library_path) as conn:
            target = self.users.get_by_id(conn, target_user_id)
            if not target:
                raise HTTPException(404, "user not found")
            # 防止最后一个 admin 被降级
            if target.role == "admin" and new_role != "admin":
                if self.users.count_admins(conn) <= 1:
                    raise HTTPException(409, "cannot demote the last admin")
            self.users.set_role(conn, target_user_id, new_role=new_role, approved_by=reviewer_id)
            write_audit(conn, user_id=reviewer_id, action="admin_set_role",
                        resource_type="user", resource_id=target_user_id, ip=ip,
                        metadata={"old_role": target.role, "new_role": new_role})
            conn.commit()
            return {"id": target_user_id, "old_role": target.role, "new_role": new_role}

    # ── admin: 删用户 (软删: role=rejected + 清 email/username) ──────────────
    def admin_delete_user(self, *, target_user_id: str, reviewer_id: str,
                          ip: Optional[str] = None) -> dict:
        with connect(self.library_path) as conn:
            target = self.users.get_by_id(conn, target_user_id)
            if not target:
                raise HTTPException(404, "user not found")
            if target.role == "admin" and self.users.count_admins(conn) <= 1:
                raise HTTPException(409, "cannot delete the last admin")
            # 吊销该用户所有 session
            self.sessions.revoke_all_for_user(conn, target_user_id)
            # 标记 rejected + 清 username/email (允许同名复用), 保留 id 以审计
            now = datetime.now(timezone.utc).isoformat()
            conn.execute(
                "UPDATE users SET role='rejected', rejected_at=?, rejected_reason='deleted by admin', "
                "username='deleted_'||substr(id,5,12), email='deleted_'||substr(id,5,12)||'@deleted.local', "
                "password_hash='!' WHERE id=?",
                (now, target_user_id),
            )
            write_audit(conn, user_id=reviewer_id, action="admin_delete_user",
                        resource_type="user", resource_id=target_user_id, ip=ip,
                        metadata={"original_username": target.username, "original_email": target.email})
            conn.commit()
            return {"id": target_user_id}

    # ── 清理过期 session ──────────────────────────────────────────────────────
    def cleanup_sessions(self) -> int:
        with connect(self.library_path) as conn:
            n = self.sessions.cleanup_expired(conn)
            conn.commit()
            return n
