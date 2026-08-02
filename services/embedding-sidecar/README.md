# Embedding Sidecar — **DEPRECATED** (disconnected from live pipeline)

**As of four-axis EI change:** the Next app no longer starts or requires this
service for materialize, scoring, or globe projection. `audio_distance` was
dropped; Expansion Intelligence uses territory / scene / era / language only.

This Python service remains in-repo for offline embedding experiments only.

## Do not assume it is live

- `npm run dev` / `npm start` do **not** start the sidecar by default.
- Unset `ORCA_EMBEDDING_URL` for normal product work.
- Optional: `ORCA_START_EMBEDDING_SIDECAR=1` to run it for backfill scripts.

## Historical contract

```http
POST /embed
{ "previewUrl": "…", "modelId": "clap-http-v1" }
→ { "vector": [float, …], "dim": 512, "modelId": "clap-http-v1" }

GET /health → { "ok": true, … }
```
