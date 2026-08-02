/**
 * Part 5 — Agency raw event logging + recalibration (draft only).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  logAgencyInteraction,
  createPendingDurabilityOutcome,
  attachEventsToDurabilityOutcome,
  getActiveAgencyWeights,
  getV0AgencyWeights,
} from '@/lib/metrics/agency';
import {
  fitAgencyWeightsFromSamples,
  runAgencyRecalibration,
} from '@/lib/metrics/agency-recalibration';
import { AGENCY_V0_WEIGHTS } from '@/lib/config/agency';
import { computeAgency, DEFAULT_TEM_CONFIG } from '@/lib/metrics/tem';

describe('Agency v0 weights', () => {
  it('TEM still uses v0 by default', () => {
    expect(DEFAULT_TEM_CONFIG.agencyWeights.SEARCH).toBe(AGENCY_V0_WEIGHTS.SEARCH);
    expect(getV0AgencyWeights().SKIP).toBe(0);
  });

  it('computeAgency with v0: search > autoplay', () => {
    const day = new Date('2025-01-01T12:00:00Z');
    const search = computeAgency([
      { artistId: 'a', timestamp: day, eventType: 'PLAY', initiationType: 'SEARCH' },
    ]);
    const auto = computeAgency([
      { artistId: 'a', timestamp: day, eventType: 'PLAY', initiationType: 'AUTOPLAY' },
    ]);
    expect(search).toBeGreaterThan(auto);
  });
});

describe('fitAgencyWeightsFromSamples (pure)', () => {
  it('proposes mean durability per type; keeps v0 for unseen types', () => {
    const result = fitAgencyWeightsFromSamples([
      { interactionType: 'MANUAL_CLICK', durabilityScore: 0.9 },
      { interactionType: 'MANUAL_CLICK', durabilityScore: 0.7 },
      { interactionType: 'AUTOPLAY', durabilityScore: 0.1 },
      { interactionType: 'AUTOPLAY', durabilityScore: 0.1 },
    ]);
    expect(result.status).toBe('draft');
    expect(result.weights.MANUAL_CLICK).toBeCloseTo(0.8, 5);
    expect(result.weights.AUTOPLAY).toBeCloseTo(0.1, 5);
    // Unseen type stays v0
    expect(result.weights.SEARCH).toBe(AGENCY_V0_WEIGHTS.SEARCH);
    expect(result.sampleSize).toBe(4);
  });
});

describe('Agency interaction log + recalibration draft', () => {
  const userId = `agency-test-user-${Date.now()}`;
  let eventIds: string[] = [];
  let outcomeId: string;
  let proposalId: string | undefined;

  beforeAll(async () => {
    // Ensure user row exists for FK
    await prisma.user.upsert({
      where: { id: userId },
      create: { id: userId, spotifyId: `sp-${userId}` },
      update: {},
    });
  });

  afterAll(async () => {
    try {
      if (proposalId) {
        await prisma.agencyWeightProposal.deleteMany({ where: { id: proposalId } });
      }
      await prisma.agencyInteractionEvent.deleteMany({ where: { userId } });
      await prisma.durabilityOutcome.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    } catch {
      // cleanup best-effort
    }
  });

  it('logs raw events with enough detail for durability join', async () => {
    const pending = await createPendingDurabilityOutcome({
      userId,
      trackId: 'track-1',
      artistId: 'artist-1',
    });
    outcomeId = pending.id;

    const a = await logAgencyInteraction({
      userId,
      trackId: 'track-1',
      artistId: 'artist-1',
      interactionType: 'MANUAL_CLICK',
      recommendationSnapshotId: 'snap-test-1',
      durabilityOutcomeId: outcomeId,
    });
    const b = await logAgencyInteraction({
      userId,
      trackId: 'track-1',
      artistId: 'artist-1',
      interactionType: 'FULL_PLAY',
      durabilityOutcomeId: outcomeId,
    });
    eventIds = [a.id, b.id];

    const rows = await prisma.agencyInteractionEvent.findMany({ where: { userId } });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r: (typeof rows)[number]) => r.interactionType && r.timestamp)).toBe(true);
    expect(rows.some((r: (typeof rows)[number]) => r.recommendationSnapshotId === 'snap-test-1')).toBe(true);
  });

  it('recalibration writes draft proposal without activating', async () => {
    // Resolve durability so join works
    await prisma.durabilityOutcome.update({
      where: { id: outcomeId },
      data: {
        status: 'confirmed_positive',
        score: 0.85,
        measuredAt: new Date(),
      },
    });

    await attachEventsToDurabilityOutcome(eventIds, outcomeId);

    const result = await runAgencyRecalibration({
      notes: 'unit test draft',
    });
    expect(result.status).toBe('draft');
    expect(result.proposalId).toBeTruthy();
    proposalId = result.proposalId;

    const prop = await prisma.agencyWeightProposal.findUnique({
      where: { id: proposalId! },
    });
    expect(prop?.status).toBe('draft');

    // Active weights still v0 (no active proposal)
    const active = await getActiveAgencyWeights();
    expect(active.source).toBe('v0');
  });
});
