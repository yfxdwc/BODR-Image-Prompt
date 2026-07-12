"""2026-07-11 BIP auth/RBAC: argon2id 密码 hash/verify (OWASP 推荐)."""
from __future__ import annotations

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, InvalidHashError, VerificationError

# 默认参数跟 argon2-cffi 默认一致 (time_cost=3, memory_cost=64MB, parallelism=4)
# 对个人图库足够; 真要调高走环境变量
_hasher = PasswordHasher()


def hash_password(plain: str) -> str:
    """返回 argon2id 编码字符串, 形如 $argon2id$v=19$m=65536,t=3,p=4$... ."""
    if not plain or len(plain) < 8:
        raise ValueError("password must be at least 8 characters")
    return _hasher.hash(plain)


def verify_password(stored_hash: str, plain: str) -> bool:
    """校验密码. False 不抛 (登录场景). 校验成功时若 hash 需要 rehash 返回 True+stored_hash."""
    try:
        _hasher.verify(stored_hash, plain)
        return True
    except (VerifyMismatchError, InvalidHashError, VerificationError):
        return False


def needs_rehash(stored_hash: str) -> bool:
    """检查参数是否过期 (登录后顺手升级)."""
    try:
        return _hasher.check_needs_rehash(stored_hash)
    except (InvalidHashError, VerificationError):
        return False
