/**
 * INV-5 (single source of expansionDistance) — Expansion Intelligence layer.
 *
 * Phase 2 P0-1 designates Expansion Intelligence as the canonical owner of
 * `expansionDistance` (see docs/architecture/ownership-matrix.md §2.5 and
 * architecture-rules.md RULE-10). These tests pin the contract that the rest
 * of the pipeline depends on:
 *
 *   1. The composite is deterministic — same inputs always produce the same
 *      distance. (A non-deterministic "canonical" value would make regression
 *      baselines meaningless.)
 *   2. The output is always in [0, 1]. (OCSE, WPE, and the client all assume
 *      this range.)
 *   3. The 4 sub-weights are exactly 0.35/0.25/0.25/0.15 per `ExpansionConfig.distanceWeights`
 *      (P1-9a moved these to config — the test reads the same source so the frozen
 *      value stays the same).
 *
 * These tests run without a database — Expansion Intelligence is pure (per
 * the module header at intelligence.ts:11-12).
 */
import { describe, it, expect } from 'vitest';
import {
  computeExpansionDistanceFromInputs,
  expansionDistance,
  expansionBandFromDistance,
  type ExpansionDistanceInputs,
} from '@/lib/expansion/intelligence';
import type { AudioSignature } from '@/lib/graph/types';

const CENTROID: AudioSignature = {
  energy: 0.5,
  valence: 0.5,
  danceability: 0.5,
  acousticness: 0.5,
  instrumentalness: 0.1,
  tempo: 120,
};

function makeInputs(overrides: Partial<ExpansionDistanceInputs> = {}): ExpansionDistanceInputs {
  return {
    userCentroid: CENTROID,
    userGenreProfile: new Map([['pop', 1]]),
    relationships: [],
    candidateGenres: ['techno'],
    candidateSignature: { ...CENTROID, energy: 0.8 },
    candidatePopularity: 50,
    ...overrides,
  };
}

describe('expansionDistance composite (INV-5 canonical owner)', () => {
  it('is deterministic — same inputs yield the same distance', () => {
    const inputs = makeInputs();
    const a = computeExpansionDistanceFromInputs(inputs);
    const b = computeExpansionDistanceFromInputs(inputs);
    expect(a).toBe(b);
  });

  it('always returns a value in [0, 1]', () => {
    // Adversarial inputs: maximally different signature, empty genre profile,
    // extreme popularity. None of these should escape the range.
    const extremes: Partial<ExpansionDistanceInputs>[] = [
      { candidateSignature: { energy: 0.99, valence: 0.99, danceability: 0.99, acousticness: 0.99, instrumentalness: 0.99, tempo: 200 } },
      { candidateSignature: { energy: 0.01, valence: 0.01, danceability: 0.01, acousticness: 0.01, instrumentalness: 0.01, tempo: 40 } },
      { candidatePopularity: 0 },
      { candidatePopularity: 100 },
      { userGenreProfile: new Map() },
      { relationships: [] },
    ];
    for (const ext of extremes) {
      const d = computeExpansionDistanceFromInputs(makeInputs(ext));
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
    }
  });

  it('legacy expansionDistance helper uses config distanceWeights (audio acoustic=0)', () => {
    // audio_distance dropped; acoustic weight is 0 in ExpansionConfig.distanceWeights
    // cultural=0.4, identity=0.35, familiarity=0.25
    // expansionDistance(acoustic, cultural, identity, familiarity)
    // = 0*0.4 + 0.4*0.6 + 0.35*0.2 + 0.25*(1-0.8)
    // = 0 + 0.24 + 0.07 + 0.05 = 0.36
    expect(expansionDistance(0.4, 0.6, 0.2, 0.8)).toBeCloseTo(0.36, 5);
  });
});

describe('expansionBandFromDistance', () => {
  it('returns UNKNOWN for NaN/null', () => {
    expect(expansionBandFromDistance(NaN)).toBe('UNKNOWN');
  });

  it('returns a valid band for in-range distances', () => {
    const band = expansionBandFromDistance(0.5);
    expect(['CORE', 'FAMILIAR', 'COMFORT_EDGE', 'EXPANSION', 'OUTER_EDGE']).toContain(band);
  });
});

describe('four-axis honesty (audio_distance dropped)', () => {
  it('signature / audioSource do not change composite (metadata-only)', () => {
    const low: AudioSignature = {
      energy: 0.01,
      valence: 0.01,
      danceability: 0.01,
      acousticness: 0.01,
      instrumentalness: 0.01,
      tempo: 40,
    };
    const high: AudioSignature = {
      energy: 0.99,
      valence: 0.99,
      danceability: 0.99,
      acousticness: 0.99,
      instrumentalness: 0.99,
      tempo: 200,
    };
    const a = computeExpansionDistanceFromInputs(
      makeInputs({ candidateSignature: low, audioSource: 'REAL' }),
    );
    const b = computeExpansionDistanceFromInputs(
      makeInputs({ candidateSignature: high, audioSource: 'SYNTHETIC' }),
    );
    const c = computeExpansionDistanceFromInputs(
      makeInputs({ candidateSignature: high, audioSource: 'MISSING' }),
    );
    // Audio no longer in composite — all equal for same genres/era
    expect(a).toBeCloseTo(b, 5);
    expect(b).toBeCloseTo(c, 5);
  });

  it('genre leap still moves composite without audio', () => {
    const near = computeExpansionDistanceFromInputs(
      makeInputs({ candidateGenres: ['pop'] }),
    );
    const far = computeExpansionDistanceFromInputs(
      makeInputs({ candidateGenres: ['techno'] }),
    );
    expect(far).toBeGreaterThan(near);
  });
});
