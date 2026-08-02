import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { retrieveCandidatePool } from '@/lib/retrieval/candidate-retriever';
import type { TasteIdentity } from '@/lib/identity/orca-identity';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    artist: {
      findMany: vi.fn(async () => [
        {
          id: 'sp-local',
          spotifyId: 'sp-local',
          displayName: 'Local Artist',
          rawGenres: JSON.stringify(['jazz']),
          popularity: 40,
          sourceEvidence: 'seeded',
          metadata: JSON.stringify({ musicBrainzId: 'mb-local' }),
        },
        {
          id: 'known',
          spotifyId: 'known',
          displayName: 'Known Artist',
          rawGenres: JSON.stringify(['jazz']),
          popularity: 80,
          sourceEvidence: 'seeded',
          metadata: null,
        },
      ]),
    },
  },
}));

// Audit fix M6: this test used to hit the live MusicBrainz API through
// retrieveCandidatePool's mbSeeds loop — flaky and slow under parallel load.
// Stub all outbound HTTP so the test is hermetic and fast.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => '' })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const identity: TasteIdentity = {
  userId: 'u1',
  homeTerritory: { genres: ['jazz'], primaryGenre: 'jazz' },
  exploredTerritory: { genres: ['jazz'], artistCount: 1 },
  integratedArtists: [{ id: 'known', name: 'Known Artist', genres: ['jazz'], weight: 1, source: 'test' }],
  rejectedArtists: [],
  ignoredArtists: [],
  expansionHistory: [],
  listeningHistory: [],
  currentFrontier: [],
  tasteDrift: { recentGenres: [], longTermGenres: ['jazz'], driftScore: 0 },
  longTermPreferences: { genres: [{ genre: 'jazz', weight: 1 }], artists: [] },
};

describe('candidate retriever', () => {
  it('dedupes aliases/known artists and emits MusicBrainz-grounded local candidates', async () => {
    const result = await retrieveCandidatePool(identity, '', [
      {
        artistId: 'sp-local',
        name: 'Local Artist',
        genres: ['jazz'],
        popularity: 40,
        imageUrl: '',
        discoveryContext: {
          growthOpportunity: 'jazz',
          relationshipStage: 'seed',
          supportingArtists: [],
          sources: [],
        },
        discoveryConfidence: 0.7,
        candidateClassification: 'DISCOVERY',
        audioSource: 'partial_confidence',
      },
    ]);

    expect(result.artists.map((a) => a.canonicalName)).toContain('Local Artist');
    expect(result.artists.map((a) => a.canonicalName)).not.toContain('Known Artist');
    expect(result.artists.find((a) => a.canonicalName === 'Local Artist')?.musicBrainzId).toBe('mb-local');
  });
});

