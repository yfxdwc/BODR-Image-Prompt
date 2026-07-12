# Operations

This guide covers day-to-day operations for self-hosted BODR Image Prompt installs: ports, environment variables, the daemon, backup/restore, the React hooks invariant, and the upload compression strategy. It complements [`INSTALLATION.md`](INSTALLATION.md) (first-time install) and [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) (symptom → fix recipes).

If you only want to run the app locally, `./scripts/start.sh` or `scripts/appctl.sh` is enough — you probably do not need this file.

## 1. Defaults and `.env`

| Variable | Default | Notes |
|---|---|---|
| `IMAGE_PROMPT_LIBRARY_PATH` | `./library` (dev) or `~/BODRImagePrompt` (installed) | Must contain (or come to contain) `db.sqlite` and the `originals/ thumbs/ previews/` subfolders. |
| `BACKEND_HOST` | `127.0.0.1` | Use `0.0.0.0` only on a trusted LAN host. |
| `BACKEND_PORT` | `8000` (public default) | Anything unused on the host is fine. |
| `FRONTEND_PORT` | matches `BACKEND_PORT` | In production, uvicorn serves the built `frontend/dist` from the same port — no separate frontend server. |
| `BACKUP_DIR` | `./backups` | Where `scripts/backup.sh` writes tarballs. |

Override per-run:

```bash
BACKEND_PORT=8001 ./scripts/dev.sh
IMAGE_PROMPT_LIBRARY_PATH=/media/your-vault ./scripts/start.sh
```

Rules of thumb:

- `.env` is the single source of truth for ports and library path. The `daemon.sh` script reads it before launching uvicorn — change the env file, do not edit the script.
- In dev mode (`npm run dev` / `scripts/dev.sh`), the Vite dev server runs on `FRONTEND_PORT` (default `5173` upstream, see Vite config) and proxies `/api/*` to the backend on `BACKEND_PORT`. In production, there is only one port — uvicorn serves both.
- The same source tree is reused across environments. Do not commit `library/`, `backups/`, or `.venv/`.

## 2. Port topology

The backend listens on a single TCP port (default `8000`). When the production build is active (`scripts/start.sh` or `scripts/appctl.sh start`), uvicorn serves both `/api/*` and the built `frontend/dist/` from that port — there is no second port to expose.

In dev mode you have two ports:

- `BACKEND_PORT` (default `8000`) — FastAPI / uvicorn.
- Vite dev server (default `5173`) — hot-reload UI, proxies `/api/*` to the backend.

If you change `BACKEND_PORT`, remember to update Vite's proxy target in `frontend/vite.config.ts` (or use `VITE_API_BASE` if you have configured one) so the dev UI can reach the backend.

Port-conflict triage:

```bash
ss -tlnp | grep ':8000'                       # who is on the port?
lsof -p <pid> | grep cwd                       # is the PID running from this repo?
curl -s http://127.0.0.1:8000/api/health       # expect {"ok":true,"version":"..."}
```

If something else owns the port, pick a different `BACKEND_PORT` rather than killing the other process. The frontend talks to whatever port the backend listens on; nothing else on the host should depend on a specific port number.

## 3. Start / stop / restart

### 3.1 Quick start (foreground, single session)

```bash
./scripts/setup.sh          # one-time: venv + npm install + initial build
./scripts/start.sh          # build + run uvicorn in foreground
```

`scripts/start.sh` builds the frontend and then runs uvicorn in the foreground — control-C stops it.

### 3.2 Daemon (background, survives shell exit)

For headless / container installs without systemd, use `scripts/daemon.sh`. It performs double-fork + `setsid nohup` and reads `.env` so the daemon always uses the configured port and library path.

```bash
bash scripts/daemon.sh start           # start once, exit when uvicorn is alive
bash scripts/daemon.sh status          # is it healthy?
bash scripts/daemon.sh stop            # graceful kill

# 5-second probe + auto-respawn (replace systemd Restart=always)
setsid nohup bash scripts/daemon.sh watch \
  > .logs/ipl-watch.log 2>&1 < /dev/null &
```

Logs:

- `.logs/ipl.log` — uvicorn access + error
- `.logs/ipl-watch.log` — probe + respawn events

### 3.3 Restart

- Frontend-only changes (`frontend/src/**`) — rebuild (`npm run build`) and uvicorn picks up the new `dist/` automatically because it serves files from disk. No restart needed.
- Backend changes (`backend/**` or migrations) — restart uvicorn (`scripts/daemon.sh restart` or stop + start).

### 3.4 Why not just `nohup uvicorn &`

A bare `nohup uvicorn &` works but does not survive the parent shell cleanly in many sandbox / container setups. `daemon.sh` uses double-fork + `setsid` so the process detaches from the controlling terminal, which is what unattended-host setups need.

## 4. React Hooks invariant (ItemDetailModal and friends)

The item detail modal mounts/unmounts based on a selected item id. All React hooks (`useState`, `useEffect`, `useMemo`, `useRef`, custom hooks) MUST be declared **above** every conditional `return` that depends on `id`.

Violating this rule produces `Minified React error #310 (Rendered fewer hooks than expected)` in production, which manifests as:

- the modal appears to never open (the entire React tree unmounts),
- zero console errors in development,
- minified error #310 only in production builds.

Fix: move the offending `useMemo` / `useState` above every `if (!id) return null` (and any other early returns). Rebuild (`npm run build`) — uvicorn will pick up the new `dist/` without a restart.

This is the single most common frontend crash in this codebase. Treat it as a project-wide invariant, not a one-off bug.

## 5. Database schema and migrations

Migrations live in `backend/migrations/`. The backend runs `init_db()` on every startup, which applies any unapplied migrations in order and records them in `schema_migrations`. You do not need to run them manually.

Rules:

- Never edit an already-shipped migration. Add a new one (`backend/migrations/NNN_*.sql`) instead.
- Adding a new column: create a new migration that does `ALTER TABLE ... ADD COLUMN ...` with a sensible default.
- Removing a column: deprecate in code first, then drop in a later migration once no caller references it.
- The frontend should treat new columns as nullable / optional and degrade gracefully — older libraries do not have the column until they have been migrated.

Cross-process refresh locks (single-writer guarantee when multiple uvicorn workers might touch the DB): SQLite handles this at the file level; the codebase defaults to a single worker (`--workers 1`) to keep the contract simple.

## 6. Backup / restore / rollback

### 6.1 Library-only backup (fast, daily)

`scripts/backup.sh` tars `db.sqlite` + `originals/ thumbs/ previews/` into `BACKUP_DIR/BODR-Image-Prompt-<timestamp>.tar.gz`. Use this for routine safety nets.

### 6.2 Full-project backup (snapshot before risky changes)

Before any `git reset`, bulk refactor, or destructive operation, snapshot the whole tree minus `node_modules`, `.venv`, caches, and `frontend/dist/assets`:

```bash
SNAP=./backups/ipl-pre-rollback-$(date +%Y%m%d-%H%M%S)
mkdir -p "$SNAP"
tar -czf "$SNAP/ipl-full.tar.gz" \
  --exclude=node_modules --exclude=.venv --exclude=__pycache__ \
  --exclude=.pytest_cache --exclude='*.pyc' --exclude='.mypy_cache' \
  --exclude='frontend/dist/assets' \
  backend/ frontend/src/ frontend/dist/index.html \
  scripts/ docs/ tests/ \
  .env .env.example package.json package-lock.json pyproject.toml \
  tsconfig.json vite.config.ts tailwind.config.ts postcss.config.js \
  README*.md ROADMAP.md CONTRIBUTING.md SECURITY.md NOTICE LICENSE \
  sample-data/ library/ header-logo-source.png
```

### 6.3 Restore

```bash
tar -xzf <archive>.tar.gz -C /path/to/repo/        # overwrite working tree
npm run build                                        # rebuild dist/ if backend/ or src/ changed
./scripts/start.sh                                   # foreground verify, then daemon
```

### 6.4 Rollback to a tagged release

Tagged releases on GitHub are the supported rollback target. Download the release tarball, extract it over the working tree (preserving `.env` and `library/`), rebuild, and restart. The versioned installer (`appctl.sh install`) handles this automatically with SHA256 verification.

## 7. Upload compression strategy

Uploads go through `backend/services/image_store.py`, which uses Pillow (no extra C dependencies) to normalize every image into WebP. The frontend controls the on/off toggle via a per-request `compress` form field.

| Input format | Output | Compression | Why |
|---|---|---|---|
| PNG, GIF | WebP lossless | Real pixel-perfect | Preserves transparency; ~20-25% smaller than PNG. |
| JPEG, JPG | WebP q95 | Visually lossless | ~50% smaller; imperceptible at q95. |
| WebP | WebP q95 | Re-encode for uniformity | One canonical format downstream. |

Result: ~80% size reduction on a typical mixed library (measured: 47 MB → 9.7 MB on a 41-image mixed dataset). Original bytes are not recoverable after compression — the toggle exists for users who prefer to keep their originals untouched.

Frontend toggle:

- Config → "Image compression" segmented control (default: **On**).
- Off → backend skips re-encoding and stores the original file bytes + extension as-is.
- Persistence: `localStorage['BODR-Image-Prompt.image_compression.v1']` (`'true'`/`'false'`; any other value counts as on).
- Wired through `App.tsx` → `ProductLibraryView` → `ProductModal` → `api.products.uploadImage(id, file, compress)`.

Anti-patterns:

- Do not store original bytes by default — a single 40 MB photo per product explodes the library footprint.
- Do not pull in oxipng / pngquant / mozjpeg — Pillow already covers the formats we accept.
- Do not switch to AVIF — encode latency is 3-5x and Safari support is recent.

If a future migration needs to recover original bytes, add a one-time backup step (not a code change) and then enable compression on the migrated library.

## 8. Health checks

```bash
curl -s http://127.0.0.1:$BACKEND_PORT/api/health
# expect: {"ok":true,"version":"vX.Y.Z-beta-N-g<sha>-<clean|dirty>"}

curl -sI http://127.0.0.1:$BACKEND_PORT/api/v1/items | head -1
# expect: HTTP/1.1 200 OK

curl -sI http://127.0.0.1:$BACKEND_PORT/media/db.sqlite
# expect: HTTP/1.1 404 Not Found  (the DB must never be served)
```

If any of those fail, see [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).

## 9. See also

- [`INSTALLATION.md`](INSTALLATION.md) — first-time setup
- [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) — symptom → fix recipes
- [`PROJECT_STATUS.md`](PROJECT_STATUS.md) — public-safe maintainer log and feature status
- [`../CONTRIBUTING.md`](../CONTRIBUTING.md) — contribution policy

## 10. Authentication and roles (2026-07-11)

BIP ships with a built-in authentication / RBAC layer. All state lives in the same `library/db.sqlite` (migrations 019–023: `users`, `registration_requests`, `sessions`, `audit_log`, plus `owner_id` columns on existing tables). No new database or file paths.

### Roles

| Role | Can browse | Can favorite | Can copy prompt | Can edit/upload/generate | Admin actions |
|---|---|---|---|---|---|
| `admin` | yes | yes | yes | yes | yes |
| `user` | yes | yes | yes | no | no |
| `pending` | no (403 on login) | — | — | — | — |
| `rejected` | no (403 on login) | — | — | — | — |

### Initial admin bootstrap

The very first time the backend starts with **no admin** in the `users` table, it reads these `.env` variables and creates the first admin automatically:

```
INITIAL_ADMIN_EMAIL=admin@tooyang.top
INITIAL_ADMIN_USERNAME=admin
INITIAL_ADMIN_PASSWORD=<strong password>
INITIAL_ADMIN_DISPLAY_NAME=Admin  # optional
```

If any of those is missing or the password is shorter than 8 chars, bootstrap is skipped (with a log line). If an admin already exists, the env values are ignored — you cannot re-bootstrap.

The log line is `[ipl] auth: bootstrapped initial admin 'admin' (admin@tooyang.top)`. If you do not see this on first start, your `INITIAL_ADMIN_*` env was not honored — check `.env` and restart.

### Public vs protected routes

| Path | Required |
|---|---|
| `GET /api/health`, `GET /api/config` | public |
| `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`, `GET /api/auth/me` | public |
| `GET /api/items*`, `GET /api/v1/products*`, `GET /api/clusters`, `GET /api/tags`, `GET /api/import-drafts*`, `GET /media/*` | `user` or `admin` |
| `POST/PUT/PATCH/DELETE` on items, products, images, clusters, import_drafts, generation_jobs, generation_providers, llm, app-update | `admin` only |
| `GET /api/admin/*`, `POST /api/admin/*` | `admin` only |

To temporarily disable auth on reads (debug only), set `ALLOW_ANONYMOUS_READ=true` in `.env` and restart.

### Cookies

`bip_access` (1h) and `bip_refresh` (30d) are HttpOnly + SameSite=Lax. `Secure` is auto-enabled when `BACKEND_HOST` is not `127.0.0.1` / `localhost`. Override with `AUTH_COOKIE_SECURE=true|false|auto` in `.env`.

`backend/auth/tokens.py` rotates refresh tokens on every `/api/auth/refresh` call (old one revoked in the same transaction). Logout deletes the server-side session row — the JWT becomes invalid immediately, even if it has not expired.

### Registration workflow

1. Anonymous visitor opens the app → no cookie → frontend redirects to login.
2. Visitor clicks "申请账号" → submits email / username / password / reason.
3. Backend creates a `users` row with `role='pending'` and a matching `registration_requests` row with `status='pending'`. **No token is issued**; the visitor sees a "waiting for approval" page.
4. Admin logs in → opens the admin page → sees the pending queue → clicks Approve or Reject.
5. On Approve, `users.role='user'`, `registration_requests.status='approved'`. The newly approved user can now log in.
6. On Reject, `users.role='rejected'`, the reason is recorded. They cannot log in again.

### Audit log

`audit_log` captures `login`, `login_failed`, `login_blocked`, `logout`, `token_refresh`, `register_request`, `approve_user`, `reject_user`, `admin_create_user`, `admin_set_role`, `admin_delete_user`, `bootstrap_initial_admin`. Inspect via `GET /api/admin/audit?limit=200&offset=0` (admin only).

Expired sessions are cleaned on startup (`scripts/daemon.sh restart` triggers `init_db()` which does not currently auto-clean; see follow-ups). To clean now:

```bash
sqlite3 library/db.sqlite "DELETE FROM sessions WHERE refresh_expires_at < datetime('now');"
```

Audit rows older than 90 days can be trimmed similarly; nothing prunes automatically yet (follow-up).

### Reset admin (emergency only)

If you lock yourself out:

```bash
# Stop the daemon first
bash scripts/daemon.sh stop

# Pick a new admin (existing user becomes admin):
.venv/bin/python -c "
import sqlite3
c = sqlite3.connect('library/db.sqlite')
c.execute(\"UPDATE users SET role='admin', approved_at=datetime('now') WHERE username='admin'\")
c.commit()
print('promoted')
"

# Or delete all admin rows to re-trigger bootstrap on next start (with new INITIAL_ADMIN_PASSWORD):
.venv/bin/python -c "
import sqlite3
c = sqlite3.connect('library/db.sqlite')
c.execute(\"DELETE FROM users WHERE role='admin'\")
c.commit()
"

# Also clear sessions so old tokens don't linger:
.venv/bin/python -c "
import sqlite3
c = sqlite3.connect('library/db.sqlite')
c.execute(\"DELETE FROM sessions\")
c.commit()
"

bash scripts/daemon.sh start
```

This is a manual recovery path — there is no "forgot password" UI yet. Follow-up: add an admin-only "reset user password" endpoint and an email-based recovery link.
