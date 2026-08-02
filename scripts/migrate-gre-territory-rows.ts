/**
 * scripts/migrate-gre-territory-rows.ts
 * ---------------------------------------------------------------------------
 * Phase 2 P0-2 cleanup: detect and optionally remove stale GRE-written rows
 * from `userTerritoryRelationship`.
 *
 * WHY THIS EXISTS
 * ---------------
 * Before Phase 2 P0-2, GRE's persistence layer wrote into
 * `userTerritoryRelationship` keyed by RAW genre strings ('house', 'techno',
 * etc.), while Layer 6 wrote the same table keyed by `Territory_v2_*` ids.
 * P0-2 (Option C.ii) retargets GRE to its own `UserGenreRelationshipState`
 * table, leaving any pre-existing GRE rows in `userTerritoryRelationship`
 * as stale data that downstream readers (Layer 7/8, globe route) can no
 * longer interpret correctly.
 *
 * This script finds those stale rows (territoryId NOT matching
 * `Territory_v2_*`) and either reports them (default) or deletes them
 * (`--apply`). It is the ONLY destructive step in P0-2.
 *
 * SAFETY
 * ------
 * - Default mode is REPORT-ONLY. No rows are deleted unless `--apply` is passed.
 * - Layer 6 rows (territoryId LIKE 'Territory_v2_%') are NEVER touched.
 * - Idempotent: re-running after `--apply` reports zero stale rows.
 *
 * USAGE
 * -----
 *   npx tsx scripts/migrate-gre-territory-rows.ts              # report only
 *   npx tsx scripts/migrate-gre-territory-rows.ts --apply      # delete stale rows
 *
 * ---------------------------------------------------------------------------
 */
import { prisma } from '../src/lib/prisma';

function parseArgs(): { apply: boolean } {
  const argv = process.argv.slice(2);
  return { apply: argv.includes('--apply') };
}

async function main() {
  const { apply } = parseArgs();

  console.log(`[migrate-gre-territory-rows] mode: ${apply ? 'APPLY (destructive)' : 'REPORT-ONLY'}`);
  console.log('');

  // Stale rows = territoryId does NOT start with 'Territory_v2_'. These are the
  // raw-genre-keyed rows GRE wrote before the P0-2 retarget.
  const staleRows = await (prisma as any).userTerritoryRelationship.findMany({
    where: { territoryId: { not: { startsWith: 'Territory_v2_' } } },
    select: { id: true, userId: true, territoryId: true, currentState: true, stateConfidence: true, lastUpdatedAt: true },
  });

  if (staleRows.length === 0) {
    console.log('[migrate-gre-territory-rows] ✓ no stale GRE rows found. userTerritoryRelationship is clean.');
    return;
  }

  console.log(`[migrate-gre-territory-rows] ⚠ found ${staleRows.length} stale GRE row(s):`);
  for (const row of staleRows) {
    console.log(`    userId=${row.userId} territoryId="${row.territoryId}" currentState="${row.currentState}" stateConfidence=${row.stateConfidence} lastUpdatedAt=${row.lastUpdatedAt.toISOString()}`);
  }

  // Group by distinct territoryId (raw genre) for a summary
  const byGenre = new Map<string, number>();
  for (const row of staleRows) {
    byGenre.set(row.territoryId, (byGenre.get(row.territoryId) || 0) + 1);
  }
  console.log('');
  console.log(`[migrate-gre-territory-rows] stale rows by genre:`);
  for (const [genre, count] of byGenre) {
    console.log(`    ${genre}: ${count}`);
  }

  if (!apply) {
    console.log('');
    console.log('[migrate-gre-territory-rows] REPORT-ONLY. To delete these rows, re-run with --apply.');
    console.log('[migrate-gre-territory-rows] Layer 6 rows (Territory_v2_*) are never touched.');
    return;
  }

  // Destructive: delete the stale rows. Layer 6 rows are excluded by the
  // `not startsWith` filter above.
  const deleted = await (prisma as any).userTerritoryRelationship.deleteMany({
    where: { territoryId: { not: { startsWith: 'Territory_v2_' } } },
  });
  console.log('');
  console.log(`[migrate-gre-territory-rows] ✓ deleted ${deleted.count} stale row(s). userTerritoryRelationship now contains only Layer 6 rows.`);
}

main()
  .catch((err) => {
    console.error('[migrate-gre-territory-rows] FATAL:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
