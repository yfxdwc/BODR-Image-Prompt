from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from backend.auth.deps import require_admin, require_user

from backend.repositories import ItemRepository
from backend.schemas import ItemCreate, ItemDetail, ItemList, ItemUpdate
from ._item_multipart import (
    apply_cover_index_for_new,
    build_item_create_from_request,
    build_item_update_from_request,
)

router = APIRouter()


def repo(request: Request) -> ItemRepository:
    return ItemRepository(request.app.state.library_path)


def not_found(exc: KeyError):
    raise HTTPException(404, "Item not found") from exc


@router.get("/items", dependencies=[Depends(require_user)], response_model=ItemList)
def list_items(request: Request, q: str | None = None, cluster: str | None = None, tag: str | None = None, favorite: bool | None = None, archived: bool = False, sort: str = "updated_desc", limit: int = 100, offset: int = 0):
    return repo(request).list_items(q=q, cluster=cluster, tag=tag, favorite=favorite, archived=archived, sort=sort, limit=min(limit, 1000), offset=offset)


@router.post("/items", dependencies=[Depends(require_admin)], response_model=ItemDetail)
async def create_item(request: Request):
    """支持 multipart/form-data (新) 与 application/json (向后兼容).
    multipart 字段: title/model/.../tags/prompts (JSON 字符串) + result_files[] + reference_files[]."""
    payload, added_inputs = await build_item_create_from_request(request)
    repository = repo(request)
    try:
        item = repository.create_item(payload)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if added_inputs:
        try:
            added = repository.append_images(item.id, added_inputs)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        if payload.cover_index:
            apply_cover_index_for_new(repository, item.id, added, payload.cover_index)
        return repository.get_item(item.id)
    return item


@router.get("/items/{item_id}", dependencies=[Depends(require_user)], response_model=ItemDetail)
def get_item(request: Request, item_id: str):
    try:
        return repo(request).get_item(item_id)
    except KeyError as exc:
        not_found(exc)


@router.patch("/items/{item_id}", dependencies=[Depends(require_admin)], response_model=ItemDetail)
async def update_item(request: Request, item_id: str):
    """支持 multipart/form-data (新) 与 application/json (向后兼容).
    multipart 含 result_files[]/reference_files[] 时, 追加 (不替换) 已有图片."""
    payload, added_inputs = await build_item_update_from_request(request)
    repository = repo(request)
    try:
        item = repository.update_item(item_id, payload)
    except KeyError as exc:
        not_found(exc)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if added_inputs:
        try:
            repository.append_images(item_id, added_inputs)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
    if payload.cover_index is not None:
        repository.rotate_result_images_by_cover_index(item_id, payload.cover_index)
    return repository.get_item(item_id)


@router.delete("/items/{item_id}", dependencies=[Depends(require_admin)], response_model=ItemDetail)
def delete_item(request: Request, item_id: str):
    try:
        return repo(request).delete_item(item_id)
    except KeyError as exc:
        not_found(exc)


@router.post("/items/{item_id}/favorite", dependencies=[Depends(require_user)], response_model=ItemDetail)
def favorite_item(request: Request, item_id: str):
    try:
        return repo(request).toggle_favorite(item_id)
    except KeyError as exc:
        not_found(exc)


# ── Multi-image editor endpoints (2026-06-20) ──────────────────────────────
@router.delete("/items/{item_id}/images/{image_id}", dependencies=[Depends(require_admin)], response_model=ItemDetail)
def delete_item_image(request: Request, item_id: str, image_id: str):
    """删除单张 item 图片. item 不存在或 image 不属于该 item 返 404."""
    repository = repo(request)
    try:
        repository.get_item(item_id)
    except KeyError as exc:
        not_found(exc)
    try:
        removed = repository.remove_image(item_id, image_id)
    except KeyError as exc:
        raise HTTPException(404, f"Image {image_id} not found on item {item_id}") from exc
    candidate_paths = {p for p in (removed.original_path, removed.thumb_path, removed.preview_path) if p}
    if candidate_paths:
        from backend.db import connect
        with connect(repository.library_path) as conn:
            still_used: set[str] = set()
            for rel_path in candidate_paths:
                row = conn.execute(
                    "SELECT 1 FROM images WHERE original_path=? OR thumb_path=? OR preview_path=? LIMIT 1",
                    (rel_path, rel_path, rel_path),
                ).fetchone()
                if row is not None:
                    still_used.add(rel_path)
        repository._remove_unreferenced_media_files(candidate_paths - still_used)
    return repository.get_item(item_id)


@router.post("/items/{item_id}/images/{image_id}/cover", dependencies=[Depends(require_admin)], response_model=ItemDetail)
def set_item_image_cover(request: Request, item_id: str, image_id: str):
    """把指定 result_image 设为封面: 重排 sort_order 让它排第一."""
    repository = repo(request)
    try:
        repository.get_item(item_id)
    except KeyError as exc:
        not_found(exc)
    try:
        repository.set_result_image_cover(item_id, image_id)
    except KeyError as exc:
        raise HTTPException(404, f"Image {image_id} not found on item {item_id}") from exc
    return repository.get_item(item_id)
