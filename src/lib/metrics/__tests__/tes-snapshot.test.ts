/**
 * Part 6 — TES immutability + Durability pending vs zero.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  createTesSnapshot,
  assertTesSnapshotImmutable,
  reviseTesSnapshotAsNew,
  appendDurabilityEvent,
  resolveDurabilityFromStream,
  isPendingDurability,
  durabilityScoreOrNull,
} from '@/lib/metrics/tes-snapshot';

describe('TesSnapshot immutability', () => {
  const userId = `tes-user-${Date.now()}`;
  let snapId: string;
  let newSnapId: string | undefined;

  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: userId },
      create: { id: userId, spotifyId: `sp-${userId}` },
      update: {},
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

  it('creates snapshot with full breakdown + pending durability', async () => {
    const { id } = await createTesSnapshot({
      userId,
      trackId: 't1',
      artistId: 'a1',
      foreignness: 0.8,
      agency: 0.7,
      meaningfulness: 0.5,
      familiarity: 0.1,
      confidenceTag: 'tag_inferred',
      audioConfidenceTag: 'real_audio',
    });
    snapId = id;

    const row = await prisma.tesSnapshot.findUnique({ where: { id } });
    expect(row).toBeTruthy();
    expect(row!.foreignness).toBe(0.8);
    expect(row!.durabilityStatus).toBe('pending');
    expect(row!.durabilityAtSnap).toBeNull();
    expect(row!.componentsJson).toContain('foreignness');
    expect(isPendingDurability(row!.durabilityStatus)).toBe(true);
  });

  it('rejects in-place mutation helper', async () => {
    await expect(assertTesSnapshotImmutable(snapId)).rejects.toThrow(/immutable/i);
  });

  it('revision creates NEW snapshot; original untouched', async () => {
    const original = await prisma.tesSnapshot.findUnique({ where: { id: snapId } });
    const rev = await reviseTesSnapshotAsNew(snapId, {
      agency: 0.9,
      // foreignness intentionally not changed — frozen concept
    });
    newSnapId = rev.id;
    expect(rev.id).not.toBe(snapId);
    expect(rev.previousSnapshotId).toBe(snapId);

    const still = await prisma.tesSnapshot.findUnique({ where: { id: snapId } });
    expect(still!.agency).toBe(original!.agency);
    expect(still!.foreignness).toBe(original!.foreignness);

    const newer = await prisma.tesSnapshot.findUnique({ where: { id: rev.id } });
    expect(newer!.agency).toBe(0.9);
    expect(newer!.foreignness).toBe(original!.foreignness);
  });

  it('append durability events without mutating snapshot', async () => {
    const before = await prisma.tesSnapshot.findUnique({ where: { id: snapId } });
    await appendDurabilityEvent({
      tesSnapshotId: snapId,
      userId,
      eventType: 'return',
      unprompted: true,
    });
    await appendDurabilityEvent({
      tesSnapshotId: snapId,
      userId,
      eventType: 'skip',
      unprompted: false,
    });
    const after = await prisma.tesSnapshot.findUnique({ where: { id: snapId } });
    expect(after!.foreignness).toBe(before!.foreignness);
    expect(after!.agency).toBe(before!.agency);
    expect(after!.durabilityStatus).toBe('pending'); // stream resolve is separate

    const n = await prisma.durabilityEvent.count({ where: { tesSnapshotId: snapId } });
    expect(n).toBe(2);
  });

  it('resolve: pending before window; positive after unprompted return', async () => {
    // Force "old" snapshot by creating with past... createdAt is now. Use minDays=0 for positive path.
    const pending = await resolveDurabilityFromStream(snapId, {
      minDaysSinceSnap: 999,
    });
    expect(pending.status).toBe('pending');
    expect(pending.score).toBeNull();
    expect(durabilityScoreOrNull(pending)).toBeNull();

    const resolved = await resolveDurabilityFromStream(snapId, {
      minDaysSinceSnap: 0,
      minUnpromptedReturns: 1,
    });
    expect(resolved.status).toBe('confirmed_positive');
    expect(resolved.score).toBeGreaterThan(0);
    expect(durabilityScoreOrNull(resolved)).not.toBeNull();
  });

  it('confirmed_zero distinct from pending', async () => {
    const { id } = await createTesSnapshot({
      userId,
      trackId: 't-zero',
      artistId: 'a-zero',
      foreignness: 0.5,
      agency: 0.5,
    });
    // no unprompted events
    const zero = await resolveDurabilityFromStream(id, {
      minDaysSinceSnap: 0,
      minUnpromptedReturns: 1,
    });
    expect(zero.status).toBe('confirmed_zero');
    expect(zero.score).toBe(0);

    const stillPending = await resolveDurabilityFromStream(id, {
      minDaysSinceSnap: 30,
    });
    // daysSince ~0 < 30 → pending
    expect(stillPending.status).toBe('pending');
    expect(stillPending.score).toBeNull();
    expect(stillPending.status).not.toBe(zero.status);
  });
});
