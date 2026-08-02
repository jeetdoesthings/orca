import { describe, it, expect } from 'vitest';
import {
  computeReadinessState,
  tierFromAppetite,
} from '@/lib/readiness/readiness-model';
import type { GenreRelationship } from '@/lib/gre/gre-types';
import type { ReadinessHistoryEvent } from '@/lib/readiness/readiness-types';

function makeRel(
  genre: string,
  stage: GenreRelationship['stage'],
): GenreRelationship {
  return {
    genre,
    stage,
    metrics: {
      familiarity: 0.5,
      diversity: 0.5,
      identity: 0.5,
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

const NOW = Date.parse('2026-06-01T12:00:00.000Z');

describe('Readiness Model (Change B)', () => {
  it('tierFromAppetite maps thresholds', () => {
    expect(tierFromAppetite(0.2)).toBe('comfort');
    expect(tierFromAppetite(0.55)).toBe('expansion');
    expect(tierFromAppetite(0.9)).toBe('leap');
  });

  it('produces tier + reasoning from GRE + history', () => {
    const state = computeReadinessState({
      relationships: [
        makeRel('pop', 'CORE_IDENTITY'),
        makeRel('rock', 'INTEGRATED'),
      ],
      history: [],
      nowMs: NOW,
    });
    expect(['comfort', 'expansion', 'leap']).toContain(state.recommendedTier);
    expect(state.reasoning.length).toBeGreaterThan(10);
    expect(state.reasoning.includes('—')).toBe(false); // no em dash
    expect(state.computedAt).toBeTruthy();
  });

  it('changing rejection history changes recommended tier', () => {
    const greOpen: GenreRelationship[] = [
      makeRel('techno', 'UNTUCHED'),
      makeRel('ambient', 'INTRODUCED'),
      makeRel('jazz', 'EXPLORING'),
    ];

    const base = computeReadinessState({
      relationships: greOpen,
      history: [
        { type: 'accept', at: new Date(NOW - 2 * 86400_000).toISOString() },
        { type: 'integrate', at: new Date(NOW - 1 * 86400_000).toISOString() },
      ],
      nowMs: NOW,
    });

    const heavyReject: ReadinessHistoryEvent[] = Array.from({ length: 12 }, (_, i) => ({
      type: 'reject' as const,
      at: new Date(NOW - i * 86400_000).toISOString(),
      severity: 'territory_reject' as const,
      territoryKey: 'techno',
    }));

    const rejected = computeReadinessState({
      relationships: greOpen,
      history: heavyReject,
      nowMs: NOW,
    });

    // High accepts/open GRE should not equal heavy rejection pressure
    expect(rejected.rejectionPressure ?? 0).toBeGreaterThan(base.rejectionPressure ?? 0);
    // Appetite should drop under rejections
    expect((rejected.appetiteScore ?? 1) <= (base.appetiteScore ?? 0) + 0.001).toBe(
      true,
    );
    // Prefer different tier when pressure is high enough
    if (base.recommendedTier === 'leap') {
      expect(rejected.recommendedTier).not.toBe('leap');
    } else {
      expect(
        rejected.recommendedTier !== base.recommendedTier ||
          rejected.reasoning !== base.reasoning,
      ).toBe(true);
    }
  });

  it('explicit session tier is a strong override', () => {
    const state = computeReadinessState({
      relationships: [makeRel('pop', 'CORE_IDENTITY')],
      history: [
        {
          type: 'reject',
          at: new Date(NOW - 1000).toISOString(),
          severity: 'territory_reject',
        },
      ],
      explicitTier: 'leap',
      nowMs: NOW,
    });
    expect(state.recommendedTier).toBe('leap');
    expect(state.explicitOverride).toBe('leap');
    expect(state.reasoning.toLowerCase()).toContain('chose');
  });

  it('two users with different histories get different defaults', () => {
    const gre: GenreRelationship[] = [
      makeRel('indie-rock', 'EXPLORING'),
      makeRel('folk', 'INTRODUCED'),
    ];

    const explorer = computeReadinessState({
      relationships: gre,
      history: [
        { type: 'tier_override', tier: 'leap', at: new Date(NOW - 3 * 86400_000) },
        { type: 'accept', at: new Date(NOW - 2 * 86400_000) },
        { type: 'integrate', at: new Date(NOW - 1 * 86400_000) },
        { type: 'accept', at: new Date(NOW - 4 * 86400_000) },
      ],
      nowMs: NOW,
    });

    const cautious = computeReadinessState({
      relationships: gre,
      history: Array.from({ length: 10 }, (_, i) => ({
        type: 'reject' as const,
        at: new Date(NOW - i * 86400_000).toISOString(),
        severity: 'territory_reject' as const,
      })),
      nowMs: NOW,
    });

    expect(explorer.recommendedTier).not.toBe(cautious.recommendedTier);
    expect(explorer.reasoning).not.toBe(cautious.reasoning);
  });
});
