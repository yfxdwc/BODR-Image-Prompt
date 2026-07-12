"""2026-07-11 BIP auth/RBAC: FastAPI Depends 依赖注入.

- get_current_user: 从 cookie 读 access token, 验证, 返回 user. 失败返 None.
- require_user: 必须登录 + role in (admin, user). 401/403.
- require_admin: 必须 admin. 401/403.
- 兼容 ALLOW_ANONYMOUS_READ: 默认 False (全站强制登录). True 时 GET 路由跳过 auth.
"""
from __future__ import annotations

import os
from typing import Optional

from fastapi import Depends, HTTPException, Request

from ..db import connect
from .tokens import decode_access
from .repositories import UserRepository, UserRecord, SessionRepository


COOKIE_ACCESS = "bip_access"
COOKIE_REFRESH = "bip_refresh"


def _client_ip(request: Request) -> Optional[str]:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    if request.client:
        return request.client.host
    return None


def _user_agent(request: Request) -> Optional[str]:
    return request.headers.get("user-agent")


def get_user_repo(request: Request) -> UserRepository:
    return UserRepository(request.app.state.library_path)



def _resolve_user(request: Request, *, allow_anonymous: bool) -> Optional[UserRecord]:
    """从 cookie 拿 access token, 校验, 查 user. 任何一步失败返 None."""
    token = request.cookies.get(COOKIE_ACCESS)
    if not token:
        return None
    payload = decode_access(token)
    if not payload:
        return None
    sid = payload.get("sid")
    sub = payload.get("sub")
    if not sid or not sub:
        return None
    with connect(request.app.state.library_path) as conn:
        sess_repo = SessionRepository(request.app.state.library_path)
        sess = sess_repo.get_by_id(conn, sid)
        if not sess or sess.revoked_at:
            return None
        if sess.access_jti != payload.get("jti"):
            return None
        user_repo = UserRepository(request.app.state.library_path)
        user = user_repo.get_by_id(conn, sub)
        if not user:
            return None
        if not allow_anonymous and user.role in ("pending", "rejected"):
            return None
    return user


async def get_current_user(request: Request) -> Optional[UserRecord]:
    """返回 user 或 None (不抛). 调用方按需 raise 401."""
    return _resolve_user(request, allow_anonymous=False)


async def require_user(request: Request) -> UserRecord:
    user = await get_current_user(request)
    if user is None:
        raise HTTPException(401, "Not authenticated")
    if user.role not in ("admin", "user"):
        raise HTTPException(403, f"account {user.role}, please contact admin")
    return user


async def require_admin(request: Request) -> UserRecord:
    user = await require_user(request)
    if user.role != "admin":
        raise HTTPException(403, "Admin required")
    return user


def allow_anonymous_read() -> bool:
    """主人拍: .env ALLOW_ANONYMOUS_READ=false 是默认 (全站强制登录).
    True 时 GET 路由跳过 require_user (向后兼容, 调试用)."""
    return os.environ.get("ALLOW_ANONYMOUS_READ", "false").lower() in ("1", "true", "yes")


def client_ip(request: Request) -> Optional[str]:
    return _client_ip(request)


def client_user_agent(request: Request) -> Optional[str]:
    return _user_agent(request)
