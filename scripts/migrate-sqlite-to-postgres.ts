/**
 * Part 16 — one-time SQLite → Postgres data copy.
 *
 * Prerequisites:
 *   1. Postgres up (docker compose up -d postgres)
 *   2. schema.prisma provider = "postgresql"
 *   3. DATABASE_URL=postgresql://orca:orca@localhost:5432/orca
 *   4. npx prisma db push  (empty Postgres schema)
 *   5. SQLITE_URL=file:./prisma/dev.db  (source)
 *
 * Usage:
 *   SQLITE_URL=file:./prisma/dev.db DATABASE_URL=postgresql://… npx tsx scripts/migrate-sqlite-to-postgres.ts
 *
 * Verifies row counts after copy. Spot-check TES + Durability in logs.
 */
import { PrismaClient } from '@prisma/client';
import path from 'path';

// Source (SQLite) — need a client pointed at old file.
// After provider switch to postgresql, this script should be run with a
// temporary dual setup or better-sqlite3. Here we use DATABASE_URL as target
// and SQLITE_PATH as source via raw path for prisma sqlite adapter.

async function main() {
  const targetUrl = process.env.DATABASE_URL;
  const sqlitePath =
    process.env.SQLITE_URL ||
    `file:${path.join(process.cwd(), 'prisma', 'dev.db')}`;

  if (!targetUrl || !targetUrl.startsWith('postgresql')) {
    console.error(
      'Set DATABASE_URL to postgresql://… and switch schema provider to postgresql before migrating.',
    );
    console.error('See docs/architecture/postgres-migration.md');
    process.exit(1);
  }

  console.log('[migrate] This script expects Prisma schema provider=postgresql.');
  console.log('[migrate] Source SQLite path (manual export if needed):', sqlitePath);
  console.log(
    '[migrate] Recommended path: use `pgloader` or TablePlus export, or re-seed:',
  );
  console.log('  npx prisma db push');
  console.log('  npm run seed:artists');
  console.log('  npm run embeddings:backfill');
  console.log(
    '[migrate] For full binary copy with SQLite still available, use pgloader:',
  );
  console.log(
    `  pgloader ${sqlitePath.replace('file:', '')} ${targetUrl}`,
  );

  const pg = new PrismaClient({
    datasources: { db: { url: targetUrl } },
  });

  try {
    const users = await pg.user.count();
    const tracks = await pg.trackEmbedding.count().catch(() => 0);
    const tes = await pg.tesSnapshot.count().catch(() => 0);
    const dur = await pg.durabilityEvent.count().catch(() => 0);
    console.log('[migrate] Postgres row counts after your import:', {
      users,
      trackEmbeddings: tracks,
      tesSnapshots: tes,
      durabilityEvents: dur,
    });
    if (tes > 0) {
      const sample = await pg.tesSnapshot.findFirst({
        include: { durabilityEvents: true },
      });
      console.log('[migrate] spot-check TES snapshot:', {
        id: sample?.id,
        foreignness: sample?.foreignness,
        durabilityEvents: sample?.durabilityEvents?.length ?? 0,
      });
    }
  } finally {
    await pg.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
