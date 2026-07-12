#!/usr/bin/env bash
# BODR Image Prompt daemon — start / stop / status (双 fork 守护 + 5s 探活)
# 替代 systemd（容器环境无 systemd bus）
#
# 配置: 读 .env 文件 (单一真相源) — 改端口/路径改 .env
# 用法: ./scripts/daemon.sh {start|stop|status|watch}
set -euo pipefail
IPL_ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$IPL_ROOT"

# 从 .env 读 PORT / IMAGE_PROMPT_LIBRARY_PATH (如果存在)
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi
# 端口默认 3091, 库路径默认 ./library
PORT=${BACKEND_PORT:-3091}
LIBRARY_PATH=${IMAGE_PROMPT_LIBRARY_PATH:-$IPL_ROOT/library}

VENV=$IPL_ROOT/.venv
LOG=$IPL_ROOT/.logs/ipl.log
mkdir -p "$(dirname "$LOG")"

start_one() {
  BACKEND_PORT=$PORT IMAGE_PROMPT_LIBRARY_PATH=$LIBRARY_PATH \
    setsid nohup "$VENV/bin/python3" -m uvicorn backend.main:app \
    --host 0.0.0.0 --port "$PORT" --workers 1 \
    >> "$LOG" 2>&1 < /dev/null &
  disown
}

is_alive() {
  curl -s -m 2 -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/api/health" 2>/dev/null | grep -q "200"
}

case "${1:-status}" in
  start)
    if is_alive; then echo "[ipl] already running on :$PORT"; exit 0; fi
    start_one
    for i in 1 2 3 4 5 6 7 8 9 10; do
      sleep 1
      if is_alive; then echo "[ipl] started on :$PORT (took ${i}s)"; exit 0; fi
    done
    echo "[ipl] FAILED to start in 10s — check $LOG"; tail -20 "$LOG"; exit 1
    ;;
  stop)
    pids=$(pgrep -f "uvicorn backend.main:app --host 0.0.0.0 --port $PORT" || true)
    if [ -n "$pids" ]; then echo "$pids" | xargs kill && echo "[ipl] stopped"; else echo "[ipl] not running"; fi
    ;;
  status)
    if is_alive; then echo "[ipl] alive on :$PORT (pid $(pgrep -f 'uvicorn backend.main:app --host 0.0.0.0 --port $PORT' | head -1))"; exit 0
    else echo "[ipl] DOWN on :$PORT"; exit 1
    fi
    ;;
  watch)
    # 5s 探活, 挂掉自拉 (替代 systemd Restart=always)
    while true; do
      if ! is_alive; then
        echo "[ipl $(date +%H:%M:%S)] DOWN, restarting..." >> "$LOG"
        start_one
        for i in 1 2 3 4 5 6 7 8 9 10; do
          sleep 1
          is_alive && break
        done
      fi
      sleep 5
    done
    ;;
  *)
    echo "Usage: $0 {start|stop|status|watch}"; exit 2
    ;;
esac
