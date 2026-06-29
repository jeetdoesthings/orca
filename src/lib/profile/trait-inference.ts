/**
 * ORCA Trait Inference Engine
 *
 * Core scoring engine that computes trait scores from a user's audio feature
 * centroid and computed meta-signals. All logic is data-driven via the trait
 * registry — no hard-coded artist/genre names or fixed if/else branches.
 *
 * Pipeline flow:
 *   1. Iterate active traits from the registry
 *   2. For each trait, compute a raw score from feature weights + meta-signals
 *   3. Normalize to 0.0–1.0 and compute confidence
 *   4. Compare against previous scores to determine trend direction
 *   5. Return a complete TraitScore[] array
 */

import type { AudioSignature } from '@/lib/graph/types';
import type {
  TraitScore,
  TraitDefinition,
  FeatureTransform,
  ComputedMetaSignals,
  MetaSignalType,
} from './types';
import { getActiveTraits } from './trait-registry';

// ─── Constants ──────────────────────────────────────────────────────

/** Minimum BPM for tempo normalization (maps to 0.0) */
const TEMPO_MIN = 40;

/** Range of BPM for tempo normalization (maps TEMPO_MIN → 0.0, TEMPO_MIN + TEMPO_RANGE → 1.0) */
const TEMPO_RANGE = 160;

/** Threshold for detecting a rising or declining trend between score snapshots */
const TREND_THRESHOLD = 0.05;

// ─── Meta-Signal Mapping ────────────────────────────────────────────

/**
 * Maps MetaSignalType identifiers (snake_case in the registry) to the
 * corresponding field in ComputedMetaSignals (camelCase in the interface).
 *
 * The `popularity_avg` meta-signal is inverted (1 - value) so that *lower*
 * popularity contributes positively to traits like "experimental" and "raw",
 * where obscurity is a signal.
 */
const META_SIGNAL_MAP: Record<
  MetaSignalType,
  { key: keyof ComputedMetaSignals; invert: boolean }
> = {
  genre_diversity:      { key: 'genreDiversity',      invert: false },
  popularity_avg:       { key: 'popularityAvg',        invert: true },
  popularity_variance:  { key: 'popularityVariance',   invert: false },
  tempo_variance:       { key: 'tempoVariance',        invert: false },
  feature_variance:     { key: 'featureVariance',      invert: false },
  artist_count:         { key: 'artistCount',          invert: false },
  weight_concentration: { key: 'weightConcentration',  invert: false },
};

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Compute scores for every active trait in the registry.
 *
 * @param centroid       - Weighted-average AudioSignature across the user's artists
 * @param metaSignals    - Aggregate behavioral signals (genre diversity, popularity, etc.)
 * @param previousScores - Scores from the previous profiling run, or null on first run
 * @returns A TraitScore for each active trait, with score, confidence, and trend
 */
export function computeAllTraitScores(
  centroid: AudioSignature,
  metaSignals: ComputedMetaSignals,
  previousScores: TraitScore[] | null,
): TraitScore[] {
  const activeTraits = getActiveTraits();
  const now = new Date().toISOString();

  // Build a lookup for previous scores to make trend detection O(1)
  const previousMap = buildPreviousScoreMap(previousScores);

  return activeTraits.map((trait) => {
    const score = computeTraitScore(trait, centroid, metaSignals);
    const signalStrength = computeSignalStrength(score);
    const confidence = computeTraitConfidence(
      trait,
      metaSignals.artistCount,
      signalStrength,
    );
    const trend = detectTrend(trait.id, score, previousMap);

    return {
      traitId: trait.id,
      score,
      confidence,
      trend,
      lastUpdated: now,
    };
  });
}

/**
 * Apply a feature transform to a raw audio feature value.
 *
 * Transforms control how a raw 0–1 feature value is mapped before weighting:
 * - `linear`    — identity; higher feature = higher contribution
 * - `inverse`   — 1 - value; lower feature = higher contribution
 * - `quadratic` — value²; amplifies extreme values, suppresses mid-range
 * - `threshold` — binary gate; 1.0 if value ≥ threshold, else 0.0
 *
 * @param value     - The raw feature value (expected 0–1 for most features)
 * @param transform - The transform type to apply
 * @param threshold - Cutoff for 'threshold' transforms (ignored for others)
 * @returns The transformed value
 */
export function applyFeatureTransform(
  value: number,
  transform: FeatureTransform,
  threshold?: number,
): number {
  switch (transform) {
    case 'linear':
      return value;
    case 'inverse':
      return 1 - value;
    case 'quadratic':
      return value * value;
    case 'threshold':
      return value >= (threshold ?? 0.5) ? 1.0 : 0.0;
    default: {
      // Exhaustiveness guard — if a new transform is added to the union
      // but not handled here, TypeScript will flag it at compile time.
      const _exhaustive: never = transform;
      return _exhaustive;
    }
  }
}

/**
 * Compute a single trait's raw score from audio features and meta-signals.
 *
 * Scoring formula:
 *   score = Σ (transformedFeatureValue × featureWeight)
 *         + Σ (metaSignalValue × metaSignalWeight)
 *
 * Special handling:
 * - Tempo is normalized from BPM to 0–1 using (tempo - 40) / 160, clamped.
 * - Meta-signal values may be inverted per the META_SIGNAL_MAP configuration.
 * - The final score is clamped to [0.0, 1.0].
 *
 * @param trait       - The trait definition from the registry
 * @param centroid    - The user's weighted-average audio signature
 * @param metaSignals - Computed meta-signals from listening behavior
 * @returns A score in [0.0, 1.0]
 */
export function computeTraitScore(
  trait: TraitDefinition,
  centroid: AudioSignature,
  metaSignals: ComputedMetaSignals,
): number {
  let totalScore = 0;

  // ── Audio feature contributions ────────────────────────────────
  const featureKeys = Object.keys(trait.featureWeights) as Array<keyof AudioSignature>;

  for (const featureKey of featureKeys) {
    const featureWeight = trait.featureWeights[featureKey];
    if (!featureWeight) continue;

    let rawValue = centroid[featureKey];

    // Tempo is in BPM (40–200+), normalize to 0–1
    if (featureKey === 'tempo') {
      rawValue = clamp((rawValue - TEMPO_MIN) / TEMPO_RANGE, 0, 1);
    }

    const transformed = applyFeatureTransform(
      rawValue,
      featureWeight.transform,
      featureWeight.threshold,
    );

    totalScore += transformed * featureWeight.weight;
  }

  // ── Meta-signal contributions ──────────────────────────────────
  if (trait.metaSignals) {
    const signalKeys = Object.keys(trait.metaSignals);

    for (const signalKey of signalKeys) {
      const metaWeight = trait.metaSignals[signalKey];
      if (!metaWeight) continue;

      const mapping = META_SIGNAL_MAP[metaWeight.type];
      let signalValue = metaSignals[mapping.key];

      // Invert if the mapping calls for it (e.g., popularity_avg)
      if (mapping.invert) {
        signalValue = 1 - signalValue;
      }

      totalScore += signalValue * metaWeight.weight;
    }
  }

  return clamp(totalScore, 0, 1);
}

/**
 * Compute confidence for a trait based on its configured strategy.
 *
 * Confidence strategies:
 * - `sample_size`     — More artists in the profile → higher confidence.
 *                       Ramps linearly to 1.0 at 30 artists.
 * - `signal_strength` — How far from neutral (0.5) the score is.
 *                       A score of exactly 0.5 = zero signal = zero confidence.
 * - `combined`        — Average of sample_size and signal_strength.
 *
 * @param trait          - The trait definition (contains the confidence strategy)
 * @param sampleSize     - Number of artists in the user's profile
 * @param signalStrength - Pre-computed signal strength for this trait's score
 * @returns Confidence in [0.0, 1.0]
 */
export function computeTraitConfidence(
  trait: TraitDefinition,
  sampleSize: number,
  signalStrength: number,
): number {
  const sampleConfidence = Math.min(sampleSize / 30, 1.0);

  switch (trait.confidenceStrategy) {
    case 'sample_size':
      return sampleConfidence;
    case 'signal_strength':
      return signalStrength;
    case 'combined':
      return (sampleConfidence + signalStrength) / 2;
    default: {
      const _exhaustive: never = trait.confidenceStrategy;
      return _exhaustive;
    }
  }
}

// ─── Internal Helpers ───────────────────────────────────────────────

/**
 * Build a Map from traitId → score for O(1) lookups during trend detection.
 *
 * @param previousScores - Array of previous trait scores, or null
 * @returns A Map keyed by traitId, or an empty Map if no previous data exists
 */
function buildPreviousScoreMap(
  previousScores: TraitScore[] | null,
): Map<string, number> {
  const map = new Map<string, number>();
  if (!previousScores) return map;

  for (const ps of previousScores) {
    map.set(ps.traitId, ps.score);
  }
  return map;
}

/**
 * Compute signal strength for a given trait score.
 *
 * Signal strength measures how decisive a score is — a score of exactly 0.5
 * carries no signal (the user is neutral on this trait), while scores near
 * 0.0 or 1.0 carry maximum signal.
 *
 * Formula: min(|score - 0.5| × 2, 1.0)
 *
 * @param score - The trait score in [0.0, 1.0]
 * @returns Signal strength in [0.0, 1.0]
 */
function computeSignalStrength(score: number): number {
  return Math.min(Math.abs(score - 0.5) * 2, 1.0);
}

/**
 * Determine the trend direction for a trait by comparing current and
 * previous scores.
 *
 * - Difference > +0.05  → 'rising'
 * - Difference < -0.05  → 'declining'
 * - Otherwise           → 'stable'
 *
 * If no previous score exists for this trait, defaults to 'stable'.
 *
 * @param traitId      - The trait identifier
 * @param currentScore - The current computed score
 * @param previousMap  - Map of traitId → previous score
 * @returns The trend direction
 */
function detectTrend(
  traitId: string,
  currentScore: number,
  previousMap: Map<string, number>,
): TraitScore['trend'] {
  const previousScore = previousMap.get(traitId);

  // No history — can't determine a trend
  if (previousScore === undefined) {
    return 'stable';
  }

  const diff = currentScore - previousScore;

  if (diff > TREND_THRESHOLD) return 'rising';
  if (diff < -TREND_THRESHOLD) return 'declining';
  return 'stable';
}

/**
 * Clamp a number to a [min, max] range.
 *
 * @param value - The value to clamp
 * @param min   - Lower bound
 * @param max   - Upper bound
 * @returns The clamped value
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
