#!/usr/bin/env bash
# Part 13 — CI gate before deploy
set -euo pipefail
cd "$(dirname "$0")/.."

echo "[ci] typecheck..."
npm run typecheck

echo "[ci] unit + integration tests..."
npm test

echo "[ci] forbidden Spotify catalog endpoints (ripgrep)..."
# Fail if product code still constructs live fetch to dead endpoints.
# Exclude tests/docs (forbidlist test mentions path strings by design).
if rg -n --glob '!**/node_modules/**' --glob '!**/*.md' --glob '!**/__tests__/**' \
  'spotifyFetch\([^)]*audio-features|fetch\([^)]*related-artists|fetch\([^)]*audio-features|fetch\([^)]*audio-analysis|api\.spotify\.com/v1/recommendations' \
  src 2>/dev/null; then
  echo "[ci] FAIL: forbidden Spotify catalog call pattern found"
  exit 1
fi

echo "[ci] OK"
