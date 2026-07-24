from __future__ import annotations

from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, File, Form, UploadFile
from backend.auth.deps import require_admin, require_user
from pydantic import BaseModel

from backend.db import connect
from backend.repositories import ProductRepository
from backend.schemas import (
    ProductCoverUpdate, ProductCreate, ProductDetail, ProductDetailList, ProductImageList,
    ProductImagePromptUpdate, ProductInfoUpdate, ProductReorderRequest,
    CategoryCreate, CategoryList, SeriesCreate, SeriesList,
    ImageTrackIn,
    ImageTrackOut,)

router = APIRouter()


class ProductRecord(BaseModel):
    id: int
    source_id: int
    name: str
    series: Optional[str] = None
    category: Optional[str] = None  # 2026-07-04 加
    spec: Optional[str] = None
    selling_points: Optional[str] = None
    after_sales: Optional[str] = None
    certifications: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class ProductList(BaseModel):
    items: List[ProductRecord]
    total: int


def _row_to_product(row: Any) -> ProductRecord:
    return ProductRecord(
        id=row["id"],
        source_id=row["source_id"],
        name=row["name"],
        series=row["series"],
        category=row["category"] if "category" in row.keys() else None,
        spec=row["spec"],
        selling_points=row["selling_points"],
        after_sales=row["after_sales"] if "after_sales" in row.keys() else None,
        certifications=row["certifications"] if "certifications" in row.keys() else None,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@router.get("/products", dependencies=[Depends(require_user)], response_model=ProductDetailList)
def list_products(
    request: Request,
    q: str | None = None,
    category_id: int | None = None,
    series_id: int | None = None,
) -> ProductDetailList:
    """Product Library 列表.

    2026-07-12 主人拍: TopBar 搜索 + 品类/系列快速筛选胶囊落地.
      q           → 全文检索 name/series/category/spec/selling_points/after_sales/certifications
      category_id → 按品类字典 id 过滤
      series_id   → 按系列字典 id 过滤
    """
    repo = ProductRepository(request.app.state.library_path)
    return repo.list_products(q=q, category_id=category_id, series_id=series_id)


@router.post("/products", dependencies=[Depends(require_admin)], response_model=ProductDetail, status_code=201)
def create_product(request: Request, body: ProductCreate) -> ProductDetail:
    """2026-07-05 09:07 主人拍 A 方案: 新建产品.
    body.name 必填; source_id 后端自动分配 = max(source_id)+1.
    2026-07-06 加: name 重复 → 409 (含重复 product id).
    返回 201 + 完整 ProductDetail (含空 images 列表)."""
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Product name is required")
    try:
        return _get_repo(request).create_product(body)
    except ValueError as exc:
        msg = str(exc)
        if msg.startswith("duplicate_product_name:"):
            dup_id = int(msg.split(":", 1)[1])
            raise HTTPException(
                status_code=409,
                detail=f"Product name already exists (id={dup_id})",
            ) from exc
        raise


@router.get("/products/source/{source_id}", dependencies=[Depends(require_user)], response_model=ProductDetail)
def get_product_by_source_id(request: Request, source_id: int) -> ProductDetail:
    repo = ProductRepository(request.app.state.library_path)
    return repo.get_product_by_source_id(source_id)


@router.get("/products/{product_id}", dependencies=[Depends(require_user)], response_model=ProductDetail)
def get_product(request: Request, product_id: int) -> ProductDetail:
    repo = ProductRepository(request.app.state.library_path)
    return repo.get_product(product_id)


# ── 多图 API (2026-06-17 加, 4caf16a 之上) ────────────────────────────────────
from PIL import UnidentifiedImageError
from backend.repositories import ProductRepository
from backend.schemas import (
    ProductCoverUpdate, ProductDetail, ProductDetailList, ProductImageList,
    ProductReorderRequest,
)
from backend.schemas import (
    ProductCoverUpdate, ProductDetail, ProductDetailList, ProductImageList,
    ProductReorderRequest,
)
from backend.repositories import ProductRepository
from backend.schemas import (
    ProductCoverUpdate, ProductDetail, ProductDetailList, ProductImageList,
    ProductReorderRequest,
)

MAX_UPLOAD_BYTES = 30 * 1024 * 1024  # 30MB
MAX_IMAGES_PER_PRODUCT = 24  # 2026-07-04 主人拍: 每款产品图集上限 24 张


def _get_repo(request: Request) -> ProductRepository:
    return ProductRepository(request.app.state.library_path)


@router.get("/products/{product_id}/images", dependencies=[Depends(require_user)], response_model=ProductImageList)
def list_product_images(request: Request, product_id: int) -> ProductImageList:
    """列出某 product 的所有图（按 sort_order 升序）."""
    try:
        product = _get_repo(request).get_product(product_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Product not found") from exc
    return ProductImageList(items=product.images, total=len(product.images))


@router.post("/products/{product_id}/images", dependencies=[Depends(require_admin)], response_model=ProductDetail)
async def upload_product_image(
    request: Request,
    product_id: int,
    file: UploadFile = File("file"),
    compress: str = Form("true"),  # 2026-07-10 11:03 主人拍: ConfigPanel 压缩开关. "false" = 后端不重新编码, 保留原文件.
) -> ProductDetail:
    """上传一张图到 product (multipart/form-data, field=file, field=compress=true|false).
    第一张自动设为 cover. 24 张上限 (2026-07-04 主人拍).
    compress=false 时 = 主人配置面板关了"上传压缩", 后端不调 _compress_lossless, 保留主人原 bytes.
    """
    try:
        data = await file.read(MAX_UPLOAD_BYTES + 1)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Upload read failed: {exc}") from exc
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large")
    # 24 张上限校验
    try:
        existing = _get_repo(request).get_product(product_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Product not found") from exc
    if len(existing.images) >= MAX_IMAGES_PER_PRODUCT:
        raise HTTPException(
            status_code=409,
            detail=f"Image limit reached ({MAX_IMAGES_PER_PRODUCT} images per product).",
        )
    try:
        return _get_repo(request).attach_image(product_id, data, file.filename or "image.png", compress=(compress.lower() == "true"))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Product not found") from exc
    except (UnidentifiedImageError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/products/{product_id}", dependencies=[Depends(require_admin)], response_model=ProductDetail)
def update_product_info(
    request: Request,
    product_id: int,
    body: ProductInfoUpdate,
) -> ProductDetail:
    """更新 product 基本信息 (name/series/spec/selling_points/after_sales/certifications).
    2026-07-04 重设计: ProductModal 左栏可编辑.
    2026-07-06 加: name 重复 → 409; category/series 文本自动存入字典."""
    try:
        return _get_repo(request).update_info(product_id, body)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Not found: {exc}") from exc
    except ValueError as exc:
        msg = str(exc)
        if msg.startswith("duplicate_product_name:"):
            dup_id = int(msg.split(":", 1)[1])
            raise HTTPException(
                status_code=409,
                detail=f"Product name already exists (id={dup_id})",
            ) from exc
        raise


# ── 类别 / 系列 字典端点 (2026-07-06 主人拍下拉列表) ───────────────

@router.get("/categories", dependencies=[Depends(require_user)], response_model=CategoryList)
def list_categories(request: Request) -> CategoryList:
    items = _get_repo(request).list_categories()
    return CategoryList(items=items, total=len(items))


@router.post("/categories", dependencies=[Depends(require_admin)], response_model=CategoryList, status_code=201)
def create_category(request: Request, body: CategoryCreate) -> CategoryList:
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Category name is required")
    repo = _get_repo(request)
    # 2026-07-13 主人拍: categories 唯一性双重守护. 本路由显式 SELECT (COLLATE NOCASE) 查重,
    # INSERT 路径上还有触发器 trg_categories_unique_nocase_insert/update + 原 UNIQUE 约束 (BINARY) 兜底.
    try:
        import sqlite3 as _sq
        with connect(request.app.state.library_path) as conn:
            r = conn.execute(
                "SELECT id FROM categories WHERE name=? COLLATE NOCASE", (name,)
            ).fetchone()
            if r is not None:
                raise HTTPException(
                    status_code=409,
                    detail=f"Category '{name}' already exists (id={r['id']})",
                )
            repo._get_or_create_category_id(conn, name)
    except HTTPException:
        raise
    except _sq.IntegrityError as exc:
        raise HTTPException(status_code=409, detail=f"Category '{name}' already exists") from exc
    items = repo.list_categories()
    return CategoryList(items=items, total=len(items))


@router.get("/series_dict", dependencies=[Depends(require_user)], response_model=SeriesList)
def list_series(request: Request, category_id: Optional[int] = None) -> SeriesList:
    """2026-07-07 主人拍 A 方案: 品类和系列父子关系.
    无 category_id → 返回全量 series_dict (含 count).
    带 category_id=N → 仅返回该 category 下有产品的 series (count = 该品类下该系列产品数).

    Example:
      GET /api/v1/series_dict             → 全量 (祥云=3, 厂庆=1)
      GET /api/v1/series_dict?category_id=1 → 仅浴霸下 (祥云=3, 不含厂庆)
      GET /api/v1/series_dict?category_id=2 → 仅活动海报下 (厂庆=1, 不含祥云)
    """
    items = _get_repo(request).list_series(category_id=category_id)
    return SeriesList(items=items, total=len(items))


@router.post("/series_dict", dependencies=[Depends(require_admin)], response_model=SeriesList, status_code=201)
def create_series(request: Request, body: SeriesCreate) -> SeriesList:
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Series name is required")
    if body.category_id is None:
        raise HTTPException(status_code=400, detail="category_id is required: please select a category first")
    repo = _get_repo(request)
    try:
        import sqlite3 as _sq
        with connect(request.app.state.library_path) as conn:
            # 2026-07-13 主人拍: series name 全局唯一 (跨 category). 重名 → 409, 不再 get-or-create 静默复用.
            dup = conn.execute(
                "SELECT id, category_id FROM series_dict WHERE name=? COLLATE NOCASE",
                (name,),
            ).fetchone()
            if dup is not None:
                raise HTTPException(
                    status_code=409,
                    detail=f"Series '{name}' already exists (id={dup['id']}, category_id={dup['category_id']})"
                )
            conn.execute(
                "INSERT INTO series_dict(name, category_id) VALUES(?, ?)",
                (name, body.category_id),
            )
    except HTTPException:
        raise
    except _sq.IntegrityError as exc:
        raise HTTPException(
            status_code=409,
            detail=f"Series '{name}' already exists"
        ) from exc
    items = repo.list_series(category_id=body.category_id)
    return SeriesList(items=items, total=len(items))


@router.put("/products/{product_id}/images/{image_id}/prompt", dependencies=[Depends(require_admin)], response_model=ProductDetail)
def update_product_image_prompt(
    request: Request,
    product_id: int,
    image_id: str,
    body: ProductImagePromptUpdate,
) -> ProductDetail:
    """更新单张产品图的提示词 (2026-07-06 16:42 重设计: 10 字段专业商品摄影 schema —
    slogan / subject_angle / composition / lighting / display_stage / logo_presentation
    / material_texture / background / style / color_tone).
    16:42 主人拍: 展台 + 展台正面的 logo 独立条目, lighting 仅描述灯光不再含 logo.
    各字段字数限制: ≤ 30 (subject_angle/composition/display_stage/logo_presentation/
    material_texture/background/style/color_tone); ≤ 50 (lighting); 8-20 (slogan).
    2026-07-04 重设计: ProductModal 右栏可编辑."""
    try:
        return _get_repo(request).update_image_prompt(product_id, image_id, body)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Not found: {exc}") from exc

@router.put("/products/{product_id}/cover", dependencies=[Depends(require_admin)], response_model=ProductDetail)
def set_product_cover(
    request: Request,
    product_id: int,
    body: ProductCoverUpdate,
) -> ProductDetail:
    """设置 product 封面图 (body: {cover_image_id})."""
    try:
        return _get_repo(request).set_cover(product_id, body.cover_image_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Not found: {exc}") from exc


@router.delete("/products/{product_id}/images/{image_id}", dependencies=[Depends(require_admin)], response_model=ProductDetail)
def delete_product_image(
    request: Request,
    product_id: int,
    image_id: str,
) -> ProductDetail:
    """删除 product 一张图. 如果删的是封面, 自动选下一张做封面."""
    try:
        return _get_repo(request).remove_image(product_id, image_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Not found: {exc}") from exc


@router.put("/products/{product_id}/images/order", dependencies=[Depends(require_admin)], response_model=ProductDetail)
def reorder_product_images(
    request: Request,
    product_id: int,
    body: ProductReorderRequest,
) -> ProductDetail:
    """重排 product 图片顺序 (body: {image_ids: [id1, id2, ...]})."""
    try:
        return _get_repo(request).reorder_images(product_id, body.image_ids)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Not found: {exc}") from exc


@router.delete("/products/{product_id}", dependencies=[Depends(require_admin)], status_code=204)
def delete_product(request: Request, product_id: int) -> None:
    """2026-07-05 09:56 主人拍 A 方案: 删除产品 (级联删 images - ON DELETE CASCADE).
    204 No Content 响应."""
    try:
        _get_repo(request).delete_product(product_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Not found: {exc}") from exc



@router.post("/products/images/{image_id}/track", response_model=ImageTrackOut)
def track_image_action(request: Request, image_id: str, payload: ImageTrackIn, user = Depends(require_user)):
    """2026-07-24 主人拍: 用户复制/下载图片时调用, 后端 +1 计数.
    节流: 同一用户对同一图同一动作 5 秒内只计 1 次 (基于 audit_log 查重)."""
    from backend.db import connect
    from backend.auth.deps import _client_ip
    from datetime import datetime, timezone, timedelta
    action = payload.action
    if action not in ("copy", "download"):
        raise HTTPException(status_code=400, detail="action must be 'copy' or 'download'")
    threshold = (datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat()
    with connect(request.app.state.library_path) as conn:
        dup = conn.execute(
            "SELECT 1 FROM audit_log WHERE user_id=? AND action=? AND resource_id=? AND created_at >= ? LIMIT 1",
            (user.id, f"image_{action}", image_id, threshold),
        ).fetchone()
        if dup is not None:
            row = conn.execute("SELECT copy_count, download_count FROM product_images WHERE id=?", (image_id,)).fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="Image not found")
            return ImageTrackOut(image_id=image_id, copy_count=row["copy_count"], download_count=row["download_count"], recorded=False)
        try:
            conn.execute(
                "INSERT INTO audit_log(user_id, action, resource_type, resource_id, ip, user_agent, created_at) "
                "VALUES(?,?,?,?,?,?,?)",
                (user.id, f"image_{action}", "product_image", image_id,
                 _client_ip(request), request.headers.get("user-agent", "")[:512],
                 datetime.now(timezone.utc).isoformat()),
            )
        except Exception:
            pass
    repo = _get_repo(request)
    result = repo.track_action(image_id, action)
    if result is None:
        raise HTTPException(status_code=404, detail="Image not found")
    return ImageTrackOut(image_id=result["image_id"], copy_count=result["copy_count"], download_count=result["download_count"], recorded=True)
