/**
 * Prior incidental Familiarity (Backend Fix Part 2).
 *
 * Familiarity = observed_plays / (observed_plays + k)
 *
 * ORDERING CONSTRAINT (do not break):
 *   - Computed from PRIOR incidental exposure ONLY — Spotify history / listens
 *     that happened outside ORCA's recommendation loop.
 *   - Computed BEFORE a recommendation is shown.
 *   - NEVER recalculated from post-recommendation listens — that is Durability
 *     (TEM / Part 6 event stream). Overlap here was the original double-count bug.
 *
 * GRE `metrics.familiarity` is a different concept: genre-level exposure blend
 * for stage assignment. Do not substitute one for the other.
 *
 * Part 6: prior Familiarity freezes into TesSnapshot at recommendation time.
 * Post-rec listens go to DurabilityEvent stream only — never re-bump Familiarity.
 */

import { ExpansionConfig } from '@/lib/config/expansion';

/**
 * Bayesian-smoothed prior familiarity in [0, 1].
 * Zero plays → 0. Asymptotes to 1 as observed_plays grows.
 */
export function priorFamiliarity(
  observedPlays: number,
  k: number = ExpansionConfig.priorFamiliarityK,
): number {
  const plays = Math.max(0, Number.isFinite(observedPlays) ? observedPlays : 0);
  const prior = k > 0 ? k : ExpansionConfig.priorFamiliarityK;
  return plays / (plays + prior);
}

/**
 * Estimate incidental play count from an explored-node weight when raw play
 * events are not available. Weight is [0,1] from Identity; map to pseudo-counts
 * so the formula has a usable scale. Not a substitute for real listen events
 * when those exist (prefer UserListeningEvent counts).
 *
 * Only use for artists already in the user's identity graph (pre-ORCA exposure).
 * Frontier-only artists get 0.
 */
export function estimatedPlaysFromWeight(
  weight: number,
  scale: number = ExpansionConfig.priorFamiliarityWeightScale,
): number {
  if (!Number.isFinite(weight) || weight <= 0) return 0;
  return Math.max(1, Math.round(Math.min(1, weight) * scale));
}
