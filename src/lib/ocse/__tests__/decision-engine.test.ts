/**
 * INV-5 (single source of expansionDistance) — OCSE layer.
 *
 * Phase 2 P0-1 makes OCSE a pure reader of `expansionDistance` (RULE-10). These
 * tests pin the new contract:
 *
 *   1. When a Candidate carries a real `expansionDistance` (threaded by the
 *      Expansion Intelligence pre-pass), OCSE surfaces that exact value on the
 *      returned DecisionProfile — byte-equal, no recomputation.
 *   2. When the Candidate does NOT carry one, OCSE leaves the field undefined.
 *      It MUST NOT invent a value. (The pre-P0-1 code fabricated one via a
 *      5-weight blend; that formula was deleted and this test guards against
 *      its return.)
 *
 * Together with intelligence.test.ts (the Expansion Intelligence layer), these
 * two facts enforce INV-5: the value that reaches the OrcaNode is the same
 * value Expansion Intelligence computed.
 *
 * No DB/network — `evaluateCandidate` is a pure function over its inputs.
 */
import { describe, it, expect } from 'vitest';
import {
  evaluateCandidate,
  computeGrowthContribution,
} from '@/lib/ocse/decision-engine';
import { OcseConfig } from '@/lib/config/ocse';
import type { Candidate } from '@/lib/candidate/cub-types';
import type { OCSEContext } from '@/lib/ocse/ocse-types';

function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    artistId: 'test-artist-1',
    name: 'Test Artist',
    genres: ['pop'],
    popularity: 50,
    imageUrl: '',
    discoveryContext: {
      growthOpportunity: 'pop',
      relationshipStage: 'EXPLORING',
      supportingArtists: [],
      sources: [],
    },
    discoveryConfidence: 0.7,
    candidateClassification: 'EXPANSION',
    audioSource: 'MISSING',
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
    },
    currentVisibleWorldIds: [],
    ...overrides,
  };
}

describe('OCSE expansionDistance handling (INV-5 — pure reader)', () => {
  it('surfaces the Candidate.expansionDistance value verbatim when present', () => {
    // The threaded value comes from Expansion Intelligence in the real pipeline.
    // OCSE must not round, clamp, blend, or otherwise alter it.
    const threaded = 0.42;
    const candidate = makeCandidate({ expansionDistance: threaded });
    const profile = evaluateCandidate(candidate, makeContext());
    expect(profile.expansionDistance).toBe(threaded);
  });

  it('surfaces Candidate.audioSource verbatim (P1-10 pure reader)', () => {
    const candidate = makeCandidate({ audioSource: 'REAL', expansionDistance: 0.3 });
    const profile = evaluateCandidate(candidate, makeContext());
    expect(profile.audioSource).toBe('REAL');
  });

  it('returns undefined when the Candidate carries no expansionDistance', () => {
    // This is the /api/debug/ocse path — no Expansion Intelligence pre-pass.
    // OCSE must leave the field undefined rather than fabricating a fallback.
    const candidate = makeCandidate(); // no expansionDistance field
    const profile = evaluateCandidate(candidate, makeContext());
    expect(profile.expansionDistance).toBeUndefined();
  });

  it('does not fabricate a value from popularity/discoveryConfidence', () => {
    // Pre-P0-1, OCSE computed a blend including `obscurity = 1 - popularity/100`
    // and `(1 - discoveryConfidence)`. Verify no such recomputation leaks back
    // in: two candidates with wildly different popularity/discovery but the
    // SAME (undefined) expansion field must both yield undefined.
    const lowPop = evaluateCandidate(
      makeCandidate({ popularity: 1, discoveryConfidence: 0.99 }),
      makeContext(),
    );
    const highPop = evaluateCandidate(
      makeCandidate({ popularity: 99, discoveryConfidence: 0.01 }),
      makeContext(),
    );
    expect(lowPop.expansionDistance).toBeUndefined();
    expect(highPop.expansionDistance).toBeUndefined();
  });

  it('preserves the threaded value regardless of OCSE decision quality', () => {
    // A candidate that OCSE scores poorly (high cooldown, low support) must
    // still carry the real distance — distance and decision quality are
    // independent concepts (confidence.md §6).
    const threaded = 0.88;
    const candidate = makeCandidate({
      expansionDistance: threaded,
      artistId: 'integrated-artist',
    });
    const context = makeContext({
      interactionHistory: {
        timesShown: {},
        timesIgnored: {},
        timesDismissed: {},
        timesIntegrated: { 'integrated-artist': 1 }, // forces cooldownMultiplier = 0
        lastShown: {},
      },
    });
    const profile = evaluateCandidate(candidate, context);
    expect(profile.decisionConfidence).toBe(0); // cooldown worked
    expect(profile.expansionDistance).toBe(threaded); // distance untouched
  });

  it('other DecisionProfile fields are still computed (regression guard)', () => {
    // Confirm the P0-1 surgery didn't accidentally break the rest of the
    // decision engine. decisionConfidence should still be a number in [0,1].
    const profile = evaluateCandidate(
      makeCandidate({ expansionDistance: 0.3 }),
      makeContext(),
    );
    expect(typeof profile.decisionConfidence).toBe('number');
    expect(profile.decisionConfidence).toBeGreaterThanOrEqual(0);
    expect(profile.decisionConfidence).toBeLessThanOrEqual(1);
    expect(profile.decisionReasons.length).toBeGreaterThan(0);
    expect(profile.candidateId).toBe('test-artist-1');
  });
});

describe('OCSE growthContribution (P1-6 — currentVisibleWorldIds)', () => {
  const g = OcseConfig.growthContribution;

  it('returns alreadyVisible when candidate is in currentVisibleWorldIds', () => {
    expect(
      computeGrowthContribution('artist-a', 0.9, ['artist-a', 'artist-b']),
    ).toBe(g.alreadyVisible);
  });

  it('returns emptyWorld when visible set is empty', () => {
    expect(computeGrowthContribution('artist-a', 0.0, [])).toBe(g.emptyWorld);
  });

  it('blends inverse diversity with baseNew when not yet visible', () => {
    // diversity 0 → inverse 1 → 1*0.6 + 0.4*0.4 = 0.76
    expect(computeGrowthContribution('new-artist', 0.0, ['old-1'])).toBe(0.76);
    // diversity 1 → inverse 0 → 0*0.6 + 0.4*0.4 = 0.16
    expect(computeGrowthContribution('new-artist', 1.0, ['old-1'])).toBe(0.16);
  });

  it('evaluateCandidate uses visible set for growthContribution', () => {
    const already = evaluateCandidate(
      makeCandidate({ artistId: 'shown-1' }),
      makeContext({ currentVisibleWorldIds: ['shown-1', 'shown-2'] }),
    );
    expect(already.growthContribution).toBe(g.alreadyVisible);

    const fresh = evaluateCandidate(
      makeCandidate({ artistId: 'brand-new' }),
      makeContext({ currentVisibleWorldIds: ['shown-1'] }),
    );
    expect(fresh.growthContribution).toBeGreaterThan(g.alreadyVisible);
    expect(fresh.growthContribution).toBeLessThanOrEqual(1);
  });
});
