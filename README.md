# ORCA — Exploring an Ocean of Sound

ORCA is a music discovery platform built around a 3D "taste globe": your Spotify listening history becomes a navigable sphere of artist nodes, and a backend recommendation pipeline continuously surfaces a frontier of artists worth exploring.

**Stack:** Next.js 16 (App Router) · React 19 · Three.js / React Three Fiber / d3-force-3d · Prisma (SQLite dev, Postgres migration planned) · NextAuth (Spotify OAuth) · FastAPI CLAP embedding sidecar · Vitest.

---

## How it works

1. **Sync** — sign in with Spotify; `POST /api/user/sync` pulls top artists, recently played, and saved tracks into `User.globeData` (the explored taste graph) with listen weights and per-artist audio signatures.
2. **Pipeline** — `POST /api/world/regenerate` (or any explore/integrate/ignore/reject action) runs the sole materializer `materializeWorld`: candidate retrieval (local catalog, Last.fm, MusicBrainz), GRE genre-relationship state, expansion-distance scoring, a Gemini LLM recommendation pass with deterministic fallback + grounding, and anti-hallucination filtering.
3. **Globe** — `GET /api/globe` is a pure projection of the materialized world (never rebuilds). The client polls with `?version=` to pick up deltas and drives progressive expansion via `POST /api/orca/expand`.

Architecture docs (pipeline order, ownership, config inventory): `docs/architecture/`.

## Development

```bash
cp .env.example .env   # fill in Spotify + Last.fm keys; ENABLE_DEMO=1 for the demo user
npm install
npm run dev            # starts Next + the embedding sidecar
npm test               # vitest (hermetic, offline-safe)
npm run typecheck
npm run ci             # typecheck + tests + forbidden-endpoint guard
```

### Environment variables (see `.env.example`)

| Var | Purpose |
|---|---|
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | Spotify OAuth + metadata lookups |
| `LASTFM_API_KEY` | Last.fm similar-artist / tag / bio lookups |
| `NEXTAUTH_URL` / `NEXTAUTH_SECRET` | NextAuth |
| `GEMINI_API_KEY` | LLM recommendation pass (deterministic fallback when unset) |
| `ENABLE_DEMO` | Gate for unauthenticated `?demo=true` routes; keep off in production |
| `DATABASE_URL` | `file:./prisma/dev.db` locally; Postgres after schema cutover |
| `ORCA_EMBEDDING_URL` | CLAP embedding sidecar (auto-started by `npm run dev`) |
| `ADMIN_SECRET` | Bearer token for `/api/admin/*` |

## License

MIT
