#!/usr/bin/env bash
# Run production Next.js.
# Embedding sidecar is DEPRECATED (audio_distance dropped — four-axis model).
# Set ORCA_START_EMBEDDING_SIDECAR=1 only for offline embed experiments.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
unset ORCA_EMBEDDING_URL 2>/dev/null || true

SIDECAR_PID=""

cleanup() {
  if [ -n "${SIDECAR_PID}" ] && kill -0 "$SIDECAR_PID" 2>/dev/null; then
    echo "[start-all] stopping optional sidecar pid=${SIDECAR_PID}"
    kill "$SIDECAR_PID" 2>/dev/null || true
    wait "$SIDECAR_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if [ "${ORCA_START_EMBEDDING_SIDECAR:-0}" = "1" ]; then
  export ORCA_EMBEDDING_URL="${ORCA_EMBEDDING_URL:-http://127.0.0.1:8080}"
  export ORCA_EMBED_MODE="${ORCA_EMBED_MODE:-stub}"
  echo "[start-all] optional embedding sidecar enabled (deprecated path)"
  bash "$ROOT/scripts/run-embedding-sidecar.sh" &
  SIDECAR_PID=$!
else
  echo "[start-all] four-axis EI — embedding sidecar not started (deprecated)"
fi

cd "$ROOT"
if [ -x "$ROOT/node_modules/.bin/next" ]; then
  exec "$ROOT/node_modules/.bin/next" start "$@"
fi
exec npx next start "$@"
