/**
 * Agency interaction logging + weight loading (Part 5).
 *
 * Log RAW events — not only the final weighted Agency score.
 * Recalibration produces draft proposals only; never auto-applies.
 */

import { prisma } from '@/lib/prisma';
import {
  AGENCY_V0_WEIGHTS,
  type ActiveAgencyWeights,
} from '@/lib/config/agency';

export { AGENCY_V0_WEIGHTS };

export type InteractionType =
  | 'MANUAL_CLICK'
  | 'FULL_PLAY'
  | 'AUTOPLAY'
  | 'SKIP'
  | 'SEARCH'
  | 'ARTIST_PAGE'
  | 'LIBRARY_SAVE'
  | 'PLAYLIST_CREATED'
  | 'VOLUNTARY_REVISIT'
  | 'RECOMMENDATION'
  | 'BACKGROUND'
  | 'PLAY'
  | 'COMPLETE'
  | 'SAVE'
  | 'PLAYLIST_ADD'
  | 'REPLAY'
  | string;

export interface LogInteractionInput {
  userId: string;
  interactionType: InteractionType;
  trackId?: string | null;
  artistId?: string | null;
  timestamp?: Date;
  recommendationSnapshotId?: string | null;
  durabilityOutcomeId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Append one raw interaction event. Does not recompute Agency scores in place.
 */
export async function logAgencyInteraction(
  input: LogInteractionInput,
): Promise<{ id: string }> {
  const row = await prisma.agencyInteractionEvent.create({
    data: {
      userId: input.userId,
      interactionType: input.interactionType,
      trackId: input.trackId ?? null,
      artistId: input.artistId ?? null,
      timestamp: input.timestamp ?? new Date(),
      recommendationSnapshotId: input.recommendationSnapshotId ?? null,
      durabilityOutcomeId: input.durabilityOutcomeId ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  });
  return { id: row.id };
}

/**
 * Create a pending durability outcome shell for later measurement (Part 6).
 */
export async function createPendingDurabilityOutcome(opts: {
  userId: string;
  trackId?: string | null;
  artistId?: string | null;
}): Promise<{ id: string }> {
  const row = await prisma.durabilityOutcome.create({
    data: {
      userId: opts.userId,
      trackId: opts.trackId ?? null,
      artistId: opts.artistId ?? null,
      status: 'pending',
      score: null,
    },
  });
  return { id: row.id };
}

/**
 * Link existing interaction events to a durability outcome (FK fill).
 */
export async function attachEventsToDurabilityOutcome(
  eventIds: string[],
  durabilityOutcomeId: string,
): Promise<number> {
  if (eventIds.length === 0) return 0;
  const res = await prisma.agencyInteractionEvent.updateMany({
    where: { id: { in: eventIds } },
    data: { durabilityOutcomeId },
  });
  return res.count;
}

/**
 * Active Agency weights for scoring.
 * v0 until a proposal with status=active exists (set only after human review).
 *
 * IMPORTANT: recalibration job must only write status=draft. Promoting to
 * active is a manual/review step — never silent self-modify in production.
 */
export async function getActiveAgencyWeights(): Promise<ActiveAgencyWeights> {
  try {
    const active = await prisma.agencyWeightProposal.findFirst({
      where: { status: 'active' },
      orderBy: { createdAt: 'desc' },
    });
    if (active?.weightsJson) {
      const weights = JSON.parse(active.weightsJson) as Record<string, number>;
      return {
        weights: { ...AGENCY_V0_WEIGHTS, ...weights },
        source: 'approved_proposal',
        proposalId: active.id,
      };
    }
  } catch {
    // DB unavailable → v0
  }
  return { weights: { ...AGENCY_V0_WEIGHTS }, source: 'v0' };
}

/** Synchronous v0 for pure TEM path / unit tests without DB. */
export function getV0AgencyWeights(): Record<string, number> {
  return { ...AGENCY_V0_WEIGHTS };
}
