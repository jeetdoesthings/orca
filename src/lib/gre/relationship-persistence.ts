import { prisma } from '@/lib/prisma';
import type { GenreRelationship } from './gre-types';

/**
 * Persistence layer for GRE snapshots.
 *
 * Phase 2 P0-2 (Option C.ii) — this function now writes to the dedicated
 * `UserGenreRelationshipState` table (keyed by raw genre string, GRE's 7-state
 * vocabulary) instead of polluting `UserTerritoryRelationship` (which is now
 * owned solely by Profile Layer 6 with its 10-state vocabulary).
 *
 * Consequences of the retarget:
 *   - GRE no longer writes `RelationshipTransition` or `RelationshipExplanation`
 *     (those shared tables are now Layer-6-only). If a genre-level transition
 *     log is wanted in future, add a dedicated `GenreRelationshipTransition`
 *     table; for now GRE's previous stage is captured on the state row itself
 *     via `previousStage`.
 *   - CUB (`cub.ts:184-223`) and GRE compute (`gre.ts:41`) retarget their reads
 *     to `userGenreRelationshipState` in lockstep — see those files.
 *
 * Callers (Part 15):
 *   - Product: `buildFrontierNodes` after `computeGenreRelationships` (materialize path)
 *   - Debug: `api/debug/genre-relationships`
 * Disable product persist with env `GRE_PERSIST_ON_MATERIALIZE=0` (regression only).
 *
 * Canonical store: `UserGenreRelationshipState` only. Same userId key as CUB/GRE
 * compute (pipeline uses Spotify id). Layer 6 territory table is never written here.
 *
 * See docs/architecture/decisions/gre-vs-layer6.md for the full rationale.
 */
export async function persistGenreRelationships(
  userId: string,
  snapshot: GenreRelationship[]
): Promise<void> {
  console.log(`[GRE Persistence] Saving ${snapshot.length} genre relationships for user: ${userId}`);

  const existingRels = await prisma.userGenreRelationshipState.findMany({ where: { userId } });

  await prisma.$transaction(async (tx: any) => {
    for (const res of snapshot) {
      const existing = existingRels.find((r: any) => r.genre === res.genre);
      const prevStage = existing ? existing.currentState : null;

      // Upsert GRE's own state row. Keyed by (userId, genre) — the raw genre
      // string, NOT a Territory_v2_* id.
      await tx.userGenreRelationshipState.upsert({
        where: {
          userId_genre: {
            userId,
            genre: res.genre,
          },
        },
        create: {
          userId,
          genre: res.genre,
          currentState: res.stage,
          stateConfidence: res.confidence,
          previousStage: prevStage,
          momentum: res.metrics.stability,
        },
        update: {
          currentState: res.stage,
          stateConfidence: res.confidence,
          previousStage: prevStage,
          momentum: res.metrics.stability,
          lastUpdatedAt: new Date(),
        },
      });
    }
  });
}
