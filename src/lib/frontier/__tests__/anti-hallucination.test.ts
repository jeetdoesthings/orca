import { describe, it, expect } from 'vitest';
import {
  isValidArtistIdFormat,
  hasDisplayName,
  hasGroundedGenres,
  filterHallucinatedNodesPure,
} from '@/lib/frontier/anti-hallucination';
import type { OrcaNode } from '@/lib/graph/types';

function node(partial: Partial<OrcaNode> & { id: string; name: string }): OrcaNode {
  return {
    genres: ['house'],
    popularity: 60,
    weight: 0.5,
    state: 'frontier',
    x: 0,
    y: 0,
    z: 1.65,
    ...partial,
  } as OrcaNode;
}

describe('anti-hallucination pure gate', () => {
  it('accepts valid Spotify-shaped ids with name and grounded genres', () => {
    const id = '0OdUWJ0sBjDrqHygGUXeCF'; // 22 chars
    expect(isValidArtistIdFormat(id)).toBe(true);
    const r = filterHallucinatedNodesPure([
      node({ id, name: 'Band of Horses', genres: ['indie-rock'], imageUrl: 'https://i.scdn.co/x.jpg' }),
    ]);
    expect(r.accepted).toHaveLength(1);
    expect(r.rejected).toHaveLength(0);
  });

  it('rejects invalid ids', () => {
    expect(isValidArtistIdFormat('x')).toBe(false);
    expect(isValidArtistIdFormat('')).toBe(false);
    const r = filterHallucinatedNodesPure([node({ id: 'bad', name: 'X', genres: ['rock'] })]);
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected[0].reasons).toContain('invalid_id');
  });

  it('accepts prefixed multi-provider ids', () => {
    expect(isValidArtistIdFormat('lastfm-radiohead')).toBe(true);
    expect(isValidArtistIdFormat('spotify-1')).toBe(true);
    expect(isValidArtistIdFormat('deezer-12345')).toBe(true);
  });

  it('accepts MusicBrainz UUIDs', () => {
    const mbid = '012e3432-71d3-4317-9ce5-b60cb6cdc38f';
    expect(isValidArtistIdFormat(mbid)).toBe(true);
    const r = filterHallucinatedNodesPure([
      node({ id: mbid, name: 'The Rasmus', genres: ['rock'], imageUrl: 'https://x/y.jpg' }),
    ]);
    expect(r.accepted).toHaveLength(1);
  });

  it('rejects missing / placeholder names', () => {
    expect(hasDisplayName({ name: '  ' })).toBe(false);
    expect(hasDisplayName({ name: 'Unknown Artist' })).toBe(false);
    expect(hasDisplayName({ name: 'Aphex Twin' })).toBe(true);
  });

  it('rejects pure default pop with no image and low popularity', () => {
    expect(
      hasGroundedGenres({ genres: ['pop'], imageUrl: '', popularity: 10 }),
    ).toBe(false);
    expect(
      hasGroundedGenres({ genres: ['pop'], imageUrl: 'https://cdn.example/a.jpg', popularity: 10 }),
    ).toBe(true);
    expect(
      hasGroundedGenres({ genres: ['techno', 'ambient'], imageUrl: '', popularity: 5 }),
    ).toBe(true);
  });

  it('filters a mixed batch', () => {
    const r = filterHallucinatedNodesPure([
      node({ id: '0OdUWJ0sBjDrqHygGUXeCF', name: 'Good', genres: ['rock'] }),
      node({ id: 'nope', name: 'Bad Id', genres: ['rock'] }),
      node({ id: 'lastfm-ghost', name: 'Unknown', genres: ['ambient'] }),
      node({ id: 'spotify-seed-1', name: 'Fred again..', genres: ['house'], imageUrl: 'https://x/y' }),
    ]);
    expect(r.accepted.map((n) => n.id).sort()).toEqual(
      ['0OdUWJ0sBjDrqHygGUXeCF', 'spotify-seed-1'].sort(),
    );
    expect(r.rejected.length).toBe(2);
  });
});
