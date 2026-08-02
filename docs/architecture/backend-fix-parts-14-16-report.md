# Parts 14–16 Implementation Report

**Date:** 2026-07-12  

## Part 15 — GRE persist on materialize ✅

**Root cause:** `computeGenreRelationships` ran on product path (`buildFrontierNodes`) but `persistGenreRelationships` was **only** called from `/api/debug/genre-relationships`. CUB/next materialize read `UserGenreRelationshipState` and saw stale/default stages.

**Fix:** After GRE compute in `buildFrontierNodes`, call `persistGenreRelationships` (same `userId` / Spotify-id key as CUB). Disable with `GRE_PERSIST_ON_MATERIALIZE=0` only for regression.

**Tests:** `materialize-persist.regression.test.ts`, lifecycle e2e step 7, concurrent GRE persist.

---

## Part 14 — Embedding sidecar ✅

**Model:** CLAP (`clap-http-v1`) — already contracted in Part 1.

| Piece | Location |
|-------|----------|
| Sidecar | `services/embedding-sidecar/` (FastAPI, `/embed` + `/health`) |
| Modes | `ORCA_EMBED_MODE=stub` (CPU default) / `clap` (transformers) |
| Client | `embedPreviewFromService`, `isEmbeddingSidecarReady` soft-fail |
| Backfill | `npm run embeddings:backfill` (resumable checkpoint) |
| Coverage | `npm run embeddings:coverage` + `GET /api/admin/embedding-coverage` |

Fallback when sidecar down: null embed → `tag_inferred` (no request 500).

---

## Part 16 — Postgres readiness (partial cutover) ⚠️

| Done | Residual (needs Docker/host Postgres) |
|------|----------------------------------------|
| `DATABASE_URL` env for Prisma | Flip `provider = "postgresql"` when live |
| `prisma.ts` no longer ignores env | Full data migration via pgloader |
| `docker-compose.yml` Postgres 16 | CI service matrix on Postgres |
| Concurrency smoke tests | Remove SQLite file from prod |
| `docs/architecture/postgres-migration.md` | |

**Honest status:** Schema still `provider = "sqlite"` so local/CI tests keep working without Docker (not available in this environment). App + docs are cutover-ready; production pilot should follow `postgres-migration.md` before multi-user load.

---

## Test count

**143** tests passing (`npm test` + typecheck).

## Ops checklist

1. Run embedding sidecar; set `ORCA_EMBEDDING_URL`  
2. `npm run embeddings:backfill`  
3. Confirm GRE rows after materialize in DB  
4. When ready: `docker compose up -d postgres` → switch provider → migrate  
