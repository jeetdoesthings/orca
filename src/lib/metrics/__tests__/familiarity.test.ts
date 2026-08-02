/**
 * Part 2 — prior incidental Familiarity = plays / (plays + k)
 */
import { describe, it, expect } from 'vitest';
import { priorFamiliarity, estimatedPlaysFromWeight } from '@/lib/metrics/familiarity';
import { ExpansionConfig } from '@/lib/config/expansion';

describe('priorFamiliarity', () => {
  it('zero exposure → 0', () => {
    expect(priorFamiliarity(0)).toBe(0);
    expect(priorFamiliarity(0, 5)).toBe(0);
  });

  it('high exposure approaches 1', () => {
    expect(priorFamiliarity(1000, 5)).toBeCloseTo(1000 / 1005, 5);
    expect(priorFamiliarity(1000, 5)).toBeGreaterThan(0.99);
  });

  it('mid-range and different k values', () => {
    // plays=5, k=5 → 0.5
    expect(priorFamiliarity(5, 5)).toBeCloseTo(0.5, 5);
    // same plays, larger k → lower familiarity
    expect(priorFamiliarity(5, 20)).toBeCloseTo(5 / 25, 5);
    expect(priorFamiliarity(5, 20)).toBeLessThan(priorFamiliarity(5, 5));
    // default k from config
    const k = ExpansionConfig.priorFamiliarityK;
    expect(priorFamiliarity(k)).toBeCloseTo(0.5, 5);
  });

  it('negative / NaN plays treated as 0', () => {
    expect(priorFamiliarity(-3)).toBe(0);
    expect(priorFamiliarity(Number.NaN)).toBe(0);
  });
});

describe('estimatedPlaysFromWeight', () => {
  it('zero weight → 0 plays', () => {
    expect(estimatedPlaysFromWeight(0)).toBe(0);
  });

  it('positive weight → at least 1', () => {
    expect(estimatedPlaysFromWeight(0.01)).toBeGreaterThanOrEqual(1);
    expect(estimatedPlaysFromWeight(1)).toBe(ExpansionConfig.priorFamiliarityWeightScale);
  });
});
