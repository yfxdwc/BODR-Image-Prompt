from typing import Any, List, Optional
from pydantic import BaseModel, Field, ConfigDict, field_validator

class PromptIn(BaseModel):
    language: str = "original"
    text: str
    is_primary: bool = False
    is_original: bool = False
    provenance: dict[str, Any] = Field(default_factory=dict)

class PromptRecord(PromptIn):
    id: str
    item_id: str
    created_at: str
    updated_at: str

class ImageRecord(BaseModel):
    id: str
    item_id: str
    original_path: str
    thumb_path: Optional[str] = None
    preview_path: Optional[str] = None
    remote_url: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    file_sha256: Optional[str] = None
    role: str = "result_image"
    sort_order: int = 0
    created_at: str
    uploaded_at: str = ""  # 2026-07-09 20:44: migration 018 主人拍 E — 上传日期 (default 空字符串兼容老数据)


# ── Multi-image limits (2026-06-20, BODR Image Prompt multi-image editor) ──────────────────
MAX_RESULT_IMAGES = 9
MAX_REFERENCE_IMAGES = 4

class ClusterRecord(BaseModel):
    id: str
    name: str
    names: dict[str, str] = Field(default_factory=dict)
    description: Optional[str] = None
    sort_order: int = 0
    count: int = 0
    preview_images: List[str] = Field(default_factory=list)

class TagRecord(BaseModel):
    id: str
    name: str
    kind: str = "general"
    count: int = 0

class ItemCreate(BaseModel):
    title: str
    slug: Optional[str] = None
    model: str = "ChatGPT Image2"
    media_type: str = "image"
    source_name: Optional[str] = None
    source_url: Optional[str] = None
    author: Optional[str] = None
    cluster_id: Optional[str] = None
    cluster_name: Optional[str] = None
    rating: int = 0
    favorite: bool = False
    archived: bool = False
    notes: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    prompts: List[PromptIn] = Field(default_factory=list)
    cover_index: int = 0  # 用户选的封面在 result 图中的索引 (0=第一张)

class ItemUpdate(BaseModel):
    title: Optional[str] = None
    model: Optional[str] = None
    source_name: Optional[str] = None
    source_url: Optional[str] = None
    author: Optional[str] = None
    cluster_id: Optional[str] = None
    cluster_name: Optional[str] = None
    rating: Optional[int] = None
    favorite: Optional[bool] = None
    archived: Optional[bool] = None
    notes: Optional[str] = None
    tags: Optional[List[str]] = None
    prompts: Optional[List[PromptIn]] = None
    cover_index: Optional[int] = None  # 编辑时调整 cover (基于现有 result 列表索引)

class ItemSummary(BaseModel):
    id: str
    title: str
    slug: str
    model: str
    source_name: Optional[str] = None
    source_url: Optional[str] = None
    cluster: Optional[ClusterRecord] = None
    tags: List[TagRecord] = Field(default_factory=list)
    prompts: List[PromptRecord] = Field(default_factory=list)
    prompt_snippet: Optional[str] = None
    first_image: Optional[ImageRecord] = None
    images: List[ImageRecord] = Field(default_factory=list)
    rating: int = 0
    favorite: bool = False
    archived: bool = False
    updated_at: str
    created_at: str

class ItemDetail(ItemSummary):
    images: List[ImageRecord] = Field(default_factory=list)
    notes: Optional[str] = None
    author: Optional[str] = None

class ItemList(BaseModel):
    items: List[ItemSummary]
    total: int
    limit: int
    offset: int

class ImportResult(BaseModel):
    id: str
    item_count: int
    image_count: int
    status: str
    log: str = ""

class ImportDraftMedia(BaseModel):
    url: Optional[str] = None
    original_path: Optional[str] = None
    staged_path: Optional[str] = None
    role: str = "result_image"
    kind: str = "remote"
    width: Optional[int] = None
    height: Optional[int] = None
    file_sha256: Optional[str] = None

class ImportDraftCreate(BaseModel):
    source_type: str
    source_name: Optional[str] = None
    source_url: Optional[str] = None
    source_ref: Optional[str] = None
    source_path: Optional[str] = None
    title: str
    model: str = "ChatGPT Image2"
    author: Optional[str] = None
    suggested_cluster_name: Optional[str] = None
    suggested_tags: List[str] = Field(default_factory=list)
    prompts: List[PromptIn] = Field(default_factory=list)
    media: List[ImportDraftMedia] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    confidence: Optional[float] = None

class ImportDraftRecord(ImportDraftCreate):
    id: str
    status: str
    duplicate_of_item_id: Optional[str] = None
    accepted_item_id: Optional[str] = None
    created_at: str
    updated_at: str
    accepted_at: Optional[str] = None

class ImportDraftList(BaseModel):
    drafts: List[ImportDraftRecord]
    total: int
    limit: int
    offset: int

class ImportDraftAcceptResult(BaseModel):
    draft: ImportDraftRecord
    item: ItemDetail

class RepositoryIngestRequest(BaseModel):
    path: str
    repo_url: Optional[str] = None
    source_ref: Optional[str] = None

class RepositoryIngestResult(BaseModel):
    id: str
    draft_count: int
    status: str
    drafts: List[ImportDraftRecord]
    log: str = ""

class GenerationJobCreate(BaseModel):
    source_item_id: Optional[str] = None
    mode: str = "text_to_image"
    provider: str = "manual_upload"
    model: Optional[str] = None
    prompt_language: Optional[str] = None
    prompt_text: str
    edited_prompt_text: Optional[str] = None
    reference_image_ids: List[str] = Field(default_factory=list)
    parameters: dict[str, Any] = Field(default_factory=dict)

class GenerationJobRecord(GenerationJobCreate):
    id: str
    status: str
    result_path: Optional[str] = None
    result_width: Optional[int] = None
    result_height: Optional[int] = None
    result_sha256: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    error: Optional[str] = None
    accepted_image_id: Optional[str] = None
    created_at: str
    updated_at: str
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    accepted_at: Optional[str] = None
    discarded_at: Optional[str] = None
    cancelled_at: Optional[str] = None

class GenerationJobAcceptAsNewItemRequest(BaseModel):
    title: Optional[str] = None
    cluster_name: Optional[str] = None
    tags: Optional[List[str]] = None
    prompts: Optional[List[PromptIn]] = None
    model: Optional[str] = None
    source_name: Optional[str] = None
    source_url: Optional[str] = None
    author: Optional[str] = None
    notes: Optional[str] = None

class GenerationJobList(BaseModel):
    jobs: List[GenerationJobRecord]
    total: int
    limit: int
    offset: int

class GenerationJobAcceptResult(BaseModel):
    job: GenerationJobRecord
    item: ItemDetail

class GenerationJobRetryResult(BaseModel):
    discarded_job: GenerationJobRecord
    retry_job: GenerationJobRecord


# ── Product image group (migration 010, 2026-06-17) ──────────────────────────
# 注: 不破坏 4caf16a 的 Product 模型 — 在新类里扩展

class ProductImagePrompt(BaseModel):
    """单张产品图的产品摄影提示词 (2026-07-06 16:42 主人拍: 10 字段专业摄影 schema).

    10 字段独立可编辑 (按主人重要性顺序):
       1. slogan           — 宣传标语 (8-20 字, 保留)
       2. subject_angle    — 主体角度 (≤30, 如 "45° 斜上俯拍")
       3. composition      — 构图 (≤30, 如 "居中含环境")
       4. lighting         — 灯光 (≤50, 仅描述灯光, 不再含 logo)
       5. display_stage    — 展台 (≤30, 如 "木质展台 / 玻璃展台 / 大理石台面", 独立于 lighting)
       6. logo_presentation — 展台正面的 logo (≤30, 独立条目: 烫金/丝印/雕刻/3D 浮雕 + 位置)
       7. material_texture — 材质触感 (≤30, 如 "哑光磨砂")
       8. background       — 背景 (≤30, 如 "暖灰渐变")
       9. style            — 风格 (≤30, 如 "高端极简")
      10. color_tone       — 色调 (≤30, 如 "暖调奶油色")
    """
    slogan: Optional[str] = None  # 1. 宣传标语 (8-20 字)
    subject_angle: Optional[str] = None  # 2. 主体角度
    composition: Optional[str] = None  # 3. 构图
    lighting: Optional[str] = None  # 4. 灯光 (仅灯光, 不再含 logo)
    display_stage: Optional[str] = None  # 5. 展台 (≤30)
    logo_presentation: Optional[str] = None  # 6. 展台正面的 logo (≤30)
    material_texture: Optional[str] = None  # 7. 材质触感
    background: Optional[str] = None  # 8. 背景
    style: Optional[str] = None  # 9. 风格
    color_tone: Optional[str] = None  # 10. 色调

    _MAXLEN_30 = 30
    _MAXLEN_50 = 50

    @field_validator("subject_angle", "composition", "display_stage", "logo_presentation",
                      "material_texture", "background", "style", "color_tone")
    @classmethod
    def _max30(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        if len(v) > 30:
            return v[:30].rstrip()
        return v

    @field_validator("lighting")
    @classmethod
    def _max50(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        if len(v) > 50:
            return v[:50].rstrip()
        return v

    @field_validator("slogan")
    @classmethod
    def _slogan_8_20(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.strip()
        if not v:
            return None
        if len(v) < 8:
            return v  # 短主语词 OK (让反推也宽容)
        if len(v) > 20:
            return v[:20].rstrip()
        return v


class ProductImagePromptUpdate(BaseModel):
    """Body for PUT /api/v1/products/{id}/images/{img_id}/prompt.
    2026-07-06 17:19: 9 字段 (合并 display_stage + logo_presentation)."""
    slogan: Optional[str] = None
    subject_angle: Optional[str] = None
    composition: Optional[str] = None
    lighting: Optional[str] = None
    display_stage_and_logo: Optional[str] = None
    material_texture: Optional[str] = None
    background: Optional[str] = None
    style: Optional[str] = None
    color_tone: Optional[str] = None

    @field_validator("subject_angle", "composition", "material_texture", "background", "style", "color_tone")
    @classmethod
    def _max30(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        if len(v) > 30:
            return v[:30].rstrip()
        return v

    @field_validator("lighting", "display_stage_and_logo")
    @classmethod
    def _max50(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        if len(v) > 50:
            return v[:50].rstrip()
        return v


class ProductImageRecord(BaseModel):
    """单张产品图. id 形如 'pi_<ulid>'.
    2026-07-06 17:19: 9 字段 (合并 display_stage + logo_presentation)."""
    id: str
    product_id: int
    original_path: str
    thumb_path: Optional[str] = None
    preview_path: Optional[str] = None
    remote_url: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    file_sha256: Optional[str] = None
    file_size_bytes: Optional[int] = None
    sort_order: int = 0
    is_cover: bool = False
    created_at: str
    slogan: Optional[str] = None
    subject_angle: Optional[str] = None
    composition: Optional[str] = None
    lighting: Optional[str] = None
    display_stage_and_logo: Optional[str] = None
    material_texture: Optional[str] = None
    background: Optional[str] = None
    style: Optional[str] = None
    color_tone: Optional[str] = None
    # 2026-07-10 主人拍: 瀑布流时间线用. created_at 优先; created_at 不可靠时 (=全部同月) 兑底用文件系统 mtime.
    # 前端 timeline 视图按这个字段的 YYYY-MM 分组.
    effective_uploaded_at: Optional[str] = None
    # 2026-07-24 主人拍: 团队偏好热度, 用于识别更受用户喜欢的图片.
    copy_count: int = 0
    download_count: int = 0


class ProductImageList(BaseModel):
    items: List[ProductImageRecord]
    total: int


class ProductCoverUpdate(BaseModel):
    """Body for PUT /api/v1/products/{id}/cover."""
    cover_image_id: str


class ProductInfoUpdate(BaseModel):
    """Body for PATCH /api/v1/products/{id}. (2026-07-04 加)
    2026-07-04 21:31 加 category."""
    name: Optional[str] = None
    series: Optional[str] = None
    category: Optional[str] = None
    spec: Optional[str] = None
    selling_points: Optional[str] = None
    after_sales: Optional[str] = None
    certifications: Optional[str] = None


class ProductCreate(BaseModel):
    """Body for POST /api/v1/products. (2026-07-05 09:07 主人拍 A 方案)
    name 必填; 其他字段可选 (model_fields_set 区分"未传 vs 传 None/空").
    source_id 由后端自动分配."""
    name: str
    series: Optional[str] = None
    category: Optional[str] = None
    spec: Optional[str] = None
    selling_points: Optional[str] = None
    after_sales: Optional[str] = None
    certifications: Optional[str] = None


class ProductReorderRequest(BaseModel):
    """Body for PUT /api/v1/products/{id}/images/order."""
    image_ids: List[str]


class ProductDetail(BaseModel):
    """Product with image group + cover. 兼容 4caf16a 的 Product 字段 + 加 images/cover.
    2026-07-04 重设计: 加 after_sales / certifications / category."""
    id: int
    source_id: int
    name: str
    series: Optional[str] = None
    category: Optional[str] = None  # 2026-07-04 主人拍: 产品类别
    spec: Optional[str] = None
    selling_points: Optional[str] = None
    after_sales: Optional[str] = None
    certifications: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    cover_image_id: Optional[str] = None
    cover_image: Optional[ProductImageRecord] = None
    images: List[ProductImageRecord] = Field(default_factory=list)


class ProductDetailList(BaseModel):
    items: List[ProductDetail]
    total: int


# ── Dictionary Records (2026-07-06 主人拍) ─────────────────────────
# 类别 + 系列做下拉列表, 需要字典表. 后端返回用.

class CategoryRecord(BaseModel):
    id: int
    name: str
    created_at: Optional[str] = None
    count: int = 0


class SeriesRecord(BaseModel):
    id: int
    name: str
    created_at: Optional[str] = None
    count: int = 0


class CategoryCreate(BaseModel):
    name: str


class SeriesCreate(BaseModel):
    name: str
    category_id: Optional[int] = None


class CategoryList(BaseModel):
    items: List[CategoryRecord]
    total: int


class SeriesList(BaseModel):
    items: List[SeriesRecord]
    total: int


# ── 2026-07-11 BIP auth/RBAC ─────────────────────────────────────────────────

class RegisterIn(BaseModel):
    email: str
    username: str
    password: str
    reason: Optional[str] = None  # 申请理由
    display_name: Optional[str] = None


class LoginIn(BaseModel):
    username: str  # 接受 username 或 email
    password: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    access_expires_at: str
    refresh_expires_at: str
    user: "UserPublic"


class RefreshIn(BaseModel):
    refresh_token: Optional[str] = None


class UserPublic(BaseModel):
    id: str
    email: str
    username: str
    role: str
    display_name: Optional[str] = None
    created_at: str
    approved_at: Optional[str] = None
    last_login_at: Optional[str] = None
    # 2026-07-14 主人拍: 管理员备注 + 锁定
    note_name: Optional[str] = None
    is_locked: bool = False
    locked_reason: Optional[str] = None




class UserMetaUpdate(BaseModel):
    """2026-07-14 主人拍: admin 更新用户备注/锁定.
    字段全部 Optional, 没传=不改; 传空串=清空; 传新值=覆盖."""
    note_name: Optional[str] = None
    is_locked: Optional[bool] = None
    locked_reason: Optional[str] = None
class UserCreateAdmin(BaseModel):
    """admin 直接创建用户 (不走申请流). 主人紧急开账号用."""
    email: str
    username: str
    password: str
    role: str  # 'admin' or 'user'
    display_name: Optional[str] = None


class RegistrationRequestPublic(BaseModel):
    id: str
    user_id: str
    user_email: str
    user_username: str
    requested_at: str
    reason: Optional[str] = None
    status: str
    reviewed_at: Optional[str] = None
    reviewed_by: Optional[str] = None
    review_note: Optional[str] = None


class ApprovalDecision(BaseModel):
    review_note: Optional[str] = None


class AuditEntry(BaseModel):
    id: int
    user_id: Optional[str] = None
    action: str
    resource_type: Optional[str] = None
    resource_id: Optional[str] = None
    ip: Optional[str] = None
    user_agent: Optional[str] = None
    metadata: Optional[str] = None
    created_at: str


class AuditPage(BaseModel):
    items: List[AuditEntry]
    total: int


class ImageTrackIn(BaseModel):
    """2026-07-24 主人拍: 用户复制/下载图片时上报, 后端 +1 计数."""
    action: str  # "copy" | "download"


class ImageTrackOut(BaseModel):
    image_id: str
    copy_count: int
    download_count: int
    recorded: bool
