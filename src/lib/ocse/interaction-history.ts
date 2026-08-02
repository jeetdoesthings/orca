/**
 * ORCA Interaction History Loader
 *
 * Builds the OCSE interaction-history context from UserArtistMemory records.
 * Shared helper for buildFrontierNodes (and any OCSE caller).
 *
 * NOTE: Current memory schema stores state (INTERNALIZED / DORMANT / FORGOTTEN)
 * as 0/1 booleans, not real counts. Phase 3 will enrich this with actual
 * counters for proper cooldown tracking.
 *
 * @module ocse/interaction-history
 */

import { prisma } from '@/lib/prisma';
import type { UserInteractionHistory } from './ocse-types';
import { loadTerritoryRejectionsForOcse } from '@/lib/feedback/territory-reject';

/**
 * Loads interaction history from UserArtistMemory for OCSE cooldown evaluation.
 * Part 11: also loads territory-wide rejections for Readiness.
 */
export async function loadInteractionHistory(
  userId: string,
): Promise<UserInteractionHistory> {
  const memories = await prisma.userArtistMemory.findMany({
    where: { userId },
    select: {
      artistId: true,
      memoryState: true,
      memoryStrength: true,
      updatedAt: true,
    },
  });

  const timesShown: Record<string, number> = {};
  const timesIgnored: Record<string, number> = {};
  const timesDismissed: Record<string, number> = {};
  const timesIntegrated: Record<string, number> = {};
  const lastShown: Record<string, string> = {};

  for (const mem of memories) {
    const id = mem.artistId;
    timesShown[id] = 1; // Phase 3: real show counts
    timesIgnored[id] = mem.memoryState === 'DORMANT' ? 1 : 0;
    timesDismissed[id] = mem.memoryState === 'FORGOTTEN' ? 1 : 0;
    timesIntegrated[id] = mem.memoryState === 'INTERNALIZED' ? 1 : 0;
    lastShown[id] = mem.updatedAt ? new Date(mem.updatedAt).toISOString() : new Date().toISOString();
  }

  let territoryRejections: UserInteractionHistory['territoryRejections'] = [];
  try {
    territoryRejections = await loadTerritoryRejectionsForOcse(userId);
  } catch {
    territoryRejections = [];
  }

  return {
    timesShown,
    timesIgnored,
    timesDismissed,
    timesIntegrated,
    lastShown,
    territoryRejections,
  };
}
