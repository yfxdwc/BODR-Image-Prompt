"""LLM 辅助端点（提示词优化等纯文本 LLM 任务）。

复用 OpenAI Codex native OAuth 拿 access_token，调 Codex Responses API 拿文本输出。
不需要图片生成。
"""
import json
import time
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from backend.auth.deps import require_admin, require_user
from pydantic import BaseModel, Field

router = APIRouter(prefix="/llm", tags=["llm"])

POLISH_TIMEOUT_SECONDS = 30.0
MAX_PROMPT_CHARS = 20000  # 输入上限（防止滥用）


class PolishPromptRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=MAX_PROMPT_CHARS)
    language: str | None = None  # 'zh_hans' | 'zh_hant' | 'en'，用于 prompt 提示


class PolishPromptResponse(BaseModel):
    text: str
    model: str
    changed: bool
    duration_ms: int


def _build_system_prompt(language: str | None) -> str:
    lang_hint = ""
    if language == "en":
        lang_hint = "The input is in English. Keep the output in English."
    elif language == "zh_hant":
        lang_hint = "輸入是繁體中文。請保持繁體中文輸出。"
    else:
        lang_hint = "输入是简体中文。请保持简体中文输出。"
    return (
        "你是一名专业的 AI 绘图提示词编辑。你的唯一任务是【重新排版】用户提供的提示词，"
        "【绝不修改任何语义、关键词、产品型号、参数、事实】。\n\n"
        f"{lang_hint}\n\n"
        "具体要求:\n"
        "1. 保持原文所有产品型号、参数、规格、卖点原文照搬（不要加引号、不要改大小写）\n"
        "2. 修复格式问题：去除多余空行、统一段落分隔（中英文间空格）、修正标点全/半角混用\n"
        "3. 段落化：用空行分隔不同主题（场景描述 / 产品信息 / 附加备注）\n"
        "4. 如有【】标记的章节标题（【产品型号】、【附加备注】等），保持原样\n"
        "5. 不要添加任何解释、注释、前后缀\n"
        "6. 输出【必须】是纯文本（不要 Markdown 代码块、不要 JSON）\n"
        "7. 如果原文已经格式良好，只需要返回原文（不要无意义改写）"
    )


def _build_user_prompt(text: str) -> str:
    return (
        "请重新排版以下提示词，保持原意和所有关键信息不变：\n\n"
        "---START---\n"
        f"{text}\n"
        "---END---\n\n"
        "输出排版后的纯文本（不要任何解释）："
    )


@router.post("/polish-prompt", dependencies=[Depends(require_admin)], response_model=PolishPromptResponse)
def polish_prompt(payload: PolishPromptRequest, request: Request):
    """调用 LLM 重新排版提示词（保留原意，仅调整格式）。失败时降级返回原文。

    2026-07-05 20:13 主人拍: 全切 minimax-portal (anthropic-messages 协议).
    §58.1 复用: _load_minimax_config + anthropic 文本输入 (无 image)."""
    started = time.time()
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    api_key, base_url, model = _load_minimax_config()
    if not api_key:
        raise HTTPException(status_code=503, detail="minimax-portal apiKey 未配置")
    system_prompt = _build_system_prompt(payload.language)
    user_prompt = _build_user_prompt(text)

    # 2026-07-05 20:13: anthropic-messages 文本调用 (无 image)
    body = {
        "model": model,
        "max_tokens": MINIMAX_MAX_TOKENS,
        "system": system_prompt,
        "messages": [
            {"role": "user", "content": [{"type": "text", "text": user_prompt}]},
        ],
    }
    url = base_url.rstrip("/") + "/v1/messages"
    headers = {
        "Content-Type": "application/json",
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "Authorization": f"Bearer {api_key}",
    }
    try:
        with httpx.Client(timeout=httpx.Timeout(POLISH_TIMEOUT_SECONDS)) as client:
            response = client.post(url, headers=headers, json=body)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"minimax request failed: {exc}") from exc

    if response.status_code != 200:
        detail = response.text.strip()[:500] if response.text else ""
        raise HTTPException(status_code=502, detail=f"minimax returned {response.status_code}: {detail}")

    try:
        resp_payload = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="minimax returned invalid JSON") from exc

    # 2026-07-05 20:13: 从 anthropic-messages 响应抽 text (而非 Codex responses)
    polished = ""
    for blk in resp_payload.get("content") or []:
        if blk.get("type") == "text":
            polished = (blk.get("text") or "").strip()
            if polished:
                break
    duration_ms = int((time.time() - started) * 1000)

    if not polished:
        return PolishPromptResponse(text=text, model=model, changed=False, duration_ms=duration_ms)

    # 防止 LLM 返回 Markdown 代码块包裹
    if polished.startswith("```") and polished.endswith("```"):
        lines = polished.split("\n")
        if len(lines) >= 3:
            polished = "\n".join(lines[1:-1]).strip()

    if not polished:
        return PolishPromptResponse(text=text, model=model, changed=False, duration_ms=duration_ms)

    changed = polished != text
    return PolishPromptResponse(text=polished, model=model, changed=changed, duration_ms=duration_ms)


# ── 2026-07-05 19:30 主人拍 B 方案: 图片反推 5 字段 (风格/场景/展台/logo呈现/宣传标语) ──────────
ANALYZE_TIMEOUT_SECONDS = 60.0  # vision 模型耗时更高
ANALYZE_IMAGE_MAX_BYTES = 10 * 1024 * 1024  # 10MB 上限 (与后端 MAX_UPLOAD_BYTES 一致)


class AnalyzeImageRequest(BaseModel):
    """2026-07-05 B 方案: 缩略图旁 ✨ 按钮触发, 根据 product_id+image_id 反推 5 字段.
    language 默认 zh_hans, 主人可在 ⚙ 设置切到 en."""
    product_id: int = Field(..., ge=1)
    image_id: str = Field(..., min_length=1)
    language: str | None = None


class AnalyzeImageResponse(BaseModel):
    """Coerce 后 9 字段 (2026-07-06 17:19 主人拍 a: 合并 display_stage + logo_presentation → display_stage_and_logo,
    保证 None 而不是缺字段."""
    slogan: Optional[str] = None
    subject_angle: Optional[str] = None
    composition: Optional[str] = None
    lighting: Optional[str] = None
    display_stage_and_logo: Optional[str] = None  # 合并字段
    material_texture: Optional[str] = None
    background: Optional[str] = None
    style: Optional[str] = None
    color_tone: Optional[str] = None
    raw_text: Optional[str] = None  # 调试: LLM 原始 JSON 文本, parse 失败时返回
    model: str
    duration_ms: int


def _build_analyze_system_prompt(language: str | None) -> str:
    """反转 5 字段 system prompt: 输出严格 JSON, 5 key 齐全."""
    if language == "en":
        lang_hint = "Output field values in English."
    elif language == "zh_hant":
        lang_hint = "字段值請用繁體中文輸出。"
    else:
        lang_hint = "字段值用简体中文输出。"
    return (
        "你是一名专业的产品图视觉分析师。你的任务是看图,反推 5 个字段,"
        "【严格只输出 JSON 对象,不要 Markdown 代码块,不要任何前后缀解释】。\n\n"
        f"{lang_hint}\n\n"
        "9 个字段 (专业商品摄影 schema, 2026-07-06 17:19 主人拍 a: 展台 + 展台正面 logo 合并为 1 个字段):\n"
        "1. slogan (宣传标语): 看图推测可能的广告语 (8-20 字), 无法识别填 null。重要! 不可空\n"
        "2. subject_angle (主体角度): 45°斜上俯拍 / 正面平视 / 局部特写 / 側面轮廓 等 (≤ 30 字符)\n"
        "3. composition (构图): 居中占主体 / 三分法右下 / 满铺画报 / 含环境背景 等 (≤ 30 字符)\n"
        "4. lighting (灯光,【仅描述灯光, 不含 logo】): 详细描述主光+辅光+光质感 (≤ 50 字符内)\n"
        "5. display_stage_and_logo (【展台 + 展台正面 logo, 主人拍合并为一字段】, 品牌展示核心):\n"
        "   - 展台: 木质展台 / 玻璃转盘 / 大理石台面 / 黑色台面 / 金属支架 / 桌面手持 等\n"
        "   - logo 材质 (品牌核心): 烫金/丝印/雕刻/嵌入发光/3D 浮雕/镂空/未呈现\n"
        "   - logo 位置: 正面居中/右上角/底部居中/背面/隐藏\n"
        "   - 可用空格分隔多个短语, 但单个字段总长 ≤ 50 字符\n"
        "6. material_texture (材质触感): 哑光磨砂金属 / 抛光镜面 / 哑面金属拉丝 等 (≤ 30 字符)\n"
        "7. background (背景): 纯白抠图 / 暖灰渐变 / 木质背景 / 灰色墙背景 / 室内实景 等 (≤ 30 字符)\n"
        "8. style (风格): 高端 / 极简 / 治愈系 / 工业风 / 复古 / 简约 等 (≤ 30 字符)\n"
        "9. color_tone (色调): 暖调奶油色 / 冷调银灰 / 高对比黑白 / 低饱和胶片 等 (≤ 30 字符)\n\n"
        "严格输出格式 (9 字段缺一不可):\n"
        '{"slogan": "...", "subject_angle": "...", "composition": "...", "lighting": "...", "display_stage_and_logo": "...", "material_texture": "...", "background": "...", "style": "...", "color_tone": "..."}\n'
    )


def _build_analyze_user_prompt() -> str:
    """User message 仅放指令前缀, image 通过 input_image 字段单独传."""
    return (
        "请看下面这张产品图,严格按 system 指令输出 5 字段 JSON。"
        "如果某个字段实在看不出,填 null。"
    )


def _extract_json_object(text: str) -> dict[str, Any] | None:
    """从 LLM 输出提取首个 {...} JSON 对象 (处理 LLM 偶发前缀/后缀干扰)."""
    text = text.strip()
    # 去掉 Markdown 代码块包裹
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()
    # 找首个 { 和最后一个 }
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end < 0 or end <= start:
        return None
    candidate = text[start:end + 1]
    try:
        return json.loads(candidate)
    except (ValueError, json.JSONDecodeError):
        return None


@router.post("/analyze-image", dependencies=[Depends(require_admin)], response_model=AnalyzeImageResponse)
def analyze_image(payload: AnalyzeImageRequest, request: Request):
    """2026-07-05 19:30 主人拍 B 方案: 5 字段图片反推 (风格/场景/展台/logo呈现/宣传标语).
    复用 Codex native OAuth + httpx + Responses API + vision 多模态 input.
    失败时降级: Codex 未认证 → 503; JSON parse 失败 → 5 字段全 null (前端显示"AI 暂不可用")."""
    started = time.time()
    language = payload.language or "zh_hans"

    # 1) 找产品图 (从本地 library 读)
    from ..repositories import ProductRepository  # noqa: PLC0415

    repo = ProductRepository(request.app.state.library_path)
    try:
        product = repo.get_product(payload.product_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Product not found: {exc}") from exc

    target_img = next((img for img in (product.images or []) if img.id == payload.image_id), None)
    if not target_img:
        raise HTTPException(status_code=404, detail=f"Image not found: {payload.image_id}")

    # 用 original_path 走 disk (保留 source-of-truth), 若无再降级 preview/thumb
    rel_path = target_img.original_path or target_img.preview_path or target_img.thumb_path
    if not rel_path:
        raise HTTPException(status_code=400, detail="Image has no readable path")
    # rel_path 是 'originals/2026/07/<sha>.png' 相对路径, 直接拼 library_path
    from pathlib import Path  # noqa: PLC0415
    library_root = Path(str(request.app.state.library_path))
    disk_path = library_root / rel_path
    if not disk_path.exists():
        raise HTTPException(status_code=404, detail=f"Image file missing on disk: {rel_path}")
    file_size = disk_path.stat().st_size
    if file_size > ANALYZE_IMAGE_MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"Image too large ({file_size} > {ANALYZE_IMAGE_MAX_BYTES})")

    # 2) 读 bytes → base64 data URL (Codex vision 接受 data: URL)
    import base64
    import mimetypes
    mime_type = mimetypes.guess_type(str(disk_path))[0] or "image/png"
    data_b64 = base64.b64encode(disk_path.read_bytes()).decode("ascii")
    data_url = f"data:{mime_type};base64,{data_b64}"

    # 3) 2026-07-05 20:00 主人拍: 改用 minimax-portal (anthropic-messages) 替代 Codex OAuth
    api_key, base_url, model = _load_minimax_config()
    if not api_key:
        raise HTTPException(status_code=503, detail="minimax-portal apiKey 未配置 (检查 ~/.openclaw/openclaw.json)")
    system_prompt = _build_analyze_system_prompt(language)
    user_prompt = _build_analyze_user_prompt()
    raw_text = _call_minimax_vision(
        api_key=api_key,
        base_url=base_url,
        model=model,
        system_prompt=system_prompt,
        user_text=user_prompt,
        data_url=data_url,
        language=language,
    )
    duration_ms = int((time.time() - started) * 1000)

    if not raw_text:
        return AnalyzeImageResponse(
            slogan=None, subject_angle=None, composition=None, lighting=None,
            display_stage_and_logo=None,
            material_texture=None, background=None, style=None, color_tone=None,
            raw_text=None, model=model, duration_ms=duration_ms,
        )

    parsed = _extract_json_object(raw_text)
    if parsed is None:
        return AnalyzeImageResponse(
            slogan=None, subject_angle=None, composition=None, lighting=None,
            display_stage_and_logo=None,
            material_texture=None, background=None, style=None, color_tone=None,
            raw_text=raw_text[:1000], model=model, duration_ms=duration_ms,
        )

    def _coerce(v: Any, maxlen: Optional[int] = None) -> Optional[str]:
        if v is None:
            return None
        if isinstance(v, str):
            s = v.strip()
            if not s:
                return None
        else:
            s = str(v).strip()
            if not s:
                return None
        if maxlen is not None and len(s) > maxlen:
            return s[:maxlen].rstrip()
        return s

    # 2026-07-06 17:19 主人拍 a: 9 字段 (display_stage + logo_presentation → display_stage_and_logo)
    return AnalyzeImageResponse(
        slogan=_coerce(parsed.get("slogan"), 20),
        subject_angle=_coerce(parsed.get("subject_angle"), 30),
        composition=_coerce(parsed.get("composition"), 30),
        lighting=_coerce(parsed.get("lighting"), 50),
        display_stage_and_logo=_coerce(parsed.get("display_stage_and_logo"), 50),  # 合并字段 (≤50)
        material_texture=_coerce(parsed.get("material_texture"), 30),
        background=_coerce(parsed.get("background"), 30),
        style=_coerce(parsed.get("style"), 30),
        color_tone=_coerce(parsed.get("color_tone"), 30),
        raw_text=None,
        model=model,
        duration_ms=duration_ms,
    )

# ─────────────────────────────────────────────────────────────────────────────
# 2026-07-05 20:00 主人拍: 用 minimax-portal (anthropic-messages 协议) 替代 Codex OAuth for analyze-image
# §58.1 复用: minimax-portal 已配 openclaw.json, apiKey 125 字符, MiniMax-M3 vision-capable
# ─────────────────────────────────────────────────────────────────────────────
import os as _os  # noqa: E402

MINIMAX_DEFAULT_MODEL = "MiniMax-M3"
MINIMAX_DEFAULT_BASE_URL = "https://api.minimaxi.com/anthropic"
MINIMAX_TIMEOUT_SECONDS = 90.0
MINIMAX_MAX_TOKENS = 2048


def _load_minimax_config() -> tuple[str, str, str]:
    """2026-07-05 20:00 主人拍: 从 openclaw.json 读 minimax-portal. 返回 (api_key, base_url, model).
    缺 key 时让上层抛 503."""
    key_path = _os.environ.get("OPENCLAW_CONFIG") or "/home/mm7/.openclaw/openclaw.json"
    try:
        with open(key_path) as _f:
            cfg = json.loads(_f.read())
        mk = cfg.get("models", {}).get("providers", {}).get("minimax-portal", {})
        api_key = mk.get("apiKey") or ""
        base_url = mk.get("baseUrl") or MINIMAX_DEFAULT_BASE_URL
        models = mk.get("models") or []
        model = MINIMAX_DEFAULT_MODEL
        for m in models:
            mid = m.get("id") or ""
            if mid == MINIMAX_DEFAULT_MODEL:
                model = mid
                break
        return api_key, base_url, model
    except (FileNotFoundError, KeyError, ValueError):
        return "", MINIMAX_DEFAULT_BASE_URL, MINIMAX_DEFAULT_MODEL


def _call_minimax(
    *,
    api_key: str,
    base_url: str,
    model: str,
    system_prompt: str,
    user_blocks: list,
    timeout: float,
) -> str:
    """2026-07-05 20:13 B 方案: anthropic-messages 协议调 minimax-portal (text 专用 vision 也可以复用).
    user_blocks = [{"type": "text", "text": ...}, {"type": "image", ...}].
    返回首个 text block 的内容; 失败抛 HTTPException 502."""
    body = {
        "model": model,
        "max_tokens": MINIMAX_MAX_TOKENS,
        "system": system_prompt,
        "messages": [
            {"role": "user", "content": user_blocks},
        ],
    }
    url = base_url.rstrip("/") + "/v1/messages"
    headers = {
        "Content-Type": "application/json",
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "Authorization": f"Bearer {api_key}",
    }
    try:
        with httpx.Client(timeout=httpx.Timeout(timeout)) as client:
            response = client.post(url, headers=headers, json=body)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"minimax request failed: {exc}") from exc

    if response.status_code != 200:
        detail = response.text.strip()[:500] if response.text else ""
        raise HTTPException(status_code=502, detail=f"minimax returned {response.status_code}: {detail}")

    try:
        resp_payload = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="minimax returned invalid JSON") from exc

    for blk in resp_payload.get("content") or []:
        if blk.get("type") == "text":
            txt = (blk.get("text") or "").strip()
            if txt:
                return txt
    return ""


def _call_minimax_text(
    *,
    api_key: str,
    base_url: str,
    model: str,
    system_prompt: str,
    user_text: str,
    timeout: float,
) -> str:
    """2026-07-05 20:13 B 方案: polish prompt 文本调. 复用 _call_minimax + 单 text block."""
    return _call_minimax(
        api_key=api_key,
        base_url=base_url,
        model=model,
        system_prompt=system_prompt,
        user_blocks=[{"type": "text", "text": user_text}],
        timeout=timeout,
    )


def _call_minimax_vision(
    *,
    api_key: str,
    base_url: str,
    model: str,
    system_prompt: str,
    user_text: str,
    data_url: str,
    language: str | None,
) -> str:
    """2026-07-05 20:00 主人拍: 复用 _call_minimax + 加 image block (text + vision 多模态)."""
    head, b64 = data_url.split(",", 1)
    media_type = head.removeprefix("data:").split(";", 1)[0] or "image/png"
    image_block = {
        "type": "image",
        "source": {"type": "base64", "media_type": media_type, "data": b64},
    }
    return _call_minimax(
        api_key=api_key,
        base_url=base_url,
        model=model,
        system_prompt=system_prompt,
        user_blocks=[
            {"type": "text", "text": user_text},
            image_block,
        ],
        timeout=ANALYZE_TIMEOUT_SECONDS,
    )
