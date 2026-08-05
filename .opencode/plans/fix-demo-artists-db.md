# Fix: demo artists 500 + Turbopack root warning

## Root cause
- `.env` missing `DATABASE_URL`. `src/lib/prisma.ts` `resolveDatabaseUrl()` falls back to
  `file:./prisma/dev.db` (SQLite), but `prisma/schema.prisma` provider is `postgresql` →
  Prisma rejects `file:` URL with "must start with postgresql://". `resolveDemoUser()`
  throws → `/api/artists?demo=true` 500 → globe select page "Failed to load artists".
- Turbopack walks up for lockfiles, finds stray `/Users/jeet/package-lock.json` (with its
  own `/Users/jeet/package.json`), infers `~` as workspace root, warns.

## DB state verified (read-only SELECTs)
- Postgres 16 running (Homebrew), `orca` DB exists, owner `jeet`, localhost:5432.
- All 37 tables migrated (`20260803075141_init`).
- `demo-user` row exists, `syncStatus='COMPLETE'`.
- 685 artists in catalog.

## Step 1 — `.env` (append)
```env
# Database — Postgres 16 (Homebrew). DB "orca" already migrated + seeded with demo-user.
DATABASE_URL="postgresql://jeet@localhost:5432/orca"
```
Matches `.env.example:24`. No `prisma generate` / migrate / seed needed.

## Step 2 — `next.config.ts` (add turbopack key)
```ts
const nextConfig: NextConfig = {
  // Pin Turbopack root to project dir. Stray /Users/jeet/package-lock.json
  // otherwise makes Turbopack infer ~ as workspace root.
  turbopack: {
    root: process.cwd(),
  },
  // Transpile Three.js ecosystem packages
  ...
```
`process.cwd()` safe — `scripts/dev-all.sh` does `cd "$ROOT"; exec next dev`.

## Step 3 — Verify
Restart dev: `bash scripts/dev-all.sh`.
Open `http://localhost:3000/globe/select?demo=true`.
Expect `GET /api/artists?demo=true` → 200, no Prisma error, no Turbopack root warning.
