# Part 16 — SQLite → Postgres cutover

## Why

SQLite single-writer limits concurrent Durability appends, GRE upserts, and embedding writes. Managed Postgres is required before multi-user pilot.

## What does **not** change

Table shapes, confidence tags, TES immutability (app-level), GRE 7-state, Agency drafts.

## Steps

### 1. Stand up Postgres

```bash
docker compose up -d postgres
export DATABASE_URL=postgresql://orca:orca@localhost:5432/orca
```

Managed options: Neon, Supabase, Railway — same `DATABASE_URL` shape.

### 2. Switch Prisma provider

In `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

```bash
npx prisma generate
npx prisma db push
```

### 3. Migrate data

**Option A — re-seed (cleanest for early pilots):**

```bash
npm run seed:artists
npm run embeddings:backfill
```

**Option B — pgloader from existing SQLite file:**

```bash
pgloader prisma/dev.db postgresql://orca:orca@localhost:5432/orca
npx tsx scripts/migrate-sqlite-to-postgres.ts  # row-count + TES spot-check
```

### 4. App config

`src/lib/prisma.ts` already uses `DATABASE_URL` (Part 16). No hard-coded sqlite path when env is set.

### 5. Immutability (optional DB enforcement)

App still owns TES immutability. Optional Postgres:

```sql
-- Example: deny UPDATE on tes_snapshot component columns via trigger (ops)
```

### 6. CI

```yaml
# GitHub Actions sketch
services:
  postgres:
    image: postgres:16
    env:
      POSTGRES_USER: orca
      POSTGRES_PASSWORD: orca
      POSTGRES_DB: orca
env:
  DATABASE_URL: postgresql://orca:orca@localhost:5432/orca
```

Then `npx prisma db push && npm run ci`.

### 7. Remove SQLite

After cutover verified:

- Delete `prisma/dev.db` from deploys
- Ensure no `file:` DATABASE_URL in prod
- Schema `provider = "postgresql"` only

## Territory graph cache note

All-pairs shortest paths are **in-process memory** (`territory-graph/shortest-path.ts`). Multi-instance deploys may need shared cache later (Redis) — out of scope for Part 16; flag only.

## Concurrent writes

`persistGenreRelationships` already uses `$transaction` upserts. DurabilityEvent is append-only creates. Both behave correctly under Postgres MVCC; SQLite serialized writers may have hidden races — re-run GRE concurrent tests against Postgres after cutover.
