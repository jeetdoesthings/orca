/**
 * Audio embedding providers (Tier 1 — Backend Fix Part 1).
 *
 * Model choice: external CLAP-class embedding service via ORCA_EMBEDDING_URL.
 * Justification: CLAP (Contrastive Language-Audio Pretraining) produces
 * general-purpose audio embeddings suitable for acoustic distance without
 * Spotify features; running it as a sidecar keeps the Next.js process free of
 * heavy native deps (Essentia/torch). When the service is unset, we never
 * invent real_audio — callers fall through to tag_inferred / cold_start_default.
 *
 * NEVER tag synthetic genre-hash signatures as real_audio.
 */

import type { AudioSignature } from '@/lib/graph/types';
import type { ConfidenceTag } from './confidence-tags';

export const DEFAULT_EMBEDDING_MODEL_ID = 'clap-http-v1';
/** Dimension expected from the embedding service (CLAP-ish). */
export const DEFAULT_EMBEDDING_DIM = 512;

export interface EmbeddingResult {
  vector: number[];
  dim: number;
  modelId: string;
  /** Derived 6-d signature for Expansion Intelligence acoustic path. */
  signature: AudioSignature;
  confidenceTag: ConfidenceTag;
  sourceDataHash: string;
}

/**
 * Fold a high-dim embedding into the 6-d AudioSignature EI already understands.
 * Deterministic, range-clamped. Replaced later when EI uses cosine on full vectors.
 */
export function projectEmbeddingToSignature(vector: number[]): AudioSignature {
  if (vector.length === 0) {
    return {
      energy: 0.5,
      valence: 0.5,
      danceability: 0.5,
      acousticness: 0.5,
      instrumentalness: 0.1,
      tempo: 120,
    };
  }

  const n = vector.length;
  const chunk = Math.max(1, Math.floor(n / 6));
  const means: number[] = [];
  for (let i = 0; i < 6; i++) {
    const start = i * chunk;
    const end = i === 5 ? n : Math.min(n, start + chunk);
    let s = 0;
    let c = 0;
    for (let j = start; j < end; j++) {
      s += vector[j];
      c++;
    }
    // Map roughly-normalised embedding coords to [0,1] via sigmoid-ish
    const m = c > 0 ? s / c : 0;
    means.push(1 / (1 + Math.exp(-m)));
  }

  return {
    energy: clamp01(means[0]),
    valence: clamp01(means[1]),
    danceability: clamp01(means[2]),
    acousticness: clamp01(means[3]),
    instrumentalness: clamp01(means[4] * 0.9),
    tempo: Math.round(60 + clamp01(means[5]) * 140),
  };
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0.5;
  return Math.max(0.01, Math.min(0.99, v));
}

export function hashSource(input: string): string {
  // FNV-1a 32-bit — stable, no crypto dependency
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Call the embedding sidecar if configured.
 * POST { previewUrl } → { vector: number[] }
 *
 * Returns null when service is unavailable — caller must not invent real_audio.
 */
/**
 * Health check for Part 14 sidecar. Soft-false if URL unset or unreachable —
 * callers must fall back to tag_inferred, not throw.
 */
export async function isEmbeddingSidecarReady(): Promise<boolean> {
  const base = process.env.ORCA_EMBEDDING_URL?.replace(/\/$/, '');
  if (!base) return false;
  try {
    const res = await fetch(`${base}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { ok?: boolean };
    return data.ok === true;
  } catch {
    return false;
  }
}

export async function embedPreviewFromService(
  previewUrl: string,
  opts?: { modelId?: string },
): Promise<EmbeddingResult | null> {
  const base = process.env.ORCA_EMBEDDING_URL?.replace(/\/$/, '');
  if (!base) return null;

  const modelId = opts?.modelId ?? process.env.ORCA_EMBEDDING_MODEL_ID ?? DEFAULT_EMBEDDING_MODEL_ID;

  try {
    const res = await fetch(`${base}/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ previewUrl, modelId }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.warn(`[Embedder] service HTTP ${res.status} for ${previewUrl.slice(0, 80)}`);
      return null;
    }
    const data = (await res.json()) as { vector?: number[]; dim?: number; modelId?: string };
    if (!Array.isArray(data.vector) || data.vector.length === 0) return null;

    const vector = data.vector.map((x) => Number(x));
    if (vector.some((x) => Number.isNaN(x))) return null;

    return {
      vector,
      dim: data.dim ?? vector.length,
      modelId: data.modelId ?? modelId,
      signature: projectEmbeddingToSignature(vector),
      // Deprecated package: map measured embed → high_confidence (not used by EI)
      confidenceTag: 'high_confidence',
      sourceDataHash: hashSource(`${modelId}|${previewUrl}`),
    };
  } catch (err) {
    // Sidecar down / network — deprecated path; EI does not use embeds
    console.warn('[Embedder] service call failed (deprecated path):', err);
    return null;
  }
}

/**
 * Test / offline helper: produce a deterministic real_audio-tagged result only when
 * ORCA_EMBEDDING_ALLOW_MOCK=1. Production must not set this.
 */
export function mockEmbedFromPreviewUrl(previewUrl: string): EmbeddingResult {
  const modelId = 'mock-clap-v0';
  const dim = 64;
  const vector: number[] = [];
  let h = hashSource(previewUrl);
  for (let i = 0; i < dim; i++) {
    // expand hash into pseudo-random units
    let x = 0;
    for (let c = 0; c < h.length; c++) x = (x * 31 + h.charCodeAt(c) + i) | 0;
    vector.push(((x % 1000) / 1000) * 2 - 1);
    h = hashSource(h + String(i));
  }
  return {
    vector,
    dim,
    modelId,
    signature: projectEmbeddingToSignature(vector),
    confidenceTag: 'high_confidence',
    sourceDataHash: hashSource(`${modelId}|${previewUrl}`),
  };
}

export function isMockEmbeddingAllowed(): boolean {
  return process.env.ORCA_EMBEDDING_ALLOW_MOCK === '1';
}
