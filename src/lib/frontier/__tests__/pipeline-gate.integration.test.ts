/**
 * Integration-style test: materialization gate composition.
 *
 * Does not call Spotify/CUB end-to-end (external). Pins that the
 * anti-hallucination filter used by materializeWorld keeps only grounded
 * nodes and that expansionDistance variance is present on a sample frontier.
 */
import { describe, it, expect } from 'vitest';
import { filterHallucinatedNodesPure } from '@/lib/frontier/anti-hallucination';
import {
  computeExpansionDistanceFromInputs,
  expansionBandFromDistance,
} from '@/lib/expansion/intelligence';
import type { OrcaNode, AudioSignature } from '@/lib/graph/types';
import { SYSTEM_GENRES } from '@/lib/config/genre-adjacency';
import { GENRE_ANCHORS } from '@/lib/graph/genre-normaliser';

const SIG: AudioSignature = {
  energy: 0.5,
  valence: 0.5,
  danceability: 0.5,
  acousticness: 0.2,
  instrumentalness: 0.1,
  tempo: 120,
};

function sampleFrontier(): OrcaNode[] {
  const genres = ['house', 'techno', 'hip-hop', 'jazz', 'metal', 'pop'] as const;
  return genres.map((g, i) => {
    const id = `0OdUWJ0sBjDrqHygGUXeC${i}`; // 22-char-ish base62
    const padded = (id + 'XXXXXXXXXXXXXXXXXXXXXX').slice(0, 22);
    const dist = computeExpansionDistanceFromInputs({
      userCentroid: SIG,
      userGenreProfile: new Map([['pop', 1], ['house', 0.4]]),
      relationships: [],
      candidateGenres: [g],
      candidateSignature: { ...SIG, energy: 0.2 + i * 0.12 },
      candidatePopularity: 30 + i * 10,
      audioSource: 'REAL',
    });
    return {
      id: padded,
      name: `Artist ${g}`,
      genres: [g],
      popularity: 40 + i * 8,
      imageUrl: `https://cdn.example/${g}.jpg`,
      weight: 0.5,
      state: 'frontier' as const,
      expansionDistance: dist,
      expansionBand: expansionBandFromDistance(dist),
      x: 0,
      y: 0,
      z: 1.65,
    } as OrcaNode;
  });
}

describe('pipeline gate integration (pure)', () => {
  it('anti-hallucination keeps grounded sample and drops junk', () => {
    const good = sampleFrontier();
    const junk: OrcaNode[] = [
      {
        id: 'x',
        name: 'Ghost',
        genres: ['pop'],
        popularity: 5,
        imageUrl: '',
        weight: 0.1,
        state: 'frontier',
        x: 0,
        y: 0,
        z: 1,
      } as OrcaNode,
    ];
    const r = filterHallucinatedNodesPure([...good, ...junk]);
    expect(r.accepted.length).toBe(good.length);
    expect(r.rejected.some((x) => x.id === 'x')).toBe(true);
  });

  it('sample frontier has non-collapsed expansionDistance spread', () => {
    const nodes = sampleFrontier();
    const distances = nodes.map((n) => n.expansionDistance ?? 0);
    const min = Math.min(...distances);
    const max = Math.max(...distances);
    expect(max - min).toBeGreaterThan(0.05);
    const bands = new Set(nodes.map((n) => n.expansionBand));
    expect(bands.size).toBeGreaterThanOrEqual(1);
  });

  it('GRE SYSTEM_GENRES covers layout GENRE_ANCHORS keys', () => {
    const system = new Set(SYSTEM_GENRES);
    for (const key of Object.keys(GENRE_ANCHORS)) {
      expect(system.has(key)).toBe(true);
    }
    expect(SYSTEM_GENRES.length).toBe(25);
  });
});
