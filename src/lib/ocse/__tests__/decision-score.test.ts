/**
 * Part 7 — DecisionScore: Readiness, Diversity, Confidence, geo-mean.
 */
import { describe, it, expect } from 'vitest';
import {
  computeReadiness,
  computeBatchDiversity,
  confidenceFromTag,
  computeDecisionScore,
  weightedGeometricMean,
  tesProxyFromCandidate,
} from '@/lib/ocse/decision-score';
import {
  evaluateCandidate,
  evaluateCandidateUniverse,
} from '@/lib/ocse/decision-engine';
import type { Candidate } from '@/lib/candidate/cub-types';
import type { OCSEContext } from '@/lib/ocse/ocse-types';

function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    artistId: 'a1',
    name: 'A',
    genres: ['house'],
    popularity: 50,
    imageUrl: '',
    discoveryContext: {
      growthOpportunity: 'house',
      relationshipStage: 'EXPLORING',
      supportingArtists: [],
      sources: [],
    },
    discoveryConfidence: 0.7,
    candidateClassification: 'EXPANSION',
    audioSource: 'tag_inferred',
    expansionDistance: 0.5,
    ...overrides,
  };
}

function makeContext(overrides: Partial<OCSEContext> = {}): OCSEContext {
  return {
    relationships: [],
    sliderValue: 0.5,
    interactionHistory: {
      timesShown: {},
      timesIgnored: {},
      timesDismissed: {},
      timesIntegrated: {},
      lastShown: {},
      territoryRejections: [],
    },
    currentVisibleWorldIds: [],
    ...overrides,
  };
}

describe('weightedGeometricMean', () => {
  it('equals value when all equal', () => {
    expect(
      weightedGeometricMean([
        { value: 0.5, weight: 1 },
        { value: 0.5, weight: 1 },
      ]),
    ).toBeCloseTo(0.5, 5);
  });

  it('is less crushed than raw product for mid values', () => {
    const parts = [
      { value: 0.8, weight: 1 },
      { value: 0.8, weight: 1 },
      { value: 0.8, weight: 1 },
      { value: 0.8, weight: 1 },
    ];
    const geo = weightedGeometricMean(parts);
    const product = 0.8 ** 4;
    expect(geo).toBeGreaterThan(product);
    expect(geo).toBeCloseTo(0.8, 5);
  });
});

describe('Readiness recovery', () => {
  it('drops after same-direction rejections then recovers over time', () => {
    const now = Date.now();
    const day = 86400000;
    const territoryKey = 'techno';

    const fresh = computeReadiness({
      territoryKey,
      greStage: 'INTRODUCED',
      rejections: [
        { territoryKey, at: new Date(now - 0.1 * day), severity: 'skip' },
        { territoryKey, at: new Date(now - 0.2 * day), severity: 'skip' },
        { territoryKey, at: new Date(now - 0.3 * day), severity: 'skip' },
      ],
      nowMs: now,
      halfLifeDays: 5,
    });

    const recovered = computeReadiness({
      territoryKey,
      greStage: 'INTRODUCED',
      rejections: [
        { territoryKey, at: new Date(now - 30 * day), severity: 'skip' },
        { territoryKey, at: new Date(now - 31 * day), severity: 'skip' },
        { territoryKey, at: new Date(now - 32 * day), severity: 'skip' },
      ],
      nowMs: now,
      halfLifeDays: 5,
    });

    expect(fresh).toBeLessThan(recovered);
    expect(recovered).toBeGreaterThan(0.5);
  });

  it('territory_reject hits harder than skip', () => {
    const now = Date.now();
    const territoryKey = 'drill';
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
  });

  it('GRE stage modulates readiness (INTRODUCED > CORE_IDENTITY)', () => {
    const a = computeReadiness({ territoryKey: 'pop', greStage: 'INTRODUCED' });
    const b = computeReadiness({ territoryKey: 'pop', greStage: 'CORE_IDENTITY' });
    expect(a).toBeGreaterThan(b);
  });
});

describe('batch Diversity', () => {
  it('clustered batch scores lower than spread batch', () => {
    const clustered = computeBatchDiversity(['house', 'techno', 'house', 'techno']);
    const spread = computeBatchDiversity(['house', 'country', 'classical', 'hip-hop']);
    expect(clustered).toBeLessThan(spread);
  });
});

describe('Confidence from tags', () => {
  it('high_confidence > partial_confidence > low_confidence (legacy aliases map)', () => {
    expect(confidenceFromTag('high_confidence')).toBeGreaterThan(
      confidenceFromTag('partial_confidence'),
    );
    expect(confidenceFromTag('partial_confidence')).toBeGreaterThan(
      confidenceFromTag('low_confidence'),
    );
    // Legacy audio-era tags normalize into the new scale
    expect(confidenceFromTag('real_audio')).toBe(confidenceFromTag('high_confidence'));
    expect(confidenceFromTag('tag_inferred')).toBe(confidenceFromTag('partial_confidence'));
    expect(confidenceFromTag('cold_start_default')).toBe(confidenceFromTag('low_confidence'));
  });
});

describe('DecisionScore ranking by confidence tag', () => {
  it('equal candidates: high_confidence outranks partial_confidence', () => {
    const base = {
      expansionDistance: 0.55,
      discoveryConfidence: 0.7,
      genres: ['house'] as string[],
    };
    const high = evaluateCandidate(
      makeCandidate({
        ...base,
        artistId: 'high-1',
        audioSource: 'high_confidence',
        confidenceTag: 'high_confidence',
      }),
      makeContext(),
      { batchDiversity: 0.6 },
    );
    const partial = evaluateCandidate(
      makeCandidate({
        ...base,
        artistId: 'part-1',
        audioSource: 'partial_confidence',
        confidenceTag: 'partial_confidence',
      }),
      makeContext(),
      { batchDiversity: 0.6 },
    );
    expect(high.dataConfidence).toBeGreaterThan(partial.dataConfidence!);
    expect(high.decisionScore).toBeGreaterThan(partial.decisionScore!);
    // Components loggable
    expect(high.tesProxy).toBeDefined();
    expect(high.readiness).toBeDefined();
    expect(high.batchDiversity).toBeDefined();
  });
});

describe('evaluateCandidateUniverse batch diversity', () => {
  it('attaches same batchDiversity to all profiles in session', () => {
    const profiles = evaluateCandidateUniverse(
      [
        makeCandidate({ artistId: '1', genres: ['house'] }),
        makeCandidate({ artistId: '2', genres: ['country'] }),
        makeCandidate({ artistId: '3', genres: ['classical'] }),
      ],
      makeContext(),
    );
    expect(profiles).toHaveLength(3);
    const d0 = profiles[0].batchDiversity;
    expect(profiles.every((p) => p.batchDiversity === d0)).toBe(true);
    expect(d0).toBeGreaterThan(0);
  });
});

describe('tesProxy pure reader', () => {
  it('uses expansionDistance when present', () => {
    expect(
      tesProxyFromCandidate({ expansionDistance: 0.42, noveltyContribution: 0.9 }),
    ).toBe(0.42);
  });
});

describe('computeDecisionScore', () => {
  it('stores components and applies cooldown', () => {
    const full = computeDecisionScore({
      tes: 0.8,
      readiness: 0.8,
      diversity: 0.8,
      confidence: 0.8,
      cooldownMultiplier: 1,
    });
    const cooled = computeDecisionScore({
      tes: 0.8,
      readiness: 0.8,
      diversity: 0.8,
      confidence: 0.8,
      cooldownMultiplier: 0,
    });
    expect(full.decisionScore).toBeGreaterThan(0);
    expect(cooled.decisionScore).toBe(0);
    expect(full.components.tes).toBe(0.8);
  });
});
