"""2026-07-11 BIP auth/RBAC: JWT access + refresh token 签发/校验.

设计:
- access token: 短期 (默认 1h), 走 HttpOnly cookie, stateless 验证
- refresh token: 长期 (默认 30d), 单次随机串, 存 sessions 表 (hashed), 可主动吊销
- access 跟 refresh 通过同一条 sessions row 关联, 登出 = 删 row
- JWT secret 从 .env JWT_SECRET 读, 没有则启动时生成一次性 secret 落 ~/.BODR-Image-Prompt/jwt_secret
"""
from __future__ import annotations

import hashlib
import json
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import jwt

# 2026-07-11: token 默认寿命 (主人拍: access 1h, refresh 30d)
ACCESS_TTL = timedelta(hours=1)
REFRESH_TTL = timedelta(days=30)

# secret 落地位置: 跟其他 config.json 同根
_SECRET_FALLBACK_PATH = Path.home() / ".BODR-Image-Prompt" / "jwt_secret"


def _load_secret() -> str:
    """从 .env (JWT_SECRET) 读, 没有就一次性生成并落 ~/.BODR-Image-Prompt/jwt_secret."""
    s = os.environ.get("JWT_SECRET", "").strip()
    if s:
        return s
    # 持久化一次性 secret (重启后 access token 不失效)
    if _SECRET_FALLBACK_PATH.is_file():
        return _SECRET_FALLBACK_PATH.read_text(encoding="utf-8").strip()
    _SECRET_FALLBACK_PATH.parent.mkdir(parents=True, exist_ok=True)
    new_secret = secrets.token_hex(32)
    _SECRET_FALLBACK_PATH.write_text(new_secret, encoding="utf-8")
    try:
        os.chmod(_SECRET_FALLBACK_PATH, 0o600)
    except OSError:
        pass
    return new_secret


def _now() -> datetime:
    return datetime.now(timezone.utc)


def hash_refresh_token(raw: str) -> str:
    """refresh token 只存 sha256 hash, 不存原文 (防 DB 泄漏即被劫持)."""
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def issue_token_pair(user_id: str, *, user_agent: str = "", ip: str = "") -> dict:
    """返回 {access_token, refresh_token, access_expires_at, refresh_expires_at, jti, sid}.
    refresh_token 是 32 字节随机串, 服务端只存 hash.
    """
    secret = _load_secret()
    sid = f"sid_{uuid.uuid4().hex[:24]}"
    jti = secrets.token_hex(16)
    now = _now()
    access_exp = now + ACCESS_TTL
    refresh_exp = now + REFRESH_TTL
    payload = {
        "sub": user_id,
        "sid": sid,
        "jti": jti,
        "iat": int(now.timestamp()),
        "exp": int(access_exp.timestamp()),
        "type": "access",
    }
    access = jwt.encode(payload, secret, algorithm="HS256")
    refresh = secrets.token_urlsafe(32)
    return {
        "access_token": access,
        "refresh_token": refresh,
        "access_expires_at": access_exp.isoformat(),
        "refresh_expires_at": refresh_exp.isoformat(),
        "jti": jti,
        "sid": sid,
    }


def decode_access(token: str) -> dict | None:
    """校验 access token. 失败返 None (登录态过期/被吊销)."""
    try:
        secret = _load_secret()
        payload = jwt.decode(token, secret, algorithms=["HS256"])
        if payload.get("type") != "access":
            return None
        return payload
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None


def new_request_id() -> str:
    return f"req_{uuid.uuid4().hex[:24]}"
