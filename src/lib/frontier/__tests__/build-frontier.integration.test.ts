/**
 * Real pipeline integration test for buildFrontierNodes.
 *
 * Runs the full CUB → identity → GRE → Readiness → shore-seek / leap-seek →
 * retrieval → deterministic fallback → grounding → surface → layout path
 * against a seeded dev.db user. External calls are disabled so the test is
 * deterministic and does not hit Spotify/Last.fm/Gemini.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildFrontierNodes } from '@/lib/frontier/buildFrontierNodes';
import { prisma } from '@/lib/prisma';
import type { OrcaNode } from '@/lib/graph/types';

/**
 * Audit fix M6: the shared token-bucket limiters (musicbrainz 1 rps, lastfm 5
 * rps, deezer 5 rps, …) used to block the ~120-artist enrichment backfill for
 * minutes even with the fetch stub in place, timing out the suite. No-op them
 * in tests — real limiter behavior is covered by rate-limiter unit tests.
 */
vi.mock('@/lib/utils/rate-limiter', () => {
  const noop = async () => undefined;
  return {
    TokenBucketLimiter: class {
      constructor() {
        /* no-op */
      }
      acquire() {
        return Promise.resolve();
      }
      refill() {
        /* no-op */
      }
    },
    spotifyLimiter: { acquire: noop },
    lastfmLimiter: { acquire: noop },
    musicbrainzLimiter: { acquire: noop },
    discogsLimiter: { acquire: noop },
    deezerLimiter: { acquire: noop },
    wikipediaLimiter: { acquire: noop },
  };
});

const makeArtistId = (name: string) =>
  `art_${name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16)}_${Date.now()}`;

const makeUserId = () => `int_pipeline_${Date.now()}`;

function makeNode(id: string, name: string, genres: string[], popularity: number): OrcaNode {
  return {
    id,
    name,
    genres,
    popularity,
    imageUrl: `https://cdn.example/${id}.jpg`,
    weight: 0.8,
    state: 'explored',
    audioSignature: {
      energy: 0.5,
      valence: 0.5,
      danceability: 0.5,
      acousticness: 0.3,
      instrumentalness: 0.1,
      tempo: 120,
    },
  } as OrcaNode;
}

describe('buildFrontierNodes real pipeline integration', () => {
  const originalLastFmKey = process.env.LASTFM_API_KEY;
  const spotifyId = makeUserId();
  let userId: string;
  const artistIds: string[] = [];

  beforeAll(async () => {
    // Disable live Last.fm calls and stub all outbound HTTP so the test is
    // offline-safe and does not pay network timeout costs.
    process.env.LASTFM_API_KEY = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => ({}),
        text: async () => '',
      })),
    );

    const user = await prisma.user.create({
      data: {
        spotifyId,
        email: `${spotifyId}@example.com`,
      },
    });
    userId = user.id;

    // Seed a small catalog:
    //   - two explored pop artists
    //   - low-popularity pop artists for shore-seek deep cuts
    //   - house/techno artists for catalog fill / leap-seek
    const artists = [
      { id: makeArtistId('explored_pop_1'), name: 'Explored Pop 1', genres: ['pop'], popularity: 75 },
      { id: makeArtistId('explored_pop_2'), name: 'Explored Pop 2', genres: ['pop', 'dance-pop'], popularity: 70 },
      { id: makeArtistId('shore_pop_1'), name: 'Shore Pop 1', genres: ['pop'], popularity: 22 },
      { id: makeArtistId('shore_pop_2'), name: 'Shore Pop 2', genres: ['pop'], popularity: 18 },
      { id: makeArtistId('catalog_house_1'), name: 'Catalog House 1', genres: ['house', 'deep-house'], popularity: 55 },
      { id: makeArtistId('catalog_techno_1'), name: 'Catalog Techno 1', genres: ['techno'], popularity: 50 },
    ];

    for (const a of artists) {
      artistIds.push(a.id);
      await prisma.artist.create({
        data: {
          id: a.id,
          displayName: a.name,
          normalizedName: a.name.toLowerCase(),
          rawGenres: JSON.stringify(a.genres),
          popularity: a.popularity,
          followers: 0,
          imageUrl: `https://cdn.example/${a.id}.jpg`,
        },
      });
    }

    // One listen event to give GRE a signal.
    await prisma.userListeningEvent.create({
      data: {
        userId: spotifyId,
        artistId: artists[0].id,
        eventType: 'PLAY',
        timestamp: new Date(),
      },
    });
  });

  afterAll(async () => {
    // Restore environment.
    vi.unstubAllGlobals();
    if (originalLastFmKey === undefined) {
      delete process.env.LASTFM_API_KEY;
    } else {
      process.env.LASTFM_API_KEY = originalLastFmKey;
    }

    // Clean up seeded data.
    await prisma.userListeningEvent.deleteMany({ where: { userId } });
    await prisma.recommendationServeLog.deleteMany({ where: { userId } });
    await prisma.recommendationMemory.deleteMany({ where: { userId } });
    await prisma.recommendationRun.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.artist.deleteMany({ where: { id: { in: artistIds } } });
  });

  it(
    'produces a frontier, surface, readiness, and no serve-log failure',
    async () => {
    const explored: OrcaNode[] = [
      makeNode(artistIds[0], 'Explored Pop 1', ['pop'], 75),
      makeNode(artistIds[1], 'Explored Pop 2', ['pop', 'dance-pop'], 70),
    ];

    const result = await buildFrontierNodes(explored, '', spotifyId, { skipOcse: true });

    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.surface).not.toBeNull();
    expect(result.readiness).not.toBeNull();
    expect(result.readiness?.recommendedTier).toBeOneOf(['comfort', 'expansion', 'leap']);
    expect(result.serveLogFailure).toBe(false);
    expect(result.leapSeekMeta).toBeDefined();
    expect(result.leapSeekMeta.targetedTerritories).toBeDefined();

    // The deterministic LLM fallback produces a surface with all three buckets.
    const surface = result.surface!;
    expect(surface.comfort.length + surface.expansion.length + surface.leap.length).toBeGreaterThan(0);
  }, 60_000);
});
