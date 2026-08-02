# ORCA Backend Fix — Deploy & Env Runbook (Part 13)

## Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | yes | Prisma (default sqlite `file:./dev.db`) |
| `NEXTAUTH_SECRET` | yes (prod) | Auth |
| `NEXTAUTH_URL` | yes (prod) | Auth callback base |
| `SPOTIFY_CLIENT_ID` | yes | OAuth Identity only |
| `SPOTIFY_CLIENT_SECRET` | yes | OAuth Identity only |
| `LASTFM_API_KEY` | recommended | Tags / similar (Tier 2) |
| `ORCA_EMBEDDING_URL` | required for real_audio | Sidecar origin (no trailing slash). `services/embedding-sidecar` |
| `ORCA_EMBEDDING_MODEL_ID` | optional | Default `clap-http-v1` |
| `ORCA_EMBEDDING_ALLOW_MOCK` | **never prod** | Test-only mock real_audio |
| `GRE_PERSIST_ON_MATERIALIZE` | optional | Default on; `0` disables product GRE persist (Part 15) |

### Spotify still allowed
- User OAuth: top artists, recently played, library, profile
- Artist metadata search / images

### Spotify forbidden (CI + code guards)
- `/audio-features`
- `/audio-analysis`
- `/recommendations`
- `/related-artists`

## Embedding sidecar (Part 14)

```bash
cd services/embedding-sidecar && pip install -r requirements.txt
ORCA_EMBED_MODE=stub uvicorn app.main:app --port 8080
export ORCA_EMBEDDING_URL=http://127.0.0.1:8080
npm run embeddings:backfill    # resumable
npm run embeddings:coverage    # real_audio_pct=
```

## Deploy checklist

1. `npx prisma db push` (or migrate) on target DB  
2. `npm run typecheck && npm test`  
3. `bash scripts/ci-check.sh`  
4. Set secrets; leave `ORCA_EMBEDDING_ALLOW_MOCK` unset  
5. Deploy embedding sidecar; set `ORCA_EMBEDDING_URL`  
6. `npm run embeddings:backfill` then optional ANN rebuild  
7. `npm run agency:recalibrate` only after durability data — human review weights  


## API surfaces for FE (Part 10+)

| Endpoint | Cold-start / feedback fields |
|----------|------------------------------|
| `POST /api/user/onboarding` | `{ coldStart: true, message }` |
| `GET /api/globe` | `coldStart`, `coldStartReason`, optional `message` |
| `GET /api/user/frontier` | same |
| `POST /api/territory/[key]/reject` | territory-wide suppress |

## Smoke path

1. Onboard with 3 genres → `coldStart: true`  
2. Materialize / regenerate world  
3. Expand / frontier non-empty  
4. Territory reject one genre → that genre suppressed for cooldown  
5. After durable TES → Identity EMA updates `profileData.audioCentroid`  
