/**
 * Part 11 — territory-wide reject vs ordinary skip.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  recordTerritoryReject,
  getActiveTerritorySuppressions,
  isTerritorySuppressed,
  loadTerritoryRejectionsForOcse,
} from '@/lib/feedback/territory-reject';
import { computeReadiness } from '@/lib/ocse/decision-score';
import { applyGreTransition } from '@/lib/gre/transitions';
import { OcseConfig } from '@/lib/config/ocse';

describe('territory reject vs skip readiness', () => {
  it('territory_reject lowers readiness more than ordinary skip', () => {
    const now = Date.now();
    const territoryKey = 'techno';
    const skip = computeReadiness({
      territoryKey,
      rejections: [{ territoryKey, at: new Date(now), severity: 'skip' }],
      nowMs: now,
    });
    const hard = computeReadiness({
      territoryKey,
      rejections: [{ territoryKey, at: new Date(now), severity: 'territory_reject' }],
      nowMs: now,
    });
    expect(hard).toBeLessThan(skip);
    expect(OcseConfig.readiness.territoryRejectWeight).toBeGreaterThan(
      OcseConfig.readiness.skipRejectWeight,
    );
  });
});

describe('GRE territory-wide reject', () => {
  it('forces REDISCOVER from GROWING', () => {
    const r = applyGreTransition({
      previous: 'GROWING',
      metrics: {
        familiarity: 0.4,
        diversity: 0.4,
        identity: 0.4,
        recency: 0.8,
        stability: 0.6,
      },
      context: { territoryWideReject: true },
    });
    expect(r.stage).toBe('REDISCOVER');
  });
});

describe('territory suppress store', () => {
  const userId = `trej-user-${Date.now()}`;

  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: userId },
      create: { id: userId, spotifyId: `sp-${userId}` },
      update: {},
    });
  });

  afterAll(async () => {
    try {
      await prisma.territoryRejection.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    } catch {
      // best-effort
    }
  });

  it('records rejection and suppresses matching genres during cooldown', async () => {
    const rec = await recordTerritoryReject({
      userId,
      territoryKey: 'house',
      sourceArtistId: 'artist-x',
      cooldownDays: 30,
    });
    expect(rec.territoryKey).toBe('house');
    expect(rec.cooldownUntil.getTime()).toBeGreaterThan(Date.now());

    const active = await getActiveTerritorySuppressions(userId);
    expect(active.some((s) => s.territoryKey === 'house')).toBe(true);
    expect(isTerritorySuppressed(active, ['house', 'pop'])).toBe(true);
    expect(isTerritorySuppressed(active, ['country'])).toBe(false);

    const forOcse = await loadTerritoryRejectionsForOcse(userId);
    expect(forOcse.some((r) => r.severity === 'territory_reject')).toBe(true);
  });
});
