/**
 * Part 1 — write-once embedding cache + confidence tags.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  getOrComputeTrackEmbedding,
  getCachedTrackEmbedding,
  persistTrackEmbedding,
} from '@/lib/audio/embedding-cache';
import { mockEmbedFromPreviewUrl, projectEmbeddingToSignature } from '@/lib/audio/embedder';
import {
  normalizeConfidenceTag,
  isRealAudio,
  CONFIDENCE_TAG_WEIGHT,
} from '@/lib/audio/confidence-tags';
import { resolveAudioSignature, synthesizeAudioSignature } from '@/lib/audio/resolve-signature';
import { computeExpansionDistanceFromInputs } from '@/lib/expansion/intelligence';
import type { AudioSignature } from '@/lib/graph/types';

const CENTROID: AudioSignature = {
  energy: 0.5,
  valence: 0.5,
  danceability: 0.5,
  acousticness: 0.5,
  instrumentalness: 0.1,
  tempo: 120,
};

describe('confidence tags (Part 1)', () => {
  it('maps legacy REAL/SYNTHETIC/MISSING to canonical tags', () => {
    expect(normalizeConfidenceTag('REAL')).toBe('high_confidence');
    expect(normalizeConfidenceTag('SYNTHETIC')).toBe('partial_confidence');
    expect(normalizeConfidenceTag('MISSING')).toBe('low_confidence');
    expect(normalizeConfidenceTag('real_audio')).toBe('high_confidence');
    expect(normalizeConfidenceTag('tag_inferred')).toBe('partial_confidence');
    expect(normalizeConfidenceTag('cold_start_default')).toBe('low_confidence');
  });

  it('ranks high_confidence > partial_confidence > low_confidence', () => {
    expect(CONFIDENCE_TAG_WEIGHT.high_confidence).toBeGreaterThan(
      CONFIDENCE_TAG_WEIGHT.partial_confidence,
    );
    expect(CONFIDENCE_TAG_WEIGHT.partial_confidence).toBeGreaterThan(
      CONFIDENCE_TAG_WEIGHT.low_confidence,
    );
  });

  it('never tags genre-hash synthesis as high_confidence', () => {
    const synth = synthesizeAudioSignature('artist-xyz', ['techno']);
    expect(synth.confidenceTag).toBe('partial_confidence');
    expect(isRealAudio(synth.source)).toBe(false);
  });

  it('resolveAudioSignature returns high_confidence only when real signature provided', () => {
    const withReal = resolveAudioSignature({
      artistId: 'a1',
      genres: ['pop'],
      real: { ...CENTROID, energy: 0.9 },
    });
    expect(withReal.confidenceTag).toBe('high_confidence');

    const without = resolveAudioSignature({
      artistId: 'a1',
      genres: ['pop'],
      real: null,
    });
    expect(without.confidenceTag).toBe('partial_confidence');
  });
});

describe('EI four-axis: audioSource ignored for composite', () => {
  it('composite identical regardless of audioSource / signature extremes', () => {
    const extreme: AudioSignature = {
      energy: 0.99,
      valence: 0.99,
      danceability: 0.99,
      acousticness: 0.99,
      instrumentalness: 0.99,
      tempo: 200,
    };
    const base = {
      userCentroid: CENTROID,
      userGenreProfile: new Map([['pop', 1]]),
      relationships: [] as never[],
      candidateGenres: ['techno'],
      candidatePopularity: 50,
      candidateSignature: extreme,
    };
    const a = computeExpansionDistanceFromInputs({ ...base, audioSource: 'real_audio' });
    const b = computeExpansionDistanceFromInputs({ ...base, audioSource: 'tag_inferred' });
    const c = computeExpansionDistanceFromInputs({ ...base, audioSource: 'REAL' });
    expect(a).toBeCloseTo(b, 5);
    expect(b).toBeCloseTo(c, 5);
  });
});

describe('projectEmbeddingToSignature', () => {
  it('returns plausible 6-d signature', () => {
    const vec = Array.from({ length: 64 }, (_, i) => Math.sin(i / 3));
    const sig = projectEmbeddingToSignature(vec);
    expect(sig.energy).toBeGreaterThan(0);
    expect(sig.energy).toBeLessThan(1);
    expect(sig.tempo).toBeGreaterThanOrEqual(60);
    expect(sig.tempo).toBeLessThanOrEqual(200);
  });
});

describe('write-once TrackEmbedding cache', () => {
  const trackKey = `test-deezer:part1-cache-${Date.now()}`;
  const previewUrl = 'https://example.com/preview-test.mp3';

  beforeAll(() => {
    process.env.ORCA_EMBEDDING_ALLOW_MOCK = '1';
  });

  afterAll(async () => {
    try {
      await prisma.trackEmbedding.deleteMany({
        where: { trackKey: { startsWith: 'test-deezer:part1-cache-' } },
      });
    } catch {
      // ignore cleanup failures
    }
    delete process.env.ORCA_EMBEDDING_ALLOW_MOCK;
  });

  it('second call is a cache hit (no recompute path)', async () => {
    const result = mockEmbedFromPreviewUrl(previewUrl);
    const first = await persistTrackEmbedding({
      trackKey,
      deezerTrackId: '999001',
      previewUrl,
      result,
    });
    expect(first.cacheHit).toBe(false);
    expect(first.confidenceTag).toBe('high_confidence');
    expect(first.vector.length).toBeGreaterThan(0);

    const second = await getOrComputeTrackEmbedding({
      trackKey,
      previewUrl,
      deezerTrackId: '999001',
      modelId: result.modelId,
    });
    expect(second).not.toBeNull();
    expect(second!.cacheHit).toBe(true);
    expect(second!.vector).toEqual(first.vector);

    const direct = await getCachedTrackEmbedding(trackKey, result.modelId);
    expect(direct?.cacheHit).toBe(true);
  });
});
