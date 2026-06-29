/**
 * ORCA Sonic Profile Analyzer
 *
 * Computes the Sonic Profile layer of the ORCA user profiling system.
 * This module transforms an array of weighted artist nodes into a compact
 * numerical description of a user's sonic preferences.
 *
 * Pipeline:
 *   OrcaNode[] → centroid → variance → extremes → dominant dimensions
 *
 * All logic is data-driven — no hard-coded artist or genre names anywhere.
 *
 * @module sonic-analyzer
 */

import type { AudioSignature, OrcaNode } from '@/lib/graph/types';
import type { SonicProfile, SonicExtreme } from './types';
import { normalizeTempo } from '@/lib/math';

// ─── Constants ──────────────────────────────────────────────────────

/**
 * The six audio-signature dimensions we iterate over.
 * Maintained as a typed constant so every loop stays in sync.
 */
const AUDIO_DIMENSIONS: ReadonlyArray<keyof AudioSignature> = [
  'energy',
  'valence',
  'danceability',
  'acousticness',
  'instrumentalness',
  'tempo',
] as const;

/**
 * Tempo normalization constants.
 * Tempo is measured in BPM while all other features are already 0–1.
 * We map BPM → [0, 1] with: `(tempo - TEMPO_MIN) / TEMPO_RANGE`.
 *   40 BPM → 0.0
 *  200 BPM → 1.0
 *  110 BPM → 0.4375 (close to the "neutral" midpoint)
 */

/** Neutral tempo (BPM) used as the center when ranking dominant dimensions. */
const TEMPO_NEUTRAL_BPM = 110;

/** Thresholds for classifying a centroid value as an extreme. */
const EXTREME_HIGH_THRESHOLD = 0.7;
const EXTREME_LOW_THRESHOLD = 0.3;

/** Tempo-specific thresholds (in raw BPM, not normalized). */
const EXTREME_HIGH_TEMPO_BPM = 140;
const EXTREME_LOW_TEMPO_BPM = 80;

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Returns a neutral (all-zero) AudioSignature.
 * Used as the identity element for empty-input edge cases.
 */
function neutralSignature(): AudioSignature {
  return {
    energy: 0,
    valence: 0,
    danceability: 0,
    acousticness: 0,
    instrumentalness: 0,
    tempo: 0,
  };
}


/**
 * Returns the "neutral" value for a given dimension.
 * For 0–1 features, neutral is 0.5. For tempo, neutral is 110 BPM.
 * This is used when ranking how far a centroid dimension deviates
 * from an unremarkable midpoint.
 *
 * @param dim - The audio-signature dimension name
 * @returns The neutral reference value (in that dimension's native scale)
 */
function neutralValue(dim: keyof AudioSignature): number {
  return dim === 'tempo' ? TEMPO_NEUTRAL_BPM : 0.5;
}

// ─── Core Computation ───────────────────────────────────────────────

/**
 * Computes the weighted centroid (mean) across all nodes for every
 * AudioSignature dimension.
 *
 * centroid[d] = Σ(node.weight × node.audioSignature[d]) / Σ(node.weight)
 *
 * @param nodes - Non-empty array of graph nodes
 * @param totalWeight - Pre-computed sum of all node weights
 * @returns The centroid AudioSignature
 */
function computeCentroid(nodes: OrcaNode[], totalWeight: number): AudioSignature {
  const centroid = neutralSignature();

  for (const node of nodes) {
    const w = node.weight;
    const sig = node.audioSignature;
    for (const dim of AUDIO_DIMENSIONS) {
      centroid[dim] += w * sig[dim];
    }
  }

  // Divide by total weight to get the weighted mean
  for (const dim of AUDIO_DIMENSIONS) {
    centroid[dim] /= totalWeight;
  }

  return centroid;
}

/**
 * Computes the weighted variance for each AudioSignature dimension.
 *
 * variance[d] = Σ(w × (x[d] - centroid[d])²) / Σ(w)
 *
 * This is the population-style weighted variance (not sample-corrected),
 * which is appropriate here because we treat the user's full listening
 * history as the entire population of interest.
 *
 * @param nodes - Non-empty array of graph nodes
 * @param centroid - Previously computed weighted centroid
 * @param totalWeight - Pre-computed sum of all node weights
 * @returns An AudioSignature where each value is the per-dimension variance
 */
function computeVariance(
  nodes: OrcaNode[],
  centroid: AudioSignature,
  totalWeight: number,
): AudioSignature {
  const variance = neutralSignature();

  for (const node of nodes) {
    const w = node.weight;
    const sig = node.audioSignature;
    for (const dim of AUDIO_DIMENSIONS) {
      const diff = sig[dim] - centroid[dim];
      variance[dim] += w * diff * diff;
    }
  }

  for (const dim of AUDIO_DIMENSIONS) {
    variance[dim] /= totalWeight;
  }

  return variance;
}

/**
 * Identifies extreme centroid values — dimensions where the user's
 * weighted average sits notably above or below the neutral zone.
 *
 * For 0–1 features:
 *   - High: centroid > 0.7
 *   - Low:  centroid < 0.3
 *
 * For tempo (BPM):
 *   - High: centroid > 140 BPM
 *   - Low:  centroid <  80 BPM
 *
 * @param centroid - The weighted centroid AudioSignature
 * @returns Array of SonicExtreme entries (may be empty)
 */
function computeExtremes(centroid: AudioSignature): SonicExtreme[] {
  const extremes: SonicExtreme[] = [];

  for (const dim of AUDIO_DIMENSIONS) {
    const value = centroid[dim];

    if (dim === 'tempo') {
      if (value > EXTREME_HIGH_TEMPO_BPM) {
        extremes.push({ dimension: dim, value, direction: 'high' });
      } else if (value < EXTREME_LOW_TEMPO_BPM) {
        extremes.push({ dimension: dim, value, direction: 'low' });
      }
    } else {
      if (value > EXTREME_HIGH_THRESHOLD) {
        extremes.push({ dimension: dim, value, direction: 'high' });
      } else if (value < EXTREME_LOW_THRESHOLD) {
        extremes.push({ dimension: dim, value, direction: 'low' });
      }
    }
  }

  return extremes;
}

/**
 * Ranks dimensions by how far the centroid deviates from the neutral
 * midpoint, producing a sorted list of the user's most pronounced
 * sonic tendencies.
 *
 * For 0–1 features, deviation = |centroid[d] − 0.5|  (max possible: 0.5)
 * For tempo, we normalize BPM to 0–1 first, then compute
 *   deviation = |normalizedTempo − normalizedNeutral|
 *
 * This ensures tempo is compared on the same scale as other features.
 *
 * @param centroid - The weighted centroid AudioSignature
 * @returns Dimension names sorted by descending deviation
 */
function computeDominantDimensions(centroid: AudioSignature): string[] {
  const neutralTempoNormalized = normalizeTempo(TEMPO_NEUTRAL_BPM);

  const deviations: Array<{ dim: string; deviation: number }> = AUDIO_DIMENSIONS.map((dim) => {
    if (dim === 'tempo') {
      const normalizedCentroid = normalizeTempo(centroid[dim]);
      return { dim, deviation: Math.abs(normalizedCentroid - neutralTempoNormalized) };
    }
    return { dim, deviation: Math.abs(centroid[dim] - neutralValue(dim)) };
  });

  deviations.sort((a, b) => b.deviation - a.deviation);

  return deviations.map((d) => d.dim);
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Computes the full Sonic Profile for a set of weighted artist nodes.
 *
 * The profile captures four complementary views of a user's sonic taste:
 *   1. **Centroid** — the "average sound" the user gravitates toward
 *   2. **Variance** — how wide or narrow their preferences are per dimension
 *   3. **Extremes** — dimensions with notably high or low centroid values
 *   4. **Dominant Dimensions** — sorted list of the most defining features
 *
 * Edge cases:
 *   - Empty `nodes` array → neutral profile (all zeros, no extremes)
 *   - All weights zero → treated the same as empty input
 *
 * @param nodes - Array of OrcaNode objects, each with a weight and audioSignature
 * @returns A complete SonicProfile describing the user's sonic preferences
 *
 * @example
 * ```ts
 * const profile = computeSonicProfile(graph.nodes);
 * console.log(profile.centroid.energy);       // 0.72
 * console.log(profile.dominantDimensions[0]); // 'energy'
 * ```
 */
export function computeSonicProfile(nodes: OrcaNode[]): SonicProfile {
  // ── Edge case: no data ──────────────────────────────────────────
  const totalWeight = nodes.reduce((sum, n) => sum + n.weight, 0);

  if (nodes.length === 0 || totalWeight === 0) {
    return {
      centroid: neutralSignature(),
      variance: neutralSignature(),
      extremes: [],
      dominantDimensions: [],
    };
  }

  // ── Step 1: Weighted centroid ───────────────────────────────────
  const centroid = computeCentroid(nodes, totalWeight);

  // ── Step 2: Weighted variance ───────────────────────────────────
  const variance = computeVariance(nodes, centroid, totalWeight);

  // ── Step 3: Identify extremes ───────────────────────────────────
  const extremes = computeExtremes(centroid);

  // ── Step 4: Rank dominant dimensions ────────────────────────────
  const dominantDimensions = computeDominantDimensions(centroid);

  return { centroid, variance, extremes, dominantDimensions };
}
