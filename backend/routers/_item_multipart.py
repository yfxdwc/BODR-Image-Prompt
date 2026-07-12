"""Helpers for parsing BODR Image Prompt item create/update requests that can come as
JSON (legacy) or multipart/form-data (new multi-image editor)."""
from __future__ import annotations
import json
from typing import Any

from fastapi import HTTPException, Request, UploadFile, status
from PIL import UnidentifiedImageError

from backend.repositories import ItemRepository, StoredImageInput
from backend.schemas import ItemCreate, ItemUpdate
from backend.services.image_store import store_image


MULTIPART_MAX_BYTES = 30 * 1024 * 1024  # 30MB per file
MULTIPART_MAX_TOTAL_FILES = 20          # result + reference 兜底 (实际由 schema 限制)


def _is_multipart(request: Request) -> bool:
    ctype = (request.headers.get("content-type") or "").lower()
    return ctype.startswith("multipart/form-data")


async def _read_upload(upload: UploadFile) -> bytes:
    data = await upload.read(MULTIPART_MAX_BYTES + 1)
    if len(data) > MULTIPART_MAX_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Image upload too large")
    return data


def _payload_from_form(form: dict[str, str]) -> dict[str, Any]:
    """把 multipart 字段 (title/model/.../tags/prompts JSON 字符串) 拼成 dict,
    与 JSON 请求体保持一致的结构 (供 ItemCreate/ItemUpdate model_validate)."""
    out: dict[str, Any] = {}
    for key, value in form.items():
        if value is None or value == "":
            continue
        if key in {"tags", "prompts"}:
            try:
                out[key] = json.loads(value)
            except json.JSONDecodeError as exc:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    f"{key} must be a JSON-encoded string",
                ) from exc
        elif key in {"rating", "cover_index"}:
            try:
                out[key] = int(value)
            except ValueError as exc:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    f"{key} must be an integer",
                ) from exc
        elif key in {"favorite", "archived"}:
            out[key] = value in {"true", "1", "yes", "on"}
        else:
            out[key] = value
    return out


async def _store_files(
    request: Request,
    files: list[UploadFile],
    role: str,
) -> list[StoredImageInput]:
    stored: list[StoredImageInput] = []
    for upload in files:
        data = await _read_upload(upload)
        try:
            s = store_image(request.app.state.library_path, data, upload.filename or "image.png")
        except (ValueError, UnidentifiedImageError) as exc:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"invalid image: {exc}",
            ) from exc
        stored.append(StoredImageInput(
            original_path=s.original_path,
            thumb_path=s.thumb_path,
            preview_path=s.preview_path,
            width=s.width,
            height=s.height,
            file_sha256=s.file_sha256,
            role=role,
        ))
    return stored


async def build_item_create_from_request(
    request: Request,
    result_files_attr: str = "result_files",
    reference_files_attr: str = "reference_files",
) -> tuple[ItemCreate, list[StoredImageInput]]:
    """读取 POST 请求, 返回 (ItemCreate payload, 准备追加的 StoredImageInput 列表).
    同时支持 application/json 与 multipart/form-data.
    """
    if _is_multipart(request):
        form = await request.form()
        # 多值字段: 合并 files (包含 result_files + reference_files)
        result_uploads: list[UploadFile] = []
        reference_uploads: list[UploadFile] = []
        result_uploads.extend([f for f in form.getlist(result_files_attr) if hasattr(f, "read")])
        reference_uploads.extend([f for f in form.getlist(reference_files_attr) if hasattr(f, "read")])
        # 兜底: 若用通用 'files' 字段名上传且无 result_files, 则按 result 处理
        if not result_uploads and not reference_uploads:
            for f in form.getlist("files"):
                if hasattr(f, "read"):
                    result_uploads.append(f)  # type: ignore[arg-type]
        if len(result_uploads) + len(reference_uploads) > MULTIPART_MAX_TOTAL_FILES:
            raise HTTPException(422, f"too many files (max {MULTIPART_MAX_TOTAL_FILES})")
        form_dict: dict[str, str] = {}
        for key in form.keys():
            values = form.getlist(key)
            if not values:
                continue
            if hasattr(values[0], "read"):
                continue  # skip file fields
            form_dict[key] = str(values[-1])
        payload_dict = _payload_from_form(form_dict)
        try:
            payload = ItemCreate.model_validate(payload_dict)
        except Exception as exc:
            raise HTTPException(422, f"invalid payload: {exc}") from exc
        result_stored = await _store_files(request, result_uploads, "result_image")
        reference_stored = await _store_files(request, reference_uploads, "reference_image")
        # 顺序: result 先, reference 后. cover_index 按 result 列表算.
        return payload, result_stored + reference_stored
    # JSON 路径
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(400, f"invalid JSON body: {exc}") from exc
    if not isinstance(body, dict):
        raise HTTPException(422, "request body must be a JSON object")
    try:
        payload = ItemCreate.model_validate(body)
    except Exception as exc:
        raise HTTPException(422, f"invalid payload: {exc}") from exc
    return payload, []


async def build_item_update_from_request(
    request: Request,
    result_files_attr: str = "result_files",
    reference_files_attr: str = "reference_files",
) -> tuple[ItemUpdate, list[StoredImageInput]]:
    """读取 PATCH 请求, 返回 (ItemUpdate payload, 准备追加的 StoredImageInput 列表).
    payload 字段可全部省略 (None)."""
    if _is_multipart(request):
        form = await request.form()
        result_uploads: list[UploadFile] = [f for f in form.getlist(result_files_attr) if hasattr(f, "read")]
        reference_uploads: list[UploadFile] = [f for f in form.getlist(reference_files_attr) if hasattr(f, "read")]
        if not result_uploads and not reference_uploads:
            for f in form.getlist("files"):
                if hasattr(f, "read"):
                    result_uploads.append(f)  # type: ignore[arg-type]
        form_dict: dict[str, str] = {}
        for key in form.keys():
            values = form.getlist(key)
            if not values:
                continue
            if hasattr(values[0], "read"):
                continue
            form_dict[key] = str(values[-1])
        payload_dict = _payload_from_form(form_dict)
        try:
            payload = ItemUpdate.model_validate(payload_dict)
        except Exception as exc:
            raise HTTPException(422, f"invalid payload: {exc}") from exc
        result_stored = await _store_files(request, result_uploads, "result_image")
        reference_stored = await _store_files(request, reference_uploads, "reference_image")
        return payload, result_stored + reference_stored
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(400, f"invalid JSON body: {exc}") from exc
    if not isinstance(body, dict):
        raise HTTPException(422, "request body must be a JSON object")
    try:
        payload = ItemUpdate.model_validate(body)
    except Exception as exc:
        raise HTTPException(422, f"invalid payload: {exc}") from exc
    return payload, []


def apply_cover_index_for_new(
    repo: ItemRepository,
    item_id: str,
    added_images: list,
    cover_index: int,
) -> None:
    """创建场景: 把新加入的 result_image 按 cover_index 旋转, 让指定那张排第一.
    假设 added_images 中前 N 张是 result_image, 后面是 reference_image."""
    # 仅对 result_image 角色旋转
    result_count = sum(1 for img in added_images if getattr(img, "role", None) == "result_image")
    if result_count <= 1 or cover_index <= 0:
        return
    if cover_index >= result_count:
        cover_index = 0
    # 通过 rotate 现有 result 图片顺序实现
    # 1) 把已有 result 排除, 只对刚 added 的 result 旋转
    from backend.db import connect
    with connect(repo.library_path) as conn:
        existing = conn.execute(
            "SELECT id FROM images WHERE item_id=? AND role='result_image' ORDER BY sort_order ASC, created_at ASC",
            (item_id,),
        ).fetchall()
        existing_ids = [r["id"] for r in existing]
        # 刚加入的 result ids
        new_result_ids = [img.id for img in added_images if getattr(img, "role", None) == "result_image"]
        # existing 是更新前的 (含本次新增), 所以排序按 created_at desc 取尾就是新加的. 但更稳:用 sort_order desc.
        # 实际上 add_image / append_images 已经在 each step 设了 sort_order, 现有列表已包含旧 + 新.
        # 我们要按 cover_index 旋转, 但只对新加入的旋转. 简化: 直接按 cover_index 旋转整个现有 result 列表的最后 N 张.
        # 为了简单, 这里整体旋转 last N 张:
        n = len(new_result_ids)
        if n <= 1:
            return
        # 取最后 n 张 (按 sort_order 升序的后 n 张 = 新加入的)
        if cover_index >= n:
            cover_index = 0
        # 重新排序: 把第 cover_index 张放到首位
        new_in_order = existing_ids[-n:]
        rotated = new_in_order[cover_index:] + new_in_order[:cover_index]
        for i, iid in enumerate(rotated):
            # 写在 list 末尾: sort_order 起点 = len(existing) - n
            conn.execute("UPDATE images SET sort_order=? WHERE id=?", (len(existing_ids) - n + i, iid))
        conn.commit()
