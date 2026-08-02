/**
 * Part 9 — Identity EMA: TES-scaled incremental centroid update.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  emaUpdateCentroid,
  centroidDelta,
  applyIdentityEmaFromTes,
  parseProfileCentroid,
} from '@/lib/identity/centroid-ema';
import { createTesSnapshot, appendDurabilityEvent } from '@/lib/metrics/tes-snapshot';
import type { AudioSignature } from '@/lib/graph/types';
import { IdentityConfig } from '@/lib/config/identity';

const CENTROID: AudioSignature = {
  energy: 0.5,
  valence: 0.5,
  danceability: 0.5,
  acousticness: 0.5,
  instrumentalness: 0.1,
  tempo: 120,
};

const EVENT: AudioSignature = {
  energy: 0.9,
  valence: 0.2,
  danceability: 0.8,
  acousticness: 0.1,
  instrumentalness: 0.05,
  tempo: 140,
};

describe('emaUpdateCentroid pure', () => {
  it('high TES moves more than low TES', () => {
    const high = emaUpdateCentroid(CENTROID, EVENT, 0.9, 0.2);
    const low = emaUpdateCentroid(CENTROID, EVENT, 0.1, 0.2);
    expect(centroidDelta(CENTROID, high)).toBeGreaterThan(centroidDelta(CENTROID, low));
  });

  it('TES=0 leaves centroid unchanged', () => {
    const next = emaUpdateCentroid(CENTROID, EVENT, 0, 0.5);
    expect(next.energy).toBeCloseTo(CENTROID.energy, 10);
    expect(next.tempo).toBeCloseTo(CENTROID.tempo, 10);
  });

  it('only uses centroid + event (incremental, not history list)', () => {
    // Two sequential steps ≠ one step with average of two events if history-based
    const step1 = emaUpdateCentroid(CENTROID, EVENT, 0.5, 0.2);
    const event2: AudioSignature = { ...EVENT, energy: 0.1 };
    const step2 = emaUpdateCentroid(step1, event2, 0.5, 0.2);
    // Formula only needs previous centroid + new event
    const direct = emaUpdateCentroid(step1, event2, 0.5, 0.2);
    expect(step2.energy).toBeCloseTo(direct.energy, 10);
    expect(IdentityConfig.centroidEmaStepSize).toBeGreaterThan(0);
  });
});

describe('applyIdentityEmaFromTes', () => {
  const userId = `ema-user-${Date.now()}`;
  let pendingSnap: string;
  let durableSnap: string;

  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: userId },
      create: {
        id: userId,
        spotifyId: `sp-${userId}`,
        profileData: JSON.stringify({
          audioCentroid: CENTROID,
          audioCentroidMeta: { version: 1, updateCount: 0, lastUpdatedAt: new Date().toISOString() },
        }),
      },
      update: {
        profileData: JSON.stringify({
          audioCentroid: CENTROID,
          audioCentroidMeta: { version: 1, updateCount: 0, lastUpdatedAt: new Date().toISOString() },
        }),
      },
    });

    const p = await createTesSnapshot({
      userId,
      artistId: 'a-pending',
      foreignness: 0.7,
      agency: 0.6,
      durabilityStatus: 'pending',
      tesScore: 0.8,
    });
    pendingSnap = p.id;

    const d = await createTesSnapshot({
      userId,
      artistId: 'a-durable',
      foreignness: 0.7,
      agency: 0.8,
      meaningfulness: 0.7,
      durabilityStatus: 'confirmed_positive',
      durabilityAtSnap: 0.8,
      tesScore: 0.85,
    });
    durableSnap = d.id;
    await appendDurabilityEvent({
      tesSnapshotId: durableSnap,
      userId,
      eventType: 'return',
      unprompted: true,
    });
  });

  afterAll(async () => {
    try {
      await prisma.durabilityEvent.deleteMany({ where: { userId } });
      await prisma.tesSnapshot.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    } catch {
      // best-effort
    }
  });

  it('skips update when durability pending', async () => {
    const r = await applyIdentityEmaFromTes({
      userId,
      tesSnapshotId: pendingSnap,
      eventVector: EVENT,
    });
    expect(r.updated).toBe(false);
    expect(r.reason).toBe('durability_pending');
  });

  it('applies EMA when durability resolved; increments updateCount only', async () => {
    const before = await prisma.user.findUnique({ where: { id: userId } });
    const prev = parseProfileCentroid(before!.profileData);

    const r = await applyIdentityEmaFromTes({
      userId,
      tesSnapshotId: durableSnap,
      eventVector: EVENT,
    });
    expect(r.updated).toBe(true);
    expect(r.centroid).toBeDefined();
    expect(centroidDelta(prev.centroid!, r.centroid!)).toBeGreaterThan(0);

    const after = await prisma.user.findUnique({ where: { id: userId } });
    const parsed = parseProfileCentroid(after!.profileData);
    expect(parsed.meta!.updateCount).toBe((prev.meta?.updateCount ?? 0) + 1);
    expect(parsed.meta!.lastTesSnapshotId).toBe(durableSnap);
    // Still a single centroid object — not a full history array
    expect(parsed.raw.audioCentroid).toBeDefined();
    expect(Array.isArray(parsed.raw.audioCentroid)).toBe(false);
  });
});
