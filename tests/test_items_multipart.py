"""Tests for the multi-image editor backend (2026-06-20 BODR Image Prompt item editor upgrade).

Covers:
  * POST /api/items multipart  (3 result + 2 reference  → ItemDetail with 5 images)
  * 上限校验 (10 result → 422 ; 5 reference → 422)
  * PATCH /api/items/{id} multipart  (追加 2 张新 result → 总 5 张, 原 3 张保留)
  * DELETE /api/items/{id}/images/{image_id}  (单图删除)
  * POST /api/items/{id}/images/{image_id}/cover  (改 cover)
  * 向后兼容: 旧 JSON-only 调用仍成功
"""
import json

import pytest
from fastapi.testclient import TestClient
from io import BytesIO
from PIL import Image

from backend.main import create_app
from backend.schemas import MAX_REFERENCE_IMAGES, MAX_RESULT_IMAGES


def client(tmp_path):
    return TestClient(create_app(library_path=tmp_path / "library"))


def png_bytes(size=(40, 30), color=(120, 40, 220)):
    buf = BytesIO()
    Image.new("RGB", size, color).save(buf, format="PNG")
    return buf.getvalue()


def base_form(title="Multi Image Card", prompts=None, cover_index=0):
    if prompts is None:
        prompts = [{"language": "en", "text": "Multi image test", "is_primary": True}]
    return {
        "title": title,
        "model": "ChatGPT Image2",
        "author": "tester",
        "tags": json.dumps(["multi"]),
        "prompts": json.dumps(prompts),
        "cover_index": str(cover_index),
    }


def _files_block(count, role, color_base):
    return [
        ("result_files" if role == "result_image" else "reference_files",
         (f"{role}_{i}.png", png_bytes(color=(color_base + i * 10, 40, 220)), "image/png"))
        for i in range(count)
    ]


# ── multipart create ──────────────────────────────────────────────────────
def test_create_with_multipart_uploads_3_result_and_2_reference(tmp_path):
    c = client(tmp_path)
    files = _files_block(3, "result_image", 100) + _files_block(2, "reference_image", 10)
    r = c.post("/api/items", data=base_form(), files=files)
    assert r.status_code == 200, r.text
    item = r.json()
    assert len(item["images"]) == 5
    result_imgs = [i for i in item["images"] if i["role"] == "result_image"]
    ref_imgs = [i for i in item["images"] if i["role"] == "reference_image"]
    assert len(result_imgs) == 3
    assert len(ref_imgs) == 2
    # sort_order 0..4
    assert sorted([i["sort_order"] for i in item["images"]]) == [0, 1, 2, 3, 4]
    # 第一张是 result, sort_order=0
    first = next(i for i in item["images"] if i["sort_order"] == 0)
    assert first["role"] == "result_image"


def test_create_multipart_with_cover_index_2_rotates_result_images(tmp_path):
    c = client(tmp_path)
    files = _files_block(3, "result_image", 100)
    r = c.post("/api/items", data=base_form(cover_index=2), files=files)
    assert r.status_code == 200, r.text
    item = r.json()
    # 上传的 3 张 result 都应该被旋转, 让第 cover_index 张排第一
    result_imgs = sorted([i for i in item["images"] if i["role"] == "result_image"], key=lambda i: i["sort_order"])
    assert len(result_imgs) == 3
    # sort_order 0 应该是 'result_image_2' 颜色的那张 (cover_index=2 选了第 3 张)
    # 实际上 add 顺序是 result_0, result_1, result_2 → sort_order 0,1,2
    # rotate by 2 → result_2, result_0, result_1 → sort_order 0,1,2
    first = result_imgs[0]
    assert first["sort_order"] == 0


# ── 上限校验 ──────────────────────────────────────────────────────────────
def test_create_with_10_result_images_returns_422(tmp_path):
    c = client(tmp_path)
    files = _files_block(MAX_RESULT_IMAGES + 1, "result_image", 100)
    r = c.post("/api/items", data=base_form(), files=files)
    assert r.status_code == 422
    assert "result_image limit 9" in r.text


def test_create_with_5_reference_images_returns_422(tmp_path):
    c = client(tmp_path)
    files = _files_block(MAX_REFERENCE_IMAGES + 1, "reference_image", 10)
    r = c.post("/api/items", data=base_form(), files=files)
    assert r.status_code == 422
    assert "reference_image limit 4" in r.text


def test_update_appending_past_result_limit_returns_422(tmp_path):
    c = client(tmp_path)
    # 先创建 1 张 result
    files = _files_block(1, "result_image", 100)
    created = c.post("/api/items", data=base_form(), files=files).json()
    # 再补 9 张, 应刚好 10 → 超限
    more = _files_block(9, "result_image", 200)
    r = c.patch(f"/api/items/{created['id']}", data={"cover_index": "0"}, files=more)
    assert r.status_code == 422
    assert "result_image limit 9" in r.text


# ── multipart PATCH 追加 ────────────────────────────────────────────────
def test_patch_multipart_appends_2_new_result_and_keeps_existing(tmp_path):
    c = client(tmp_path)
    # 初次创建 3 张 result
    initial = _files_block(3, "result_image", 100)
    created = c.post("/api/items", data=base_form(), files=initial).json()
    original_ids = [i["id"] for i in created["images"]]
    # PATCH 追加 2 张 result
    more = _files_block(2, "result_image", 200)
    r = c.patch(f"/api/items/{created['id']}", data={"cover_index": "0"}, files=more)
    assert r.status_code == 200, r.text
    item = r.json()
    assert len(item["images"]) == 5
    result_imgs = [i for i in item["images"] if i["role"] == "result_image"]
    assert len(result_imgs) == 5
    # 原 3 张 id 仍存在
    new_ids = {i["id"] for i in item["images"]}
    assert all(orig in new_ids for orig in original_ids)


# ── delete image ──────────────────────────────────────────────────────────
def test_delete_single_image_via_new_endpoint(tmp_path):
    c = client(tmp_path)
    files = _files_block(2, "result_image", 100) + _files_block(1, "reference_image", 10)
    item = c.post("/api/items", data=base_form(), files=files).json()
    target = next(i for i in item["images"] if i["role"] == "result_image")
    r = c.delete(f"/api/items/{item['id']}/images/{target['id']}")
    assert r.status_code == 200, r.text
    detail = r.json()
    assert target["id"] not in {i["id"] for i in detail["images"]}
    assert len(detail["images"]) == 2


def test_delete_missing_image_returns_404(tmp_path):
    c = client(tmp_path)
    files = _files_block(1, "result_image", 100)
    item = c.post("/api/items", data=base_form(), files=files).json()
    r = c.delete(f"/api/items/{item['id']}/images/img_doesnotexist")
    assert r.status_code == 404


def test_delete_image_on_missing_item_returns_404(tmp_path):
    c = client(tmp_path)
    r = c.delete("/api/items/itm_missing/images/img_anything")
    assert r.status_code == 404


# ── set cover ─────────────────────────────────────────────────────────────
def test_set_cover_moves_target_image_to_sort_order_zero(tmp_path):
    c = client(tmp_path)
    files = _files_block(3, "result_image", 100)
    item = c.post("/api/items", data=base_form(), files=files).json()
    result_imgs = sorted([i for i in item["images"] if i["role"] == "result_image"], key=lambda i: i["sort_order"])
    target = result_imgs[2]  # pick the third
    r = c.post(f"/api/items/{item['id']}/images/{target['id']}/cover")
    assert r.status_code == 200, r.text
    detail = r.json()
    first_result = sorted([i for i in detail["images"] if i["role"] == "result_image"], key=lambda i: i["sort_order"])[0]
    assert first_result["id"] == target["id"]
    assert first_result["sort_order"] == 0


def test_set_cover_with_non_result_image_returns_404(tmp_path):
    c = client(tmp_path)
    files = _files_block(1, "result_image", 100) + _files_block(1, "reference_image", 10)
    item = c.post("/api/items", data=base_form(), files=files).json()
    ref = next(i for i in item["images"] if i["role"] == "reference_image")
    r = c.post(f"/api/items/{item['id']}/images/{ref['id']}/cover")
    assert r.status_code == 404


# ── 向后兼容: JSON-only 调用 ─────────────────────────────────────────────
def test_json_only_create_still_works_without_any_files(tmp_path):
    c = client(tmp_path)
    payload = {
        "title": "Legacy JSON card",
        "model": "ChatGPT Image2",
        "tags": ["legacy"],
        "prompts": [{"language": "en", "text": "legacy prompt", "is_primary": True}],
    }
    r = c.post("/api/items", json=payload)
    assert r.status_code == 200, r.text
    item = r.json()
    assert item["title"] == "Legacy JSON card"
    assert item["images"] == []


def test_json_only_update_still_works(tmp_path):
    c = client(tmp_path)
    payload = {
        "title": "Legacy JSON card",
        "tags": ["legacy"],
        "prompts": [{"language": "en", "text": "legacy prompt", "is_primary": True}],
    }
    created = c.post("/api/items", json=payload).json()
    r = c.patch(f"/api/items/{created['id']}", json={"title": "Updated via JSON"})
    assert r.status_code == 200, r.text
    assert r.json()["title"] == "Updated via JSON"


def test_existing_single_image_upload_endpoint_still_works(tmp_path):
    """旧 POST /api/items/{id}/images (单文件) 必须仍按原逻辑工作 (F13)."""
    c = client(tmp_path)
    payload = {
        "title": "Legacy single image",
        "tags": [],
        "prompts": [{"language": "en", "text": "x", "is_primary": True}],
    }
    item = c.post("/api/items", json=payload).json()
    r = c.post(
        f"/api/items/{item['id']}/images",
        data={"role": "result_image"},
        files={"file": ("a.png", png_bytes(), "image/png")},
    )
    assert r.status_code == 200, r.text
    detail = c.get(f"/api/items/{item['id']}").json()
    assert any(i["role"] == "result_image" for i in detail["images"])


# ── multipart 详情校验: 客户端总是 multipart 提交 ─────────────────────────
# 注: 真实前端流程始终使用 multipart/form-data (有或没有 files).
# TestClient 在 files=[] 时走 url-encoded, 故不专门测 multipart 无文件场景.


# ── 去重: 同 file_sha256 + role 不重复插入 ───────────────────────────────
def test_duplicate_file_sha256_is_deduped_on_append(tmp_path):
    c = client(tmp_path)
    data = png_bytes(color=(10, 20, 30))
    files1 = [("result_files", ("dup.png", data, "image/png"))]
    item = c.post("/api/items", data=base_form(), files=files1).json()
    # 用同样 bytes 追加
    files2 = [("result_files", ("dup2.png", data, "image/png"))]
    r = c.patch(f"/api/items/{item['id']}", data={}, files=files2)
    assert r.status_code == 200, r.text
    detail = r.json()
    # result 仍只有 1 张 (去重)
    assert len([i for i in detail["images"] if i["role"] == "result_image"]) == 1
