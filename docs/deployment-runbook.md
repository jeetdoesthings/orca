# ORCA Production Deployment Runbook

This app is a Next.js + Prisma + **PostgreSQL** application. It runs on Vercel.

## Required Vercel environment variables

Set these in Vercel → Project → Settings → Environment Variables:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | **Yes** | `postgresql://user:pass@host:5432/orca?sslmode=require` (Vercel Postgres / Neon / Supabase) |
| `NEXTAUTH_SECRET` | **Yes** | Generate: `openssl rand -base64 32`. The app now **throws** at startup if missing. |
| `NEXTAUTH_URL` | Yes (prod) | Your Vercel deployment URL, e.g. `https://orca.vercel.app`. Falls back to `VERCEL_URL` when unset. |
| `SPOTIFY_CLIENT_ID` | **Yes** | Spotify Developer Dashboard app |
| `SPOTIFY_CLIENT_SECRET` | **Yes** | Rotate — the old one is public in git history |
| `LASTFM_API_KEY` | No | Last.fm lookups degrade gracefully without it |
| `ADMIN_SECRET` | No | Enables `/api/admin/*`. Leave unset to keep admin endpoints locked. |
| `GEMINI_API_KEY` | No | LLM explanations. Without it, deterministic fallback is used (still works). |
| `ENABLE_DEMO` | No | **Keep `0` in production.** Demo endpoints are unauthenticated by design. |

## Deploy steps

1. **Create the database**: provision Postgres (Vercel Postgres or Neon), copy the URL.
2. **Run migrations** (from your machine, pointing at the prod DB):
   ```bash
   DATABASE_URL="postgresql://..." npx prisma migrate deploy
   ```
   `prisma/migrations/` is committed; Vercel's build runs `prisma generate` automatically via `vercel.json` / `package.json`.
3. **Seed the catalog** (required — the frontier pipeline reads the Artist table):
   ```bash
   DATABASE_URL="postgresql://..." npm run seed:artists
   ```
   Or run the SQLite→Postgres copy if you're migrating an existing SQLite DB:
   ```bash
   DATABASE_URL="postgresql://..." node scripts/sqlite-to-pg.mjs
   ```
4. **Set env vars** (table above), then deploy. Vercel auto-builds from the `vercel/install-vercel-web-analytics-i-fiawoy` branch (kept rebased onto `main`).
5. **Smoke test**: open the app → Spotify login → sync. The globe should load with three tiers.

## After deploy

- **Key rotation**: rotate the leaked Spotify/Last.fm/Gemini keys and update the env vars.
- **Embedding sidecar**: the local CLAP embedding sidecar (Python, port 8080) does NOT run on Vercel. Audio features fall back to metadata-only. This is by design; the four-axis distance model is metadata-based.
- **Long pipelines**: `maxDuration=300` is configured per-route in `vercel.json` (needs Vercel Pro). On Hobby (60s cap) the long sync/regenerate calls may time out — upgrade or reduce scope.

## Local development (Postgres)

```bash
# Option A: Homebrew
brew install postgresql@16 && brew services start postgresql@16 && createdb orca

# Option B: Docker
docker compose up -d

export DATABASE_URL="postgresql://jeet@localhost:5432/orca"
npm run db:push   # or: npx prisma migrate dev
npm run dev
```

SQLite fallback: only if you temporarily switch `provider = "sqlite"` in `prisma/schema.prisma` and set `DATABASE_URL="file:./prisma/dev.db"`. Prisma does not support dual providers.
