/**
 * TEM (Taste Expansion Metric) unit tests.
 *
 * TEM is the code analog of brief "TES": multiplicative F×D×A×M.
 * Ranking path does NOT use TEM — these tests pin the outcome metric only.
 */
import { describe, it, expect } from 'vitest';
import {
  computeForeignness,
  computeDurability,
  computeAgency,
  computeMeaningfulness,
  territoryExpansionScore,
  calculateTEMFromEvents,
  DEFAULT_TEM_CONFIG,
  type TemListenEvent,
} from '@/lib/metrics/tem';

const day = (n: number) => new Date(`2025-01-${String(n).padStart(2, '0')}T12:00:00Z`);

describe('TEM foreignness (F)', () => {
  it('is 1.0 when territory has no baseline exposure', () => {
    expect(computeForeignness([], day(90).getTime())).toBe(1.0);
  });

  it('drops when baseline exposure is high', () => {
    const evalStart = new Date('2025-06-01T00:00:00Z').getTime();
    const baseline: TemListenEvent[] = Array.from({ length: 40 }, (_, i) => ({
      artistId: `a${i % 3}`,
      territoryId: 't1',
      // Dense recent baseline (within 180d of evalStart)
      timestamp: new Date(Date.UTC(2025, 4, 1 + (i % 20), 12)),
      eventType: 'PLAY',
      initiationType: 'SEARCH',
    }));
    const f = computeForeignness(baseline, evalStart);
    expect(f).toBeLessThan(0.5);
    expect(f).toBeGreaterThanOrEqual(0);
  });
});

describe('TEM durability (D)', () => {
  it('is higher when voluntary listens span later windows', () => {
    const evalStart = day(1).getTime();
    // Only early window
    const earlyOnly: TemListenEvent[] = [
      { artistId: 'a1', timestamp: day(2), eventType: 'PLAY', initiationType: 'SEARCH' },
      { artistId: 'a1', timestamp: day(3), eventType: 'PLAY', initiationType: 'SEARCH' },
    ];
    // Early + late (spread across 90 days)
    const spread: TemListenEvent[] = [
      { artistId: 'a1', timestamp: day(2), eventType: 'PLAY', initiationType: 'SEARCH' },
      { artistId: 'a1', timestamp: new Date('2025-03-20T12:00:00Z'), eventType: 'PLAY', initiationType: 'LIBRARY_SAVE' },
    ];
    const dEarly = computeDurability(earlyOnly, evalStart, DEFAULT_TEM_CONFIG);
    const dSpread = computeDurability(spread, evalStart, DEFAULT_TEM_CONFIG);
    expect(dSpread).toBeGreaterThan(dEarly);
  });

  it('ignores AUTOPLAY for durability', () => {
    const evalStart = day(1).getTime();
    const auto: TemListenEvent[] = [
      { artistId: 'a1', timestamp: day(5), eventType: 'PLAY', initiationType: 'AUTOPLAY' },
      { artistId: 'a1', timestamp: day(40), eventType: 'PLAY', initiationType: 'AUTOPLAY' },
    ];
    expect(computeDurability(auto, evalStart)).toBe(0);
  });
});

describe('TEM agency (A)', () => {
  it('weights LIBRARY_SAVE high and AUTOPLAY low', () => {
    const save: TemListenEvent[] = [
      { artistId: 'a1', timestamp: day(1), eventType: 'SAVE', initiationType: 'LIBRARY_SAVE' },
    ];
    const auto: TemListenEvent[] = [
      { artistId: 'a1', timestamp: day(1), eventType: 'PLAY', initiationType: 'AUTOPLAY' },
    ];
    expect(computeAgency(save)).toBeGreaterThan(computeAgency(auto));
    expect(computeAgency(auto)).toBeLessThanOrEqual(0.15);
  });

  it('excludes SKIP events', () => {
    const mixed: TemListenEvent[] = [
      { artistId: 'a1', timestamp: day(1), eventType: 'SKIP', initiationType: 'SEARCH' },
      { artistId: 'a1', timestamp: day(1), eventType: 'PLAY', initiationType: 'LIBRARY_SAVE' },
    ];
    expect(computeAgency(mixed)).toBe(DEFAULT_TEM_CONFIG.agencyWeights.LIBRARY_SAVE);
  });
});

describe('TEM meaningfulness (M) and composite', () => {
  it('multiplies F×D×A×M — zero agency zeros the score', () => {
    expect(territoryExpansionScore(0.8, 0.6, 0, 0.5)).toBe(0);
    expect(territoryExpansionScore(0.8, 0.6, 1.0, 0.5)).toBeCloseTo(0.24, 5);
  });

  it('calculateTEMFromEvents awards expansion only with adoption + agency', () => {
    // eval window: last 90 days ending 2025-04-01 → start ~2025-01-01
    const end = new Date('2025-04-01T00:00:00Z');
    const events: TemListenEvent[] = [];
    // Enough duration + sessions in eval with library saves
    for (let d = 5; d <= 80; d += 7) {
      events.push({
        artistId: `artist-${d % 4}`,
        territoryId: 'tropicália',
        timestamp: new Date(`2025-01-${String(Math.min(28, d)).padStart(2, '0')}T12:00:00Z`),
        eventType: 'PLAY',
        initiationType: 'LIBRARY_SAVE',
        durationMs: 15 * 60 * 1000,
        sessionId: `s-${d}`,
      });
    }
    // fix timestamps for days > 28 into Feb/Mar
    events.length = 0;
    const stamps = [
      '2025-01-05', '2025-01-12', '2025-01-19', '2025-01-26',
      '2025-02-05', '2025-02-12', '2025-02-19', '2025-02-26',
      '2025-03-05', '2025-03-12', '2025-03-19', '2025-03-26',
    ];
    stamps.forEach((s, i) => {
      events.push({
        artistId: `artist-${i % 4}`,
        territoryId: 'tropicália',
        timestamp: new Date(`${s}T12:00:00Z`),
        eventType: i === 0 ? 'SAVE' : 'PLAY',
        initiationType: 'LIBRARY_SAVE',
        durationMs: 20 * 60 * 1000,
        sessionId: `s-${i}`,
      });
    });

    const result = calculateTEMFromEvents(events, end);
    expect(result.adoptedTerritories).toBeGreaterThanOrEqual(1);
    expect(result.score).toBeGreaterThan(0);
    expect(result.agency).toBeGreaterThan(0.5);
    expect(result.foreignness).toBe(1); // no baseline
  });

  it('autoplay-only path does not produce high TEM even if long', () => {
    const end = new Date('2025-04-01T00:00:00Z');
    const events: TemListenEvent[] = [];
    for (let i = 0; i < 20; i++) {
      events.push({
        artistId: 'a1',
        territoryId: 't-auto',
        timestamp: new Date(Date.UTC(2025, 0, 5 + i * 3, 12)),
        eventType: 'PLAY',
        initiationType: 'AUTOPLAY',
        durationMs: 30 * 60 * 1000,
        sessionId: `auto-${i}`,
      });
    }
    const result = calculateTEMFromEvents(events, end);
    // Durability ignores autoplay → D=0 → score 0 if adopted; or may fail agency/durability
    expect(result.score).toBe(0);
  });
});
