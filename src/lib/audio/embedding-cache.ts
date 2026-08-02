/**
 * Write-once embedding cache (Backend Fix Part 1).
 *
 * Permanent storage in TrackEmbedding (and optional ArtistEmbedding rollup).
 * Second request for the same trackKey+modelId is always a DB hit — never recompute.
 *
 * Runbook (short):
 *   1. Resolve Deezer preview for artist/track → trackKey = deezer:{id}
 *   2. getOrComputeTrackEmbedding(trackKey, previewUrl)
 *      - cache hit → return stored row
 *      - miss → call embedder; on success persist confidenceTag=real_audio
 *      - no embedder / no preview → do not write real_audio; caller uses tag_inferred
 *   3. Artist rollup: average track vectors → ArtistEmbedding + Artist.metadata signature
 *
 * Tiers:
 *   Tier 1 real_audio — Deezer preview + embedding service (or mock when allowed)
 *   Tier 2 tag_inferred — Last.fm / genre hash (resolve-signature synthesize)
 *   Tier 3 cold_start_default — neutral defaults (preferMissing)
 */

import { prisma } from '@/lib/prisma';
import type { AudioSignature } from '@/lib/graph/types';
import type { ConfidenceTag } from './confidence-tags';
import {
  DEFAULT_EMBEDDING_MODEL_ID,
  embedPreviewFromService,
  isMockEmbeddingAllowed,
  mockEmbedFromPreviewUrl,
  type EmbeddingResult,
} from './embedder';
import { resolveArtistPreview } from './deezer';

export interface CachedTrackEmbedding {
  trackKey: string;
  vector: number[];
  dim: number;
  modelId: string;
  confidenceTag: ConfidenceTag;
  signature: AudioSignature;
  previewUrl: string | null;
  cacheHit: boolean;
}

function parseVector(raw: string | null | undefined): number[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v) || v.length === 0) return null;
    return v.map((x) => Number(x));
  } catch {
    return null;
  }
}

function parseSignature(raw: string | null | undefined): AudioSignature | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as AudioSignature;
    if (typeof s.energy !== 'number') return null;
    return s;
  } catch {
    return null;
  }
}

/**
 * Load embedding if already cached. Never recomputes.
 */
export async function getCachedTrackEmbedding(
  trackKey: string,
  modelId: string = DEFAULT_EMBEDDING_MODEL_ID,
): Promise<CachedTrackEmbedding | null> {
  const row = await prisma.trackEmbedding.findUnique({
    where: { trackKey_modelId: { trackKey, modelId } },
  });
  if (!row) return null;
  const vector = parseVector(row.embeddingVector);
  if (!vector) return null;
  const signature =
    parseSignature(row.signatureJson) ??
    ({
      energy: 0.5,
      valence: 0.5,
      danceability: 0.5,
      acousticness: 0.5,
      instrumentalness: 0.1,
      tempo: 120,
    } satisfies AudioSignature);

  return {
    trackKey: row.trackKey,
    vector,
    dim: row.embeddingDim,
    modelId: row.modelId,
    confidenceTag: row.confidenceTag as ConfidenceTag,
    signature,
    previewUrl: row.previewUrl,
    cacheHit: true,
  };
}

/**
 * Persist embedding only if absent (write-once). Concurrent writers: unique constraint
 * wins; second write is ignored after re-read.
 */
export async function persistTrackEmbedding(opts: {
  trackKey: string;
  deezerTrackId?: string | null;
  previewUrl?: string | null;
  result: EmbeddingResult;
}): Promise<CachedTrackEmbedding> {
  const { trackKey, result } = opts;
  const existing = await getCachedTrackEmbedding(trackKey, result.modelId);
  if (existing) return existing;

  try {
    await prisma.trackEmbedding.create({
      data: {
        trackKey,
        deezerTrackId: opts.deezerTrackId ?? null,
        previewUrl: opts.previewUrl ?? null,
        embeddingVector: JSON.stringify(result.vector),
        embeddingDim: result.dim,
        signatureJson: JSON.stringify(result.signature),
        confidenceTag: result.confidenceTag,
        modelId: result.modelId,
        sourceDataHash: result.sourceDataHash,
      },
    });
  } catch {
    // Unique race — re-read
    const again = await getCachedTrackEmbedding(trackKey, result.modelId);
    if (again) return again;
    throw new Error(`Failed to persist TrackEmbedding for ${trackKey}`);
  }

  return {
    trackKey,
    vector: result.vector,
    dim: result.dim,
    modelId: result.modelId,
    confidenceTag: result.confidenceTag,
    signature: result.signature,
    previewUrl: opts.previewUrl ?? null,
    cacheHit: false,
  };
}

/**
 * Cache-first embed pipeline for a single track preview.
 * Second call with same trackKey is always cacheHit=true (no recompute).
 */
export async function getOrComputeTrackEmbedding(opts: {
  trackKey: string;
  previewUrl: string | null;
  deezerTrackId?: string | null;
  modelId?: string;
}): Promise<CachedTrackEmbedding | null> {
  const modelId = opts.modelId ?? DEFAULT_EMBEDDING_MODEL_ID;
  const cached = await getCachedTrackEmbedding(opts.trackKey, modelId);
  if (cached) return cached;

  if (!opts.previewUrl) return null;

  let result = await embedPreviewFromService(opts.previewUrl, { modelId });
  if (!result && isMockEmbeddingAllowed()) {
    result = mockEmbedFromPreviewUrl(opts.previewUrl);
    // mock uses its own modelId — re-check cache under that id
    const mockCached = await getCachedTrackEmbedding(opts.trackKey, result.modelId);
    if (mockCached) return mockCached;
  }
  if (!result) return null;

  return persistTrackEmbedding({
    trackKey: opts.trackKey,
    deezerTrackId: opts.deezerTrackId,
    previewUrl: opts.previewUrl,
    result,
  });
}

/**
 * Resolve Tier-1 audio for an artist: Deezer preview → embed → write-once cache.
 * Returns null when no real_audio path is available (caller uses tag_inferred).
 */
export async function resolveArtistRealAudio(opts: {
  artistId: string;
  artistName: string;
}): Promise<{ signature: AudioSignature; confidenceTag: 'real_audio'; cacheHit: boolean } | null> {
  // Prefer any existing artist-level real_audio embedding
  try {
    const artistEmb = await prisma.artistEmbedding.findFirst({
      where: {
        artistId: opts.artistId,
        confidenceTag: 'real_audio',
      },
      orderBy: { embeddingVersion: 'desc' },
    });
    if (artistEmb?.audioVector) {
      const vector = parseVector(artistEmb.audioVector);
      const sig = parseSignature(
        // signature may live in fusedVector as JSON side-channel when we store it
        artistEmb.fusedVector,
      );
      if (vector && sig) {
        return { signature: sig, confidenceTag: 'real_audio', cacheHit: true };
      }
    }
  } catch {
    // table may be empty / unavailable
  }

  const preview = await resolveArtistPreview(opts.artistName);
  if (!preview?.previewUrl) return null;

  const emb = await getOrComputeTrackEmbedding({
    trackKey: preview.trackKey,
    previewUrl: preview.previewUrl,
    deezerTrackId: preview.deezerTrackId,
  });
  if (!emb || emb.confidenceTag !== 'high_confidence') return null;

  // Roll up to ArtistEmbedding (write-once per version 1)
  try {
    await prisma.artistEmbedding.upsert({
      where: {
        artistId_embeddingVersion: {
          artistId: opts.artistId,
          embeddingVersion: 1,
        },
      },
      create: {
        artistId: opts.artistId,
        embeddingVersion: 1,
        audioVector: JSON.stringify(emb.vector),
        fusedVector: JSON.stringify(emb.signature),
        confidence: 1.0,
        confidenceTag: 'real_audio',
        modelId: emb.modelId,
        sourceDataHash: emb.trackKey,
        normalizationVersion: 1,
      },
      update: {
        // Write-once: do not overwrite existing real_audio vectors
      },
    });
  } catch (err) {
    console.warn(`[EmbeddingCache] ArtistEmbedding upsert failed for ${opts.artistId}:`, err);
  }

  return {
    signature: emb.signature,
    confidenceTag: 'real_audio',
    cacheHit: emb.cacheHit,
  };
}
