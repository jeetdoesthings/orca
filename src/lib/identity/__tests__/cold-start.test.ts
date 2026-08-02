/**
 * Part 10 — cold-start assessment, onboarding centroid, wider pool policy.
 */
import { describe, it, expect } from 'vitest';
import {
  assessColdStart,
  centroidFromOnboardingPicks,
  allowedConfidenceTags,
  isConfidenceAllowedForUser,
  minFrontierForUser,
} from '@/lib/identity/cold-start';
import { ExpansionConfig } from '@/lib/config/expansion';

describe('assessColdStart', () => {
  it('new user with zero history is cold-start', () => {
    const a = assessColdStart({ exploredArtistCount: 0, listeningEventCount: 0 });
    expect(a.coldStart).toBe(true);
    expect(a.reason).toBe('no_identity');
  });

  it('established user is not cold-start', () => {
    const a = assessColdStart({
      exploredArtistCount: 20,
      listeningEventCount: 100,
    });
    expect(a.coldStart).toBe(false);
    expect(a.reason).toBe('established');
  });
});

describe('onboarding centroid', () => {
  it('builds centroid from few genre picks', () => {
    const r = centroidFromOnboardingPicks({
      genres: ['house', 'techno', 'jazz'],
    });
    expect(r.genres.length).toBeGreaterThan(0);
    expect(r.centroid.energy).toBeGreaterThan(0);
    expect(r.confidenceTag).toBe('partial_confidence');
  });

  it('empty picks get low_confidence centroid', () => {
    const r = centroidFromOnboardingPicks({});
    expect(r.confidenceTag).toBe('low_confidence');
  });
});

describe('wider confidence-tolerant pool', () => {
  it('cold-start allows low_confidence; established may not', () => {
    expect(isConfidenceAllowedForUser(true, 'low_confidence')).toBe(true);
    expect(isConfidenceAllowedForUser(true, 'partial_confidence')).toBe(true);
    expect(isConfidenceAllowedForUser(true, 'high_confidence')).toBe(true);
    // Legacy aliases still accepted via normalize
    expect(isConfidenceAllowedForUser(true, 'cold_start_default')).toBe(true);

    const established = allowedConfidenceTags(false);
    expect(established).toContain('high_confidence');
    expect(established).toContain('partial_confidence');
    expect(established.includes('low_confidence')).toBe(false);
    expect(isConfidenceAllowedForUser(false, 'low_confidence')).toBe(false);
  });

  it('cold-start min frontier > established min frontier', () => {
    const cold = minFrontierForUser(true);
    const est = minFrontierForUser(false);
    expect(cold).toBeGreaterThan(est);
    expect(cold).toBe(ExpansionConfig.coldStart.minFrontierCandidates);
  });
});
