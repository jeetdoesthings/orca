#!/usr/bin/env bash
# Start the ORCA embedding sidecar (CLAP / stub) on port 8080.
# Creates a local venv under services/embedding-sidecar/.venv if needed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SIDECAR_DIR="$ROOT/services/embedding-sidecar"
PORT="${ORCA_EMBED_PORT:-8080}"
MODE="${ORCA_EMBED_MODE:-stub}"
HOST="${ORCA_EMBED_HOST:-127.0.0.1}"

cd "$SIDECAR_DIR"

# If something already answers /health, reuse it (don't double-bind).
if curl -sf "http://${HOST}:${PORT}/health" >/dev/null 2>&1; then
  echo "[sidecar] already healthy at http://${HOST}:${PORT} — skipping start"
  # Stay alive so parent process managers that track this PID keep a handle.
  # Exit 0 would make concurrent launchers think the sidecar died.
  while curl -sf "http://${HOST}:${PORT}/health" >/dev/null 2>&1; do
    sleep 30
  done
  echo "[sidecar] health lost; exiting"
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "[sidecar] python3 not found — install Python 3 to run embeddings" >&2
  exit 1
fi

if [ ! -d .venv ]; then
  echo "[sidecar] creating venv + installing requirements (first run)…"
  python3 -m venv .venv
  # shellcheck disable=SC1091
  source .venv/bin/activate
  pip install -q -r requirements.txt
else
  # shellcheck disable=SC1091
  source .venv/bin/activate
fi

export ORCA_EMBED_MODE="$MODE"
echo "[sidecar] starting mode=${MODE} on http://${HOST}:${PORT} (health: /health)"
exec python -m uvicorn app.main:app --host "$HOST" --port "$PORT"
