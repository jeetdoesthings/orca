/**
 * Four-axis EI: territory | scene | era | language — no audio_distance.
 */
import { describe, it, expect } from 'vitest';
import {
  computeDisaggregatedDistance,
  confidenceFromAxisTags,
  type ExpansionDistanceInputs,
  type DistanceConfidence,
} from '@/lib/expansion/distance-components';
import type { GenreRelationship } from '@/lib/gre/gre-types';
import { ExpansionConfig } from '@/lib/config/expansion';
import { OcseConfig } from '@/lib/config/ocse';

function rel(genre: string, stage: GenreRelationship['stage']): GenreRelationship {
  const core = stage === 'CORE_IDENTITY' || stage === 'INTEGRATED';
  return {
    genre,
    stage,
    metrics: {
      familiarity: core ? 0.9 : 0.1,
      diversity: 0.4,
      identity: core ? 0.85 : 0.05,
      recency: core ? 0.8 : 0.2,
      stability: 0.5,
    },
    summary: {
      relationshipStrength: core ? 0.9 : 0.1,
      relationshipMomentum: 0.5,
      relationshipBreadth: 0.4,
      relationshipConfidence: 0.7,
    },
    confidence: 0.7,
  };
}

function makeInputs(overrides: Partial<ExpansionDistanceInputs> = {}): ExpansionDistanceInputs {
  return {
    userGenreProfile: new Map([
      ['pop', 0.8],
      ['dance-pop', 0.4],
    ]),
    relationships: [rel('pop', 'CORE_IDENTITY'), rel('techno', 'UNTUCHED')],
    candidateGenres: ['techno'],
    candidatePopularity: 40,
    userEraYear: 2015,
    candidateEraYear: 1993,
    priorObservedPlays: 0,
    ...overrides,
  };
}

describe('computeDisaggregatedDistance (four-axis)', () => {
  it('returns exactly four components + composite — no audio_distance', () => {
    const d = computeDisaggregatedDistance(makeInputs());
    expect('audio_distance' in d).toBe(false);
    for (const key of [
      'territory_distance',
      'scene_distance',
      'era_distance',
      'language_distance',
    ] as const) {
      expect(d[key].value).toBeGreaterThanOrEqual(0);
      expect(d[key].value).toBeLessThanOrEqual(1);
      expect(['high_confidence', 'partial_confidence', 'low_confidence']).toContain(
        d[key].confidence,
      );
    }
    expect(d.composite).toBeGreaterThanOrEqual(0);
    expect(d.composite).toBeLessThanOrEqual(1);
    expect(Object.keys(d).sort()).toEqual(
      [
        'composite',
        'compositeConfidence',
        'era_distance',
        'language_distance',
        'scene_distance',
        'territory_distance',
      ].sort(),
    );
  });

  it('four components are not silently identical for a distant candidate', () => {
    const d = computeDisaggregatedDistance(makeInputs());
    const values = [
      d.territory_distance.value,
      d.scene_distance.value,
      d.era_distance.value,
      d.language_distance.value,
    ];
    const unique = new Set(values.map((v) => Math.round(v * 1000) / 1000));
    expect(unique.size).toBeGreaterThanOrEqual(2);
  });

  it('near-home candidate has lower territory than far genre', () => {
    const near = computeDisaggregatedDistance(
      makeInputs({
        candidateGenres: ['pop'],
        candidateEraYear: 2014,
      }),
    );
    const far = computeDisaggregatedDistance(makeInputs());
    expect(near.territory_distance.value).toBeLessThan(far.territory_distance.value);
    expect(near.composite).toBeLessThan(far.composite);
  });

  it('thin metadata → lower confidence than full metadata', () => {
    const thin = computeDisaggregatedDistance(
      makeInputs({
        userGenreProfile: new Map(),
        relationships: [],
        candidateGenres: [],
        userEraYear: null,
        candidateEraYear: null,
      }),
    );
    const full = computeDisaggregatedDistance(makeInputs());
    // Empty genres forces low territory confidence
    expect(
      ['low_confidence', 'partial_confidence'].includes(thin.compositeConfidence),
    ).toBe(true);
    expect(CONFIDENCE_ORDER(full.compositeConfidence)).toBeGreaterThanOrEqual(
      CONFIDENCE_ORDER(thin.compositeConfidence),
    );
  });

  it('is deterministic', () => {
    const a = computeDisaggregatedDistance(makeInputs());
    const b = computeDisaggregatedDistance(makeInputs());
    expect(a).toEqual(b);
  });
});

function CONFIDENCE_ORDER(t: DistanceConfidence): number {
  return { high_confidence: 2, partial_confidence: 1, low_confidence: 0 }[t];
}

describe('four-axis weight configs (Component B)', () => {
  it('composite weights sum ~1 and have no audio key', () => {
    const w = ExpansionConfig.compositeComponentWeights as Record<string, number>;
    expect(w.audio).toBeUndefined();
    const sum = w.territory + w.scene + w.era + w.language;
    expect(sum).toBeGreaterThan(0.99);
    expect(sum).toBeLessThan(1.01);
  });

  it('bucket weights sum ~1 and never reference audio', () => {
    for (const bucket of ['comfort', 'expansion', 'leap'] as const) {
      const w = OcseConfig.bucketDistanceWeights[bucket] as Record<string, number>;
      expect(w.audio).toBeUndefined();
      const sum = w.territory + w.scene + w.era + w.language;
      expect(sum).toBeGreaterThan(0.99);
      expect(sum).toBeLessThan(1.01);
      const t = OcseConfig.bucketDistanceTargets[bucket] as Record<string, number>;
      expect(t.audio).toBeUndefined();
    }
  });

  it('confidenceFromAxisTags distinguishes high vs low', () => {
    expect(
      confidenceFromAxisTags([
        'high_confidence',
        'high_confidence',
        'high_confidence',
        'high_confidence',
      ]),
    ).toBe('high_confidence');
    expect(
      confidenceFromAxisTags([
        'low_confidence',
        'low_confidence',
        'low_confidence',
        'low_confidence',
      ]),
    ).toBe('low_confidence');
    expect(
      confidenceFromAxisTags([
        'high_confidence',
        'partial_confidence',
        'low_confidence',
        'partial_confidence',
      ]),
    ).toBe('partial_confidence');
  });
});
