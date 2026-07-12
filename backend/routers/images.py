from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from backend.auth.deps import require_admin, require_user
from pydantic import BaseModel
from PIL import UnidentifiedImageError
from backend.repositories import ItemRepository, StoredImageInput
from backend.services.image_store import store_image
router = APIRouter()

MAX_UPLOAD_BYTES = 30 * 1024 * 1024


class ImageOrderRequest(BaseModel):
    image_ids: list[str]


@router.post("/items/{item_id}/images", dependencies=[Depends(require_admin)])
async def upload_image(request: Request, item_id: str, file: UploadFile = File(...), role: str = Form("result_image")):
    if role not in {"result_image", "reference_image"}:
        raise HTTPException(400, "Invalid image role")
    repository = ItemRepository(request.app.state.library_path)
    try:
        repository.get_item(item_id)
    except KeyError as exc:
        raise HTTPException(404, "Item not found") from exc
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Image upload too large")
    try:
        stored = store_image(request.app.state.library_path, data, file.filename or "image.png")
    except (ValueError, UnidentifiedImageError) as exc:
        raise HTTPException(400, str(exc)) from exc
    rec = repository.add_image(item_id, StoredImageInput(stored.original_path, stored.thumb_path, stored.preview_path, width=stored.width, height=stored.height, file_sha256=stored.file_sha256, role=role))
    return rec


@router.delete("/items/{item_id}/images/{image_id}", dependencies=[Depends(require_admin)])
async def delete_item_image(request: Request, item_id: str, image_id: str):
    """删除单张图片 (result 或 reference 均可). 抛 404 当 image 不属于该 item."""
    repository = ItemRepository(request.app.state.library_path)
    try:
        removed = repository.remove_image(item_id, image_id)
    except KeyError as exc:
        raise HTTPException(404, f"Image not found: {exc}") from exc
    return {"deleted": removed.id, "role": removed.role}


@router.put("/items/{item_id}/images/order", dependencies=[Depends(require_admin)])
async def reorder_item_images(request: Request, item_id: str, body: ImageOrderRequest):
    """重排 item 的图片顺序. body: {image_ids: [id1, id2, ...]}.
    顺序即为新的 sort_order (0..N-1), 第一个自动为 cover.
    只接受 result_image 角色的图 (follow-up 拖拽需求)."""
    repository = ItemRepository(request.app.state.library_path)
    try:
        # 取出所有 result_image, 验证 body 中的 id 全是 result_image 且属于该 item
        from backend.db import connect
        with connect(repository.library_path) as conn:
            existing_rows = conn.execute(
                "SELECT id FROM images WHERE item_id=? AND role='result_image' ORDER BY sort_order ASC, created_at ASC",
                (item_id,),
            ).fetchall()
            existing_ids = {r["id"] for r in existing_rows}
        unknown = [iid for iid in body.image_ids if iid not in existing_ids]
        if unknown:
            raise HTTPException(422, f"image_ids not in item result_image: {unknown}")
        if set(body.image_ids) != existing_ids:
            missing = existing_ids - set(body.image_ids)
            extra = set(body.image_ids) - existing_ids
            raise HTTPException(422, f"image_ids mismatch: missing={list(missing)}, extra={list(extra)}")
        return repository.reorder_result_images(item_id, body.image_ids)
    except KeyError as exc:
        raise HTTPException(404, f"Item not found: {exc}") from exc
