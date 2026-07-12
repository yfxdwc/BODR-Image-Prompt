"""2026-07-11 BIP auth/RBAC: /api/admin/* (admin only) - 用户/审批/审计管理."""
from __future__ import annotations

import json
import sqlite3
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from backend.auth.audit import write_audit
from backend.auth.deps import client_ip, require_admin
from backend.auth.service import AuthService
from backend.auth.repositories import UserRepository
from backend.db import connect
from backend.schemas import (
    ApprovalDecision,
    AuditEntry,
    AuditPage,
    RegistrationRequestPublic,
    UserCreateAdmin,
    UserPublic,
)

router = APIRouter()


def _service(request: Request) -> AuthService:
    return AuthService(request.app.state.library_path)


def _user_public(rec) -> UserPublic:
    return UserPublic(
        id=rec.id, email=rec.email, username=rec.username, role=rec.role,
        display_name=rec.display_name, created_at=rec.created_at,
        approved_at=rec.approved_at, last_login_at=rec.last_login_at,
    )


# ── 用户列表 ──────────────────────────────────────────────────────────────────
@router.get("/admin/users")
def list_users(request: Request, _admin=Depends(require_admin)):
    svc = _service(request)
    with connect(request.app.state.library_path) as conn:
        users = svc.users.list_all(conn)
    return {"items": [_user_public(u).model_dump() for u in users], "total": len(users)}


# ── 改用户角色 ────────────────────────────────────────────────────────────────
@router.patch("/admin/users/{user_id}/role")
def set_role(user_id: str, new_role: str, request: Request,
             admin=Depends(require_admin)):
    if new_role not in ("admin", "user", "pending", "rejected"):
        raise HTTPException(400, "invalid role")
    svc = _service(request)
    return svc.admin_set_role(
        target_user_id=user_id, new_role=new_role,
        reviewer_id=admin.id, ip=client_ip(request),
    )


# ── 删用户 (软删) ─────────────────────────────────────────────────────────────
@router.delete("/admin/users/{user_id}", status_code=204)
def delete_user(user_id: str, request: Request,
                admin=Depends(require_admin)):
    if user_id == admin.id:
        raise HTTPException(409, "cannot delete yourself")
    svc = _service(request)
    svc.admin_delete_user(target_user_id=user_id, reviewer_id=admin.id,
                          ip=client_ip(request))
    return None


# ── admin 直接创建用户 (不走申请流) ───────────────────────────────────────────
@router.post("/admin/users", status_code=201)
def admin_create_user(payload: UserCreateAdmin, request: Request,
                      admin=Depends(require_admin)):
    svc = _service(request)
    return svc.admin_create_user(
        email=payload.email, username=payload.username, password=payload.password,
        role=payload.role, display_name=payload.display_name,
        creator_id=admin.id, ip=client_ip(request),
    )


# ── 审批队列 ──────────────────────────────────────────────────────────────────
@router.get("/admin/requests")
def list_requests(request: Request, status_filter: Optional[str] = Query(None, alias="status"),
                  _admin=Depends(require_admin)):
    svc = _service(request)
    with connect(request.app.state.library_path) as conn:
        if status_filter == "pending":
            rows = svc.regs.list_pending(conn)
        else:
            rows = svc.regs.list_all(conn)
    items = []
    for r in rows:
        items.append(RegistrationRequestPublic(
            id=r["id"], user_id=r["user_id"], user_email=r["user_email"],
            user_username=r["user_username"], requested_at=r["requested_at"],
            reason=r["reason"], status=r["status"],
            reviewed_at=r["reviewed_at"], reviewed_by=r["reviewed_by"],
            review_note=r["review_note"],
        ).model_dump())
    return {"items": items, "total": len(items)}


@router.post("/admin/requests/{request_id}/approve")
def approve_request(request_id: str, payload: ApprovalDecision, request: Request,
                    admin=Depends(require_admin)):
    svc = _service(request)
    return svc.approve(
        request_id=request_id, reviewer_id=admin.id,
        review_note=payload.review_note, ip=client_ip(request),
    )


@router.post("/admin/requests/{request_id}/reject")
def reject_request(request_id: str, payload: ApprovalDecision, request: Request,
                   admin=Depends(require_admin)):
    svc = _service(request)
    return svc.reject(
        request_id=request_id, reviewer_id=admin.id,
        reason=payload.review_note or "", ip=client_ip(request),
    )


# ── audit log ────────────────────────────────────────────────────────────────
@router.get("/admin/audit", response_model=AuditPage)
def list_audit(request: Request, limit: int = Query(200, ge=1, le=1000),
               offset: int = Query(0, ge=0),
               action: Optional[str] = None,
               user_id: Optional[str] = None,
               _admin=Depends(require_admin)):
    with connect(request.app.state.library_path) as conn:
        where = []
        params = []
        if action:
            where.append("action = ?")
            params.append(action)
        if user_id:
            where.append("user_id = ?")
            params.append(user_id)
        where_sql = ("WHERE " + " AND ".join(where)) if where else ""
        rows = conn.execute(
            f"SELECT * FROM audit_log {where_sql} ORDER BY id DESC LIMIT ? OFFSET ?",
            (*params, limit, offset),
        ).fetchall()
        total = conn.execute(
            f"SELECT COUNT(*) AS n FROM audit_log {where_sql}", params
        ).fetchone()["n"]
        items = [
            AuditEntry(
                id=r["id"], user_id=r["user_id"], action=r["action"],
                resource_type=r["resource_type"], resource_id=r["resource_id"],
                ip=r["ip"], user_agent=r["user_agent"],
                metadata=r["metadata"], created_at=r["created_at"],
            ).model_dump()
            for r in rows
        ]
    return AuditPage(items=items, total=total)
