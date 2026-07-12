# Troubleshooting

## `./scripts/start.sh` cannot find Python dependencies

Run setup first:

```bash
./scripts/setup.sh
```

Then restart:

```bash
./scripts/start.sh
```

## Port already in use

For source/development mode, change `.env`:

```bash
BACKEND_PORT=8001
FRONTEND_PORT=5178
```

Then restart the app.

For installed release mode, start on a different port:

```bash
BODR-Image-Prompt start --port 8001
```

To find out who is on the port:

```bash
ss -tlnp | grep ':8000'
lsof -p <pid> | grep cwd
curl -s http://127.0.0.1:8000/api/health
```

If the owner is another application, pick a different `BACKEND_PORT` rather than killing the other process.

## Empty library after first start

That is expected for a fresh install. Click `+ Add` to create your first prompt card, or install the optional sample library if you want demo content first:

```bash
BODR-Image-Prompt sample-data en
```

## Images or database missing after moving folders

Check `IMAGE_PROMPT_LIBRARY_PATH` in `.env` or the installed app configuration. Your database and image folders must stay together.

## Command not found after install

If `BODR-Image-Prompt` is not found, add `~/.local/bin` to your shell `PATH`, or use the fallback command printed by the installer:

```bash
~/.BODR-Image-Prompt/app/current/scripts/appctl.sh start
```

## LAN access does not work

By default, the app binds to `127.0.0.1`, which is local to the machine. For LAN access, explicitly bind to `0.0.0.0` only on a trusted machine/network:

```bash
BODR-Image-Prompt start --host 0.0.0.0
```

Then check your OS firewall and router/VPN settings.

## Detail modal does not open / entire UI unmounts (React #310)

Symptom: clicking a card in the library appears to do nothing. In development, the console may be silent; in production, the browser may show a minified `Minified React error #310 (Rendered fewer hooks than expected)` message.

Root cause: a React hook (`useState`, `useEffect`, `useMemo`, `useRef`) is declared **after** a conditional `return` in a component that mounts/unmounts based on a prop (typically `id`).

Fix: move the offending hook above every `if (!id) return null` (and any other early returns), then `npm run build`. See [`OPERATIONS.md`](OPERATIONS.md) §4 for the project-wide invariant.

## Frontend changes do not show up in the browser

- Did you `npm run build`? uvicorn serves `frontend/dist/` from disk — source edits only become visible after a build.
- Build succeeded but browser still shows old UI → hard refresh (Ctrl/Cmd-Shift-R), or `rm -rf frontend/node_modules/.vite` if you are in dev mode.
- Restored a tarball but did not rebuild → run `npm run build` after `tar -xzf`.

## Backend refuses to start: `no such column` / schema errors

The backend runs `init_db()` on every startup, which applies any unapplied migrations from `backend/migrations/`. If startup fails with a column error:

1. Make sure the latest migrations have been pulled (no stale working tree).
2. Do not hand-edit `library/db.sqlite`. If you need to change schema, add a new migration under `backend/migrations/NNN_*.sql` and let the backend apply it.
3. If the database is corrupt (rare), restore from `scripts/backup.sh` output.

See [`OPERATIONS.md`](OPERATIONS.md) §5 for the migration rules.

## `npm run build` fails but `tsc --noEmit` is clean

Clear the Vite cache and rebuild:

```bash
rm -rf frontend/node_modules/.vite
cd frontend && npm run build
```

If `tsc --noEmit` itself fails, the error is a real type error — read the file:line output and fix it before rebuilding.

## Library/database accidentally wiped or restored from old snapshot

The library directory and the SQLite database live under the same path (`IMAGE_PROMPT_LIBRARY_PATH`). They must move together — if you only restored `db.sqlite` and not the `originals/ thumbs/ previews/` folders (or vice versa), images will reference missing files.

`scripts/backup.sh` tars them together. For restore, see [`OPERATIONS.md`](OPERATIONS.md) §6.3.

## File-path casing issues when moving the install

On case-sensitive filesystems (Linux), moving the project between directories that differ only in case (e.g. `BODR-Image-Prompt` vs `BODRImagePrompt`) silently breaks paths inside the database and `.env`. Always use a single canonical directory name and update `.env` if the absolute path changes.

## Daemon: process exits unexpectedly

If `scripts/daemon.sh status` reports DOWN but the log shows the process was killed:

- Check `.logs/ipl.log` for the last traceback.
- Use `scripts/daemon.sh watch` (run under `setsid nohup`) for auto-respawn — that replaces the systemd `Restart=always` semantics in container environments where systemd is not available.
