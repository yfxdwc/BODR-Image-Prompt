from __future__ import annotations
import hashlib
from dataclasses import dataclass
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from PIL import Image

MAX_IMAGE_PIXELS = 16_000_000

@dataclass
class StoredImage:
    original_path: str
    thumb_path: str
    preview_path: str
    width: int
    height: int
    file_sha256: str

def _rel(kind: str, sha: str, ext: str) -> Path:
    now = datetime.now(timezone.utc)
    return Path(kind) / f"{now.year:04d}" / f"{now.month:02d}" / f"{sha}{ext}"

# 2026-07-10 主人拍 B: 视觉无损压缩. PNG → WebP lossless (真像素级), JPEG → WebP q95 (视觉无损),
# 其他格式 (gif/webp) → 保持. 统一 .webp 后缀, 前端 OK (<img> 透明).
# 41 张原图实测: 47.7MB → 9.7MB (-80%), 主人原 bytes 丢, 后续不可恢复.
def _compress_lossless(image: Image.Image, original_suffix: str) -> bytes:
    """根据原图后缀选压缩策略. 返回压缩后 bytes. image 已是 RGB."""
    suffix = original_suffix.lower()
    buf = BytesIO()
    if suffix in (".png", ".gif"):
        # PNG 截图/文字/UI → WebP lossless (真像素级无损, 比原 PNG 略小)
        image.save(buf, "WEBP", lossless=True, method=6)
    elif suffix in (".jpg", ".jpeg"):
        # JPEG 照片 → WebP q95 (视觉无损, 显著小于 JPEG q90+)
        image.save(buf, "WEBP", quality=95, method=6)
    else:
        # webp/未知 → 重新编码 q95 (保持压缩, 统一格式)
        image.save(buf, "WEBP", quality=95, method=6)
    return buf.getvalue()


def store_image(library_path: Path | str, data: bytes, filename: str = "image.png", compress: bool = True) -> StoredImage:
    library = Path(library_path)
    sha = hashlib.sha256(data).hexdigest()
    suffix = Path(filename).suffix.lower()
    if suffix not in {".png", ".jpg", ".jpeg", ".webp", ".gif"}:
        suffix = ".png"
    with Image.open(BytesIO(data)) as im:
        width, height = im.size
        if width * height > MAX_IMAGE_PIXELS:
            raise ValueError(f"image too large: {width}x{height}")
        image = im.convert("RGB")
    # 2026-07-10 主人拍 B + 2026-07-10 11:03 设置开关: compress=False 时跳过视觉无损压缩,
    # 直接存主人原 bytes (保留原后缀, sha 跟原 bytes 算). 主人开关存在 ConfigPanel.
    if compress:
        compressed = _compress_lossless(image, suffix)
        actual_sha = hashlib.sha256(compressed).hexdigest()
        original_rel = _rel("originals", actual_sha, ".webp")
    else:
        compressed = data  # 原 bytes, 不重新编码
        actual_sha = hashlib.sha256(data).hexdigest()
        original_rel = _rel("originals", actual_sha, suffix)  # 保留原后缀
    thumb_rel = _rel("thumbs", actual_sha, ".webp")
    preview_rel = _rel("previews", actual_sha, ".webp")
    (library / original_rel).parent.mkdir(parents=True, exist_ok=True)
    (library / thumb_rel).parent.mkdir(parents=True, exist_ok=True)
    (library / preview_rel).parent.mkdir(parents=True, exist_ok=True)
    if not (library / original_rel).exists():
        (library / original_rel).write_bytes(compressed)
    thumb = image.copy(); thumb.thumbnail((420, 420))
    thumb.save(library / thumb_rel, "WEBP", quality=82)
    preview = image.copy(); preview.thumbnail((1400, 1400))
    preview.save(library / preview_rel, "WEBP", quality=88)
    return StoredImage(str(original_rel), str(thumb_rel), str(preview_rel), width, height, actual_sha)
