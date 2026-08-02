/**
 * Audio signature resolution — DEPRECATED for Expansion Intelligence.
 *
 * audio_distance was dropped from the four-axis model (territory/scene/era/language).
 * This module remains only for legacy node.audioSignature fields and offline tools.
 * Live EI does NOT use acoustic distance.
 *
 * Confidence tags returned here are mapped to metadata-era names for storage
 * compatibility; EI overwrites confidenceTag from axis completeness.
 */

import type { AudioSignature } from '@/lib/graph/types';
import {
  type ConfidenceTag,
  type AudioSource,
  normalizeConfidenceTag,
  isRealAudio,
} from './confidence-tags';

export type { ConfidenceTag, AudioSource };
export { normalizeConfidenceTag, isRealAudio };

export interface ResolvedAudioSignature {
  signature: AudioSignature;
  source: ConfidenceTag;
  confidenceTag: ConfidenceTag;
}

/** Neutral mid-range signature used only when source is low_confidence. */
export const NEUTRAL_AUDIO_SIGNATURE: AudioSignature = {
  energy: 0.5,
  valence: 0.5,
  danceability: 0.5,
  acousticness: 0.5,
  instrumentalness: 0.1,
  tempo: 120,
};

/**
 * Deterministic per-artist tag-inferred signature (genre + id hash).
 * Returns partial_confidence — never claims high sonic measurement.
 */
export function synthesizeAudioSignature(
  artistId: string,
  genres: string[] | string,
): ResolvedAudioSignature {
  const hash = artistId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const factor = (hash % 100) / 100;
  const normGenre = (Array.isArray(genres) ? genres.join(' ') : genres).toLowerCase();
  const isPop = normGenre.includes('pop') || normGenre.includes('dance');
  const isRock =
    normGenre.includes('rock') ||
    normGenre.includes('metal') ||
    normGenre.includes('punk');
  const isAcoustic =
    normGenre.includes('folk') ||
    normGenre.includes('country') ||
    normGenre.includes('classical') ||
    normGenre.includes('jazz');

  const signature: AudioSignature = {
    energy: Math.max(0.1, Math.min(0.99, 0.45 + factor * 0.3 + (isRock ? 0.25 : 0) - (isAcoustic ? 0.2 : 0))),
    valence: Math.max(0.1, Math.min(0.99, 0.5 + factor * 0.25 + (isPop ? 0.2 : 0))),
    danceability: Math.max(0.1, Math.min(0.99, 0.4 + factor * 0.3 + (isPop ? 0.35 : 0))),
    acousticness: Math.max(
      0.01,
      Math.min(0.99, 0.2 + factor * 0.2 + (isAcoustic ? 0.55 : 0) - (isRock ? 0.15 : 0)),
    ),
    instrumentalness: Math.max(
      0.01,
      Math.min(0.99, 0.1 + factor * 0.2 + (normGenre.includes('ambient') ? 0.65 : 0)),
    ),
    tempo: Math.round(75 + factor * 80 + (isPop ? 25 : 0)),
  };

  return {
    signature,
    source: 'partial_confidence',
    confidenceTag: 'partial_confidence',
  };
}

/**
 * Prefer a measured signature when present; otherwise synthesize.
 * NOTE: EI no longer uses this for expansionDistance.
 */
export function resolveAudioSignature(opts: {
  artistId: string;
  genres: string[] | string;
  real?: AudioSignature | null;
  realTag?: ConfidenceTag | string;
  preferMissing?: boolean;
}): ResolvedAudioSignature {
  if (opts.real && isPlausibleSignature(opts.real)) {
    // Still store as high_confidence if measured signature present (legacy embeds)
    // but EI does not use it for distance.
    return {
      signature: opts.real,
      source: 'high_confidence',
      confidenceTag: 'high_confidence',
    };
  }
  if (opts.preferMissing) {
    return {
      signature: { ...NEUTRAL_AUDIO_SIGNATURE },
      source: 'low_confidence',
      confidenceTag: 'low_confidence',
    };
  }
  return synthesizeAudioSignature(opts.artistId, opts.genres);
}

function isPlausibleSignature(sig: AudioSignature): boolean {
  const vals = [
    sig.energy,
    sig.valence,
    sig.danceability,
    sig.acousticness,
    sig.instrumentalness,
    sig.tempo,
  ];
  if (vals.some((v) => typeof v !== 'number' || Number.isNaN(v))) return false;
  if (vals.every((v) => v === 0)) return false;
  return true;
}

export function audioSignatureFromArtistMetadata(
  metadata: string | null | undefined,
): AudioSignature | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as {
      audioSignature?: AudioSignature;
      audioSource?: string;
      confidenceTag?: string;
    };
    const tag = normalizeConfidenceTag(parsed.confidenceTag ?? parsed.audioSource);
    if (
      (tag === 'high_confidence' ||
        parsed.confidenceTag === 'real_audio' ||
        parsed.audioSource === 'REAL') &&
      parsed.audioSignature &&
      isPlausibleSignature(parsed.audioSignature)
    ) {
      return parsed.audioSignature;
    }
  } catch {
    // ignore
  }
  return null;
}

export function confidenceTagFromArtistMetadata(
  metadata: string | null | undefined,
): ConfidenceTag {
  if (!metadata) return 'low_confidence';
  try {
    const parsed = JSON.parse(metadata) as {
      audioSource?: string;
      confidenceTag?: string;
    };
    return normalizeConfidenceTag(parsed.confidenceTag ?? parsed.audioSource);
  } catch {
    return 'low_confidence';
  }
}
