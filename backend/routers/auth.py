"""2026-07-11 BIP auth/RBAC: /api/auth/* 公开端点 (login/register/refresh/logout/me).

Cookie 策略: HttpOnly + SameSite=Lax (allow form GET 导航, 防 CSRF);
Secure flag 由 main.py 部署模式决定 (生产 https 开, 本地 http 关).
"""
from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import EmailStr

from backend.auth.deps import (
    COOKIE_ACCESS,
    COOKIE_REFRESH,
    client_ip,
    client_user_agent,
    get_current_user,
    require_user,
)
from backend.auth.service import AuthService
from backend.auth.tokens import decode_access
from backend.schemas import LoginIn, RefreshIn, RegisterIn, TokenPair, UserPublic

router = APIRouter()


def _service(request: Request) -> AuthService:
    return AuthService(request.app.state.library_path)


def _cookie_secure() -> bool:
    # 主人拍: 默认 https 走 secure flag; 本地开发 (BACKEND_HOST=127.0.0.1) 关掉 secure 方便测试.
    if os.environ.get("AUTH_COOKIE_SECURE", "auto").lower() == "true":
        return True
    if os.environ.get("AUTH_COOKIE_SECURE", "auto").lower() == "false":
        return False
    # auto: 走 BACKEND_HOST 推断
    host = os.environ.get("BACKEND_HOST", "127.0.0.1")
    return host not in ("127.0.0.1", "localhost")


def _set_auth_cookies(response: Response, tokens: dict) -> None:
    secure = _cookie_secure()
    common = {
        "httponly": True,
        "samesite": "lax",
        "secure": secure,
        "path": "/",
    }
    # access: 跟 token 自身 expires_at 对齐
    response.set_cookie(
        COOKIE_ACCESS, tokens["access_token"],
        max_age=60 * 60,  # 1h
        expires=tokens["access_expires_at"],
        **common,
    )
    # 2026-07-14 主人拍: refresh cookie 30d 持久. max_age + expires 都设, 浏览器重启仍保留.
    # access cookie 仍 1h 短期; 前端会在它快过期/失效时调 /auth/refresh 续期.
    response.set_cookie(
        COOKIE_REFRESH, tokens["refresh_token"],
        max_age=60 * 60 * 24 * 30,
        expires=tokens["refresh_expires_at"],
        **common,
    )


def _clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(COOKIE_ACCESS, path="/")
    response.delete_cookie(COOKIE_REFRESH, path="/")


# ── 注册申请 ──────────────────────────────────────────────────────────────────
@router.post("/auth/register", status_code=201)
def register(
    payload: RegisterIn,
    request: Request,
    ip: str = Depends(client_ip),
    ua: Optional[str] = Depends(client_user_agent),
):
    svc = _service(request)
    user_id, req_id = svc.register(
        email=payload.email, username=payload.username, password=payload.password,
        reason=payload.reason, display_name=payload.display_name,
        ip=ip, user_agent=ua,
    )
    return {"user_id": user_id, "request_id": req_id, "status": "pending"}


# ── 登录 ──────────────────────────────────────────────────────────────────────
@router.post("/auth/login", response_model=TokenPair)
def login(
    payload: LoginIn,
    request: Request,
    response: Response,
    ip: str = Depends(client_ip),
    ua: Optional[str] = Depends(client_user_agent),
):
    svc = _service(request)
    tokens = svc.login(
        username_or_email=payload.username, password=payload.password,
        ip=ip, user_agent=ua,
    )
    _set_auth_cookies(response, tokens)
    return tokens


# ── 刷新 ──────────────────────────────────────────────────────────────────────
@router.post("/auth/refresh", response_model=TokenPair)
def refresh(
    payload: RefreshIn,
    request: Request,
    response: Response,
    ip: str = Depends(client_ip),
    ua: Optional[str] = Depends(client_user_agent),
):
    """2026-07-14 主人拍: 长期登录.

    优先用 body 里的 refresh_token; 没有则从 cookie 拿, 实现"重启浏览器/电脑仍保持登录".
    """
    svc = _service(request)
    raw = (payload.refresh_token or "").strip() or request.cookies.get(COOKIE_REFRESH, "")
    if not raw:
        raise HTTPException(401, "Missing refresh token")
    tokens = svc.refresh(refresh_token=raw, ip=ip, user_agent=ua)
    _set_auth_cookies(response, tokens)
    return tokens


# ── 登出 ──────────────────────────────────────────────────────────────────────
@router.post("/auth/logout", status_code=204)
def logout(request: Request, response: Response):
    user = None
    try:
        from backend.auth.deps import get_current_user
        # 同步读 cookie + 解码 (取 sid)
        token = request.cookies.get(COOKIE_ACCESS)
        if token:
            payload = decode_access(token)
            if payload:
                user_id = payload.get("sub")
                sid = payload.get("sid")
                if user_id and sid:
                    svc = _service(request)
                    svc.logout(sid=sid, user_id=user_id, ip=client_ip(request))
    except Exception:
        pass
    _clear_auth_cookies(response)
    return Response(status_code=204)


# ── 当前用户 ──────────────────────────────────────────────────────────────────
@router.get("/auth/me", response_model=Optional[UserPublic])
def me(request: Request):
    from backend.auth.deps import _resolve_user
    user = _resolve_user(request, allow_anonymous=False)
    if not user:
        raise HTTPException(401, "Not authenticated")
    return UserPublic(
        id=user.id, email=user.email, username=user.username, role=user.role,
        display_name=user.display_name, created_at=user.created_at,
        approved_at=user.approved_at, last_login_at=user.last_login_at,
        # 2026-07-14 主人拍: 锁定信息透出
        note_name=getattr(user, "note_name", None),
        is_locked=bool(getattr(user, "is_locked", 0)),
        locked_reason=getattr(user, "locked_reason", None),
    )
