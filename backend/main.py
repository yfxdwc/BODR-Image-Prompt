from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from .config import APP_VERSION, resolve_hidden_features, resolve_library_path
from .db import init_db
from .routers import admin as admin_router
from .routers import app_updates, auth as auth_router, clusters, generation_jobs, generation_providers, images, import_drafts, items, llm, products, tags
from .services.generation_queue import PROVIDER_ID as NATIVE_GENERATION_PROVIDER_ID, enqueue_generation_jobs, recover_interrupted_generation_jobs
from .services.import_prompt_cms_products import import_prompt_cms_products

DEFAULT_FRONTEND_DIST_PATH = Path(__file__).resolve().parents[1] / "frontend" / "dist"

FRONTEND_INDEX_CACHE_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
}
FRONTEND_ASSET_CACHE_HEADERS = {"Cache-Control": "no-cache, must-revalidate"}


def frontend_file_response(path: Path, *, is_index: bool, build_id: str | None = None):
    if is_index and build_id:
        # 注入 cache-buster 到 asset URL, 强制任何 CDN/浏览器缓存立即失效
        html = path.read_text(encoding="utf-8")
        import re as _re
        html = _re.sub(r'(/assets/[\w\-\.]+\.(?:js|css))(?!\?)', rf"\1?v={build_id}", html)
        headers = dict(FRONTEND_INDEX_CACHE_HEADERS)
        headers["Content-Type"] = "text/html; charset=utf-8"
        return Response(content=html, headers=headers, media_type="text/html")
    headers = FRONTEND_INDEX_CACHE_HEADERS if is_index else FRONTEND_ASSET_CACHE_HEADERS
    return FileResponse(path, headers=headers)


def create_app(library_path: Path | str | None = None, frontend_dist_path: Path | str | None = None) -> FastAPI:
    library = resolve_library_path(library_path)
    frontend_dist = Path(frontend_dist_path).resolve() if frontend_dist_path is not None else DEFAULT_FRONTEND_DIST_PATH.resolve()
    init_db(library)
    # 2026-07-11 BIP auth/RBAC: bootstrap 第一个 admin (从 INITIAL_ADMIN_* env 读, 只创建一次)
    try:
        from .auth.bootstrap import bootstrap_initial_admin
        bootstrap_initial_admin(library)
    except Exception as exc:  # noqa: BLE001
        print(f"[ipl] auth bootstrap skipped: {exc}", flush=True)
    try:
        import_summary = import_prompt_cms_products(library)
        print(f"[ipl] prompt-cms product import: {import_summary}", flush=True)
    except Exception as exc:  # noqa: BLE001 - never let a CMS outage block ipl startup
        print(f"[ipl] prompt-cms product import skipped: {exc}", flush=True)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        recover_interrupted_generation_jobs(library)
        enqueue_generation_jobs(library, provider=NATIVE_GENERATION_PROVIDER_ID)
        yield

    app = FastAPI(title="BODR Image Prompt", version=APP_VERSION, lifespan=lifespan)
    app.state.library_path = library
    app.state.frontend_dist_path = frontend_dist
    # 2026-07-11: 加上 https://web3091.tooyang.top (cloudflare tunnel) 到 CORS 白名单, 否则 cookie 跨域丢
    # 2026-07-12: web3091 已退役, 仅保留主域名 https://bip.tooyang.top.
    _cors_origins = [
        "http://127.0.0.1:5177", "http://localhost:5177",
        "https://bip.tooyang.top",
    ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(items.router, prefix="/api")
    app.include_router(images.router, prefix="/api")
    app.include_router(clusters.router, prefix="/api")
    app.include_router(tags.router, prefix="/api")
    app.include_router(import_drafts.router, prefix="/api")
    app.include_router(generation_jobs.router, prefix="/api")
    app.include_router(generation_providers.router, prefix="/api")
    app.include_router(app_updates.router, prefix="/api")
    app.include_router(products.router, prefix="/api/v1")
    app.include_router(llm.router, prefix="/api")
    # 2026-07-11 BIP auth/RBAC: auth 路由 (login/register/refresh/logout/me) 公开; admin 路由 admin only
    app.include_router(auth_router.router, prefix="/api")
    app.include_router(admin_router.router, prefix="/api")
    @app.get("/api/health")
    def health(): return {"ok": True, "version": APP_VERSION}
    @app.get("/api/config")
    def config():
        # 2026-07-12 主人拍: 不再暴露 library_path / database_path (泄露服务器文件系统结构, 给攻击者信息收集用).
        # 前端不需要这两个字段 - 想看就用本地设置 / 文件系统.
        return {"version": APP_VERSION, "preferred_prompt_language": "zh_hant", "features": resolve_hidden_features()}
    @app.api_route("/api/{api_path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
    def unknown_api(api_path: str):
        raise HTTPException(status_code=404)
    @app.get("/media/{media_path:path}")
    def media(media_path: str):
        safe_roots = {"originals", "thumbs", "previews", "generation-results"}
        parts = Path(media_path).parts
        if not parts or parts[0] not in safe_roots:
            raise HTTPException(status_code=404)
        candidate = (library / media_path).resolve()
        allowed_root = (library / parts[0]).resolve()
        try:
            candidate.relative_to(allowed_root)
        except ValueError as exc:
            raise HTTPException(status_code=404) from exc
        if not candidate.is_file():
            raise HTTPException(status_code=404)
        return FileResponse(candidate)

    def serve_frontend_path(frontend_path: str = ""):
        if frontend_path == "api" or frontend_path.startswith("api/"):
            raise HTTPException(status_code=404)
        index = frontend_dist / "index.html"
        if not index.is_file():
            raise HTTPException(status_code=404, detail="Frontend build not found. Run `npm run build` first, or use `./scripts/dev.sh` for development.")
        candidate = (frontend_dist / frontend_path).resolve() if frontend_path else index.resolve()
        try:
            candidate.relative_to(frontend_dist)
        except ValueError as exc:
            raise HTTPException(status_code=404) from exc
        is_idx = candidate == index.resolve()
        # build_id 用 dist 目录所有文件的最大 mtime, 任一文件改动都会让 build_id 变, 击穿 CDN/浏览器缓存
        dist_root = index.parent
        try:
            latest = max((p.stat().st_mtime for p in dist_root.rglob('*') if p.is_file()), default=index.stat().st_mtime)
            build_id = str(int(latest))
        except OSError:
            build_id = str(int(index.stat().st_mtime))
        if candidate.is_file():
            return frontend_file_response(candidate, is_index=is_idx, build_id=build_id if is_idx else None)
        return frontend_file_response(index, is_index=True, build_id=build_id)

    @app.get("/")
    def frontend_root():
        return serve_frontend_path()

    @app.get("/{frontend_path:path}")
    def frontend_app(frontend_path: str):
        return serve_frontend_path(frontend_path)
    return app

app = create_app()
