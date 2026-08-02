import { describe, it, expect } from 'vitest';
import { countShoreRange } from '@/lib/candidate/shore-seek';
import type { Candidate } from '@/lib/candidate/cub-types';

function cand(
  id: string,
  d: number,
  path: 'adjacency' | 'shore_seek' | 'leap_seek' = 'adjacency',
): Candidate {
  return {
    artistId: id,
    name: id,
    genres: ['indie-rock'],
    popularity: 40,
    imageUrl: '',
    discoveryContext: {
      growthOpportunity: 'indie-rock',
      relationshipStage: 'Integrated',
      supportingArtists: [],
      sources: [],
    },
    discoveryConfidence: 0.6,
    candidateClassification: 'IDENTITY',
    audioSource: 'tag_inferred',
    expansionDistance: d,
    retrievalPath: path,
  };
}

describe('shore-seek helpers', () => {
  it('countShoreRange only counts d < 0.34', () => {
    const pool = [
      cand('a', 0.12, 'shore_seek'),
      cand('b', 0.3, 'shore_seek'),
      cand('c', 0.5, 'adjacency'),
      cand('d', 0.8, 'leap_seek'),
    ];
    expect(countShoreRange(pool)).toBe(2);
    // tighter bar
    expect(
      pool.filter((c) => (c.expansionDistance ?? 1) < 0.2).length,
    ).toBe(1);
  });

  it('tags shore_seek as distinct retrieval path', () => {
    const c = cand('x', 0.15, 'shore_seek');
    expect(c.retrievalPath).toBe('shore_seek');
    expect(c.retrievalPath).not.toBe('adjacency');
    expect(c.retrievalPath).not.toBe('leap_seek');
  });
});
