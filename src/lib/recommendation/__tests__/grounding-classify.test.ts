import { describe, expect, it } from 'vitest';
import { groundLLMRecommendations } from '@/lib/recommendation/grounding';
import { classifyAndValidateSurface } from '@/lib/recommendation/classify-surface';
import type { Candidate } from '@/lib/candidate/cub-types';
import type { TasteIdentity } from '@/lib/identity/orca-identity';
import type { RetrievedArtist } from '@/lib/retrieval/types';
import type { OrcaNode } from '@/lib/graph/types';

const candidate = (id: string, name: string, genres: string[]): Candidate => ({
  artistId: id,
  name,
  genres,
  popularity: 50,
  imageUrl: '',
  discoveryContext: {
    growthOpportunity: genres[0],
    relationshipStage: 'LLM_GROUNDED',
    supportingArtists: ['seed'],
    sources: [{ type: 'GENRE_EXPANSION', source: 'test', strength: 0.9, confidence: 0.9, metadata: {} }],
  },
  discoveryConfidence: 0.9,
  candidateClassification: 'DISCOVERY',
  audioSource: 'high_confidence',
  confidenceTag: 'high_confidence',
});

const retrieved = (id: string, name: string, genres: string[]): RetrievedArtist => ({
  canonicalName: name,
  musicBrainzId: `mb-${id}`,
  spotifyId: id,
  aliases: [],
  genres,
  tags: genres,
  releases: [{ title: `${name} Album` }],
  relationships: [],
  popularity: 50,
  availability: { spotify: true },
  evidence: [{ source: 'musicbrainz', id: `mb-${id}`, confidence: 0.92 }],
  retrievalPath: 'adjacency',
});

const identity: TasteIdentity = {
  userId: 'u1',
  homeTerritory: { genres: ['jazz'], primaryGenre: 'jazz' },
  exploredTerritory: { genres: ['jazz'], artistCount: 20 },
  integratedArtists: [{ id: 'seed', name: 'Seed', genres: ['jazz'], weight: 1, source: 'test' }],
  rejectedArtists: [{ id: 'bad', name: 'Bad', genres: [], weight: 0, source: 'test' }],
  ignoredArtists: [],
  expansionHistory: [],
  listeningHistory: [],
  currentFrontier: [],
  tasteDrift: { recentGenres: ['jazz'], longTermGenres: ['jazz'], driftScore: 0.1 },
  longTermPreferences: { genres: [{ genre: 'jazz', weight: 1 }], artists: [] },
};

const explored: OrcaNode[] = [
  {
    id: 'seed',
    name: 'Seed',
    genres: ['jazz'],
    popularity: 40,
    imageUrl: '',
    weight: 1,
    state: 'explored',
    audioSignature: {
      energy: 0.4,
      valence: 0.4,
      danceability: 0.4,
      acousticness: 0.4,
      instrumentalness: 0.4,
      tempo: 100,
    },
  },
];

describe('grounding and distance classification', () => {
  it('rejects blocked artists during grounding', async () => {
    const verified = await groundLLMRecommendations({
      recommendations: [
        {
          artistId: 'bad',
          artist: 'Bad',
          rank: 1,
          distanceIntent: 'Deep',
          gatewayPath: [],
          territoryFraming: '',
          explanation: '',
          albumSuggestions: [],
          evidenceIds: [],
        },
      ],
      candidatePool: [retrieved('bad', 'Bad', ['jazz'])],
      candidates: [candidate('bad', 'Bad', ['jazz'])],
      knownIds: new Set(),
      ignoredIds: new Set(),
      rejectedIds: new Set(['bad']),
      integratedIds: new Set(),
    });

    expect(verified[0].accepted).toBe(false);
    expect(verified[0].rejectionReasons).toContain('blocked_artist_id');
  });

  it('maps accepted fixtures into Shore/Shallow/Deep buckets', async () => {
    const pool = [
      retrieved('shore', 'Shore Artist', ['jazz']),
      retrieved('shallow', 'Shallow Artist', ['soul']),
      retrieved('deep', 'Deep Artist', ['gamelan']),
    ];
    const candidates = pool.map((p) => candidate(p.spotifyId!, p.canonicalName, p.genres));
    const verified = await groundLLMRecommendations({
      recommendations: [
        { artistId: 'shore', artist: 'Shore Artist', rank: 1, distanceIntent: 'Shore', gatewayPath: [], territoryFraming: '', explanation: '', albumSuggestions: [], evidenceIds: [] },
        { artistId: 'shallow', artist: 'Shallow Artist', rank: 2, distanceIntent: 'Shallow', gatewayPath: [], territoryFraming: '', explanation: '', albumSuggestions: [], evidenceIds: [] },
        { artistId: 'deep', artist: 'Deep Artist', rank: 3, distanceIntent: 'Deep', gatewayPath: [], territoryFraming: '', explanation: '', albumSuggestions: [], evidenceIds: [] },
      ],
      candidatePool: pool,
      candidates,
      knownIds: new Set(),
      ignoredIds: new Set(),
      rejectedIds: new Set(),
      integratedIds: new Set(),
    });
    const surface = classifyAndValidateSurface({
      userId: 'u1',
      identity,
      verified,
      candidates,
      exploredArtists: explored,
      userCentroid: explored[0].audioSignature,
      userGenreProfile: new Map([['jazz', 1]]),
      realAudioById: new Map(),
    }).surface;

    expect(surface.comfort.map((p) => p.candidateId)).toContain('shore');
    expect(surface.expansion.map((p) => p.candidateId)).toContain('shallow');
    expect(surface.leap.map((p) => p.candidateId)).toContain('deep');
  });

  it('demotes claimed-far intent when measured distance is very close (sanity gate)', async () => {
    // Regression: a candidate claiming Deep intent but measuring < 0.34 must
    // NOT land in the leap bucket — that was the fake-leap-bucket path.
    const closeButClaimsDeep = [
      candidate('shore', 'Shore Artist', ['jazz']),
      candidate('shallow', 'Shallow Artist', ['soul']),
      candidate('deep', 'Deep Artist', ['gamelan']),
    ];
    const verified = await groundLLMRecommendations({
      recommendations: [
        { artistId: 'shore', artist: 'Shore Artist', rank: 1, distanceIntent: 'Deep', gatewayPath: [], territoryFraming: '', explanation: '', albumSuggestions: [], evidenceIds: [] },
        { artistId: 'shallow', artist: 'Shallow Artist', rank: 2, distanceIntent: 'Shallow', gatewayPath: [], territoryFraming: '', explanation: '', albumSuggestions: [], evidenceIds: [] },
        { artistId: 'deep', artist: 'Deep Artist', rank: 3, distanceIntent: 'Deep', gatewayPath: [], territoryFraming: '', explanation: '', albumSuggestions: [], evidenceIds: [] },
      ],
      candidatePool: [
        retrieved('shore', 'Shore Artist', ['jazz']),
        retrieved('shallow', 'Shallow Artist', ['soul']),
        retrieved('deep', 'Deep Artist', ['gamelan']),
      ],
      candidates: closeButClaimsDeep,
      knownIds: new Set(),
      ignoredIds: new Set(),
      rejectedIds: new Set(),
      integratedIds: new Set(),
    });
    const surface = classifyAndValidateSurface({
      userId: 'u1',
      identity,
      verified,
      candidates: closeButClaimsDeep,
      exploredArtists: explored,
      userCentroid: explored[0].audioSignature,
      userGenreProfile: new Map([['jazz', 1]]),
      realAudioById: new Map(),
    }).surface;

    // shore claims Deep but jazz-from-jazz distance is ~0 — must not be leap.
    // It should be demoted out of leap into comfort/expansion.
    expect(surface.leap.map((p) => p.candidateId)).not.toContain('shore');
  });
});

