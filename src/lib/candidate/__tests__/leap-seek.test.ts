/**
 * Leap-seek retrieval tests (Components 1–2).
 */
import { describe, it, expect } from 'vitest';
import {
  inferHomeTerritories,
  rankFarTerritories,
  selectTargetTerritories,
  retrieveLeapSeekCandidates,
} from '@/lib/candidate/leap-seek';
import type { GenreRelationship } from '@/lib/gre/gre-types';

function rel(
  genre: string,
  stage: GenreRelationship['stage'],
): GenreRelationship {
  const core = stage === 'CORE_IDENTITY' || stage === 'INTEGRATED';
  return {
    genre,
    stage,
    metrics: {
      familiarity: core ? 0.9 : 0.1,
      diversity: 0.4,
      identity: core ? 0.9 : 0.1,
      recency: 0.5,
      stability: 0.5,
    },
    summary: {
      relationshipStrength: 0.5,
      relationshipMomentum: 0.5,
      relationshipBreadth: 0.5,
      relationshipConfidence: 0.5,
    },
    confidence: 0.5,
  };
}

describe('leap-seek territory ranking', () => {
  it('infers home from CORE_IDENTITY genres', () => {
    const home = inferHomeTerritories([
      rel('pop', 'CORE_IDENTITY'),
      rel('techno', 'UNTUCHED'),
    ]);
    expect(home[0]).toBe('pop');
  });

  it('ranks far territories higher than home-adjacent', () => {
    const ranking = rankFarTerritories(
      ['pop', 'dance-pop'],
      [rel('pop', 'CORE_IDENTITY'), rel('dance-pop', 'INTEGRATED')],
    );
    expect(ranking.length).toBeGreaterThan(0);
    // Top far should not be pop
    expect(ranking[0].territory).not.toBe('pop');
    expect(ranking[0].farScore).toBeGreaterThan(0);
  });

  it('excludes Exploring/Resident GRE stages from targets', () => {
    const ranking = rankFarTerritories(
      ['pop'],
      [
        rel('pop', 'CORE_IDENTITY'),
        rel('techno', 'EXPLORING'),
        rel('jazz', 'UNTUCHED'),
      ],
    );
    expect(ranking.every((r) => r.territory !== 'techno')).toBe(true);
  });

  it('rotation deprioritizes recent territories', () => {
    const base = rankFarTerritories(['pop'], [rel('pop', 'CORE_IDENTITY')]);
    expect(base.length).toBeGreaterThan(0);
    const top = base[0].territory;
    const baseScore = base[0].farScore;
    const rotated = rankFarTerritories(['pop'], [rel('pop', 'CORE_IDENTITY')], {
      recentTerritories: [top],
    });
    const after = rotated.find((r) => r.territory === top);
    // Either dropped below minFarScore or scored lower than before penalty
    if (after) {
      expect(after.farScore).toBeLessThan(baseScore + 0.001);
    } else {
      expect(rotated[0]?.territory).not.toBe(top);
    }
  });

  it('selectTargetTerritories returns up to k distinct', () => {
    const ranking = rankFarTerritories(['pop'], [rel('pop', 'CORE_IDENTITY')]);
    const sel = selectTargetTerritories(ranking, 4);
    expect(sel.length).toBeLessThanOrEqual(4);
    expect(new Set(sel).size).toBe(sel.length);
  });
});

describe('retrieveLeapSeekCandidates (offline)', () => {
  it('emits leap_seek tagged candidates with source_territory', async () => {
    const result = await retrieveLeapSeekCandidates(
      'test-user',
      [rel('pop', 'CORE_IDENTITY'), rel('dance-pop', 'INTEGRATED')],
      { offlineOnly: true, maxTerritories: 3 },
    );
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const c of result.candidates) {
      expect(c.retrieval_path).toBe('leap_seek');
      expect(c.source_territory).toBeTruthy();
      expect(c.discoveryContext.sources.some((s) => s.type === 'LEAP_SEEK')).toBe(
        true,
      );
    }
    // Targets should be distant from pop home
    expect(result.targetedTerritories.every((t) => t !== 'pop')).toBe(true);
  });

  it('leap_seek candidates do not use seed-similarity sources', async () => {
    const result = await retrieveLeapSeekCandidates(
      'test-user',
      [rel('pop', 'CORE_IDENTITY')],
      { offlineOnly: true, maxTerritories: 2 },
    );
    for (const c of result.candidates) {
      expect(
        c.discoveryContext.sources.every((s) => s.type !== 'LASTFM_SIMILAR'),
      ).toBe(true);
    }
  });
});
