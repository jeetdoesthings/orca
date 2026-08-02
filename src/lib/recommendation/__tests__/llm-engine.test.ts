import { describe, expect, it } from 'vitest';
import { __test__ } from '@/lib/recommendation/llm-engine';
import type { TasteIdentity } from '@/lib/identity/orca-identity';
import type { RetrievedArtist } from '@/lib/retrieval/types';

const identity: TasteIdentity = {
  userId: 'u1',
  homeTerritory: { genres: ['jazz'], primaryGenre: 'jazz' },
  exploredTerritory: { genres: ['jazz'], artistCount: 1 },
  integratedArtists: [{ id: 'known', name: 'Known Artist', genres: ['jazz'], weight: 1, source: 'test' }],
  rejectedArtists: [{ id: 'reject', name: 'Reject Artist', genres: [], weight: 0, source: 'test' }],
  ignoredArtists: [{ id: 'ignore', name: 'Ignore Artist', genres: [], weight: 0, source: 'test' }],
  expansionHistory: [],
  listeningHistory: [],
  currentFrontier: [{ id: 'frontier', name: 'Frontier Artist', genres: [], weight: 0, source: 'test' }],
  tasteDrift: { recentGenres: [], longTermGenres: ['jazz'], driftScore: 0 },
  longTermPreferences: { genres: [{ genre: 'jazz', weight: 1 }], artists: [] },
};

const pool: RetrievedArtist[] = [
  {
    canonicalName: 'Grounded Artist',
    musicBrainzId: 'mb1',
    spotifyId: 'sp1',
    aliases: [],
    genres: ['spiritual jazz'],
    tags: ['spiritual jazz'],
    releases: [],
    relationships: [],
    popularity: 55,
    availability: { spotify: true },
    evidence: [{ source: 'musicbrainz', id: 'mb1', confidence: 0.9 }],
    retrievalPath: 'adjacency',
  },
];

function input() {
  return {
    identity,
    knownArtistIds: ['known'],
    ignoredArtistIds: ['ignore'],
    rejectedArtistIds: ['reject'],
    integratedArtistIds: ['known'],
    currentFrontierIds: ['frontier'],
    goals: [],
    candidatePool: pool,
  };
}

describe('LLM recommendation schema validation', () => {
  it('rejects hallucinated artists outside the candidate pool', () => {
    const result = __test__.validateRecommendations(
      {
        recommendations: [
          {
            artistId: 'missing',
            artist: 'Invented Artist',
            rank: 1,
            distanceIntent: 'Deep',
            gatewayPath: [],
            territoryFraming: '',
            explanation: '',
            albumSuggestions: [],
            evidenceIds: [],
          },
        ],
      },
      input(),
    );

    expect(result.recommendations).toHaveLength(0);
    expect(result.errors.join(' ')).toContain('Unknown candidate id');
  });

  it('rejects duplicate and known artists', () => {
    const result = __test__.validateRecommendations(
      {
        recommendations: [
          {
            artistId: 'sp1',
            artist: 'Grounded Artist',
            rank: 1,
            distanceIntent: 'Shore',
            gatewayPath: [],
            territoryFraming: '',
            explanation: '',
            albumSuggestions: [],
            evidenceIds: [],
          },
          {
            artistId: 'sp1',
            artist: 'Grounded Artist',
            rank: 2,
            distanceIntent: 'Shore',
            gatewayPath: [],
            territoryFraming: '',
            explanation: '',
            albumSuggestions: [],
            evidenceIds: [],
          },
        ],
      },
      input(),
    );

    expect(result.recommendations).toHaveLength(1);
    expect(result.errors.join(' ')).toContain('Duplicate recommendation');
  });
});

