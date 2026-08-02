/**
 * Part 3 — Cultural Distance: linguistic + scene + era
 */
import { describe, it, expect } from 'vitest';
import {
  computeCulturalDistance,
  sceneGraphDistance,
  eraDistance,
} from '@/lib/expansion/cultural-distance';
import { languageFamilyDistance, linguisticDistanceFromGenres } from '@/lib/expansion/language-families';

describe('linguistic axis', () => {
  it('same family closer than distant families', () => {
    expect(languageFamilyDistance('romance', 'romance')).toBe(0);
    expect(languageFamilyDistance('romance', 'germanic')).toBeLessThan(
      languageFamilyDistance('romance', 'japonic'),
    );
  });

  it('latin vs pop closer linguistically than k-pop vs latin', () => {
    const sameish = linguisticDistanceFromGenres(['latin'], ['latin', 'pop']);
    const far = linguisticDistanceFromGenres(['latin'], ['k-pop']);
    expect(sameish).toBeLessThan(far);
  });
});

describe('scene graph axis', () => {
  it('same genre → 0', () => {
    expect(sceneGraphDistance(['house'], ['house'])).toBe(0);
  });

  it('adjacent genres closer than far hop', () => {
    const near = sceneGraphDistance(['house'], ['techno']);
    const far = sceneGraphDistance(['house'], ['country']);
    expect(near).toBeLessThan(far);
  });
});

describe('era axis', () => {
  it('same year → 0', () => {
    expect(eraDistance(2000, 2000)).toBe(0);
  });

  it('large year gap → high distance', () => {
    expect(eraDistance(1960, 2020)).toBeGreaterThan(eraDistance(2010, 2015));
  });

  it('missing years use default not zero', () => {
    const d = eraDistance(null, 2010);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(1);
  });
});

describe('computeCulturalDistance composite', () => {
  it('same scene/era/language → low distance', () => {
    const profile = new Map([
      ['house', 0.6],
      ['techno', 0.4],
    ]);
    const r = computeCulturalDistance({
      userGenreProfile: profile,
      candidateGenres: ['house'],
      userEraYear: 2010,
      candidateEraYear: 2012,
    });
    expect(r.distance).toBeLessThan(0.35);
    expect(r.confidenceTag).toBe('partial_confidence');
  });

  it('maximally different axes → high distance', () => {
    // country ↔ classical: multi-hop scene, different era centers, far year gap
    const profile = new Map([['country', 1.0]]);
    const r = computeCulturalDistance({
      userGenreProfile: profile,
      candidateGenres: ['classical'],
      userEraYear: 1970,
      candidateEraYear: 1850,
    });
    expect(r.distance).toBeGreaterThan(0.25);
    const close = computeCulturalDistance({
      userGenreProfile: profile,
      candidateGenres: ['country'],
      userEraYear: 1995,
      candidateEraYear: 1998,
    });
    expect(r.distance).toBeGreaterThan(close.distance);
  });

  it('partial overlap mid-range', () => {
    const profile = new Map([
      ['hip-hop', 0.7],
      ['rnb', 0.3],
    ]);
    const same = computeCulturalDistance({
      userGenreProfile: profile,
      candidateGenres: ['hip-hop'],
    });
    const partial = computeCulturalDistance({
      userGenreProfile: profile,
      candidateGenres: ['trap', 'drill'],
    });
    const far = computeCulturalDistance({
      userGenreProfile: profile,
      candidateGenres: ['classical'],
    });
    expect(same.distance).toBeLessThan(partial.distance);
    expect(partial.distance).toBeLessThanOrEqual(far.distance + 0.05);
  });
});
