/**
 * ORCA Discovery Readiness Module
 *
 * Computes how ready a user is for taste expansion by analyzing their
 * explored graph nodes along multiple diversity and exploration axes.
 *
 * Metrics computed:
 *   - Genre Diversity — Shannon entropy (normalized) of genre distribution
 *   - Artist Diversity — Inverse Herfindahl index of listening weights
 *   - Boundary Openness — Ratio of unique genres to artist count (scaled)
 *   - Exploration Velocity — Frontier-to-explored ratio
 *   - Novelty Appetite — Weighted composite of the above four metrics
 *   - Overall Readiness — Composite readiness score (MVP: same as novelty appetite)
 *
 * All logic is data-driven. No hard-coded artist names, genre names,
 * or fixed if/else branches tied to specific musicians.
 */

import type { OrcaNode } from '@/lib/graph/types';
import type { DiscoveryProfile } from './types';
import { clamp } from '@/lib/math';

// ─── Constants ──────────────────────────────────────────────────────

/** Composite weights for novelty appetite calculation */
const NOVELTY_WEIGHTS = {
  genreDiversity: 0.30,
  artistDiversity: 0.20,
  boundaryOpenness: 0.25,
  explorationVelocity: 0.25,
} as const;

/** Boundary openness scaling denominator per artist */
const BOUNDARY_OPENNESS_SCALE = 0.3;

/** Optimal novelty level floor and range */
const NOVELTY_FLOOR = 0.2;
const NOVELTY_RANGE = 0.6;

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Return the zero-state discovery profile used when no data is available.
 *
 * @returns A DiscoveryProfile with all metrics set to zero and 'low' readiness
 */
function emptyProfile(): DiscoveryProfile {
  return {
    noveltyAppetite: 0,
    genreDiversity: 0,
    artistDiversity: 0,
    boundaryOpenness: 0,
    explorationVelocity: 0,
    overallReadiness: 0,
    readinessLabel: 'low',
    optimalNoveltyLevel: NOVELTY_FLOOR,
  };
}

/**
 * Resolve the primary genre for a node.
 * Falls back to 'unknown' when the genres array is empty.
 *
 * @param node - The graph node to inspect
 * @returns The first genre string, or 'unknown'
 */
function primaryGenre(node: OrcaNode): string {
  return node.genres.length > 0 ? node.genres[0] : 'unknown';
}

// ─── Metric Computations ────────────────────────────────────────────

/**
 * Compute normalized Shannon entropy of the genre distribution.
 *
 * H = -Σ(p_i · ln(p_i)) for each genre i, where p_i = count_i / total.
 * Normalized by dividing by ln(totalDistinctGenres) so the result
 * falls in [0.0, 1.0]. A value of 1.0 means perfectly uniform
 * distribution across all genres; 0.0 means all listening is in one genre.
 *
 * @param nodes - Explored artist nodes with genre metadata
 * @returns Normalized Shannon entropy in [0.0, 1.0]
 */
function computeGenreDiversity(nodes: OrcaNode[]): number {
  const genreCounts = new Map<string, number>();

  for (const node of nodes) {
    const genre = primaryGenre(node);
    genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
  }

  const totalGenres = genreCounts.size;

  // With 0 or 1 genres, entropy is 0 (no diversity / undefined)
  if (totalGenres <= 1) {
    return 0;
  }

  const total = nodes.length;
  let entropy = 0;

  for (const count of genreCounts.values()) {
    const p = count / total;
    if (p > 0) {
      entropy -= p * Math.log(p);
    }
  }

  // Normalize by maximum possible entropy for this many genres
  const maxEntropy = Math.log(totalGenres);
  return maxEntropy > 0 ? entropy / maxEntropy : 0;
}

/**
 * Compute artist diversity using the inverse Herfindahl–Hirschman Index.
 *
 * The Herfindahl index (HHI) = Σ(w_i²) / (Σ(w_i))², which measures
 * weight concentration. Artist diversity = 1 - HHI, clamped to [0.0, 1.0].
 *
 * A value near 1.0 indicates listening is spread evenly across many artists.
 * A value near 0.0 indicates all weight is concentrated on one artist.
 *
 * @param nodes - Explored artist nodes with listening weights
 * @returns Inverse Herfindahl index in [0.0, 1.0]
 */
function computeArtistDiversity(nodes: OrcaNode[]): number {
  const weights = nodes.map((n) => n.weight);

  const sumWeights = weights.reduce((acc, w) => acc + w, 0);
  if (sumWeights === 0) {
    return 0;
  }

  const sumSquaredWeights = weights.reduce((acc, w) => acc + w * w, 0);
  const concentration = sumSquaredWeights / (sumWeights * sumWeights);

  return clamp(1 - concentration, 0, 1);
}

/**
 * Compute boundary openness — how willing the user is to cross genre lines.
 *
 * Approximated as the ratio of unique genres to total artists, scaled by
 * a constant factor. Higher ratios suggest the user listens across many
 * genre boundaries rather than staying in a single lane.
 *
 * Formula: min(uniqueGenres / (totalArtists × 0.3), 1.0)
 *
 * @param nodes - Explored artist nodes with genre metadata
 * @returns Boundary openness in [0.0, 1.0]
 */
function computeBoundaryOpenness(nodes: OrcaNode[]): number {
  const uniqueGenres = new Set(nodes.map(primaryGenre)).size;
  const totalArtists = nodes.length;

  const denominator = totalArtists * BOUNDARY_OPENNESS_SCALE;
  if (denominator === 0) {
    return 0;
  }

  return Math.min(uniqueGenres / denominator, 1.0);
}

/**
 * Compute exploration velocity — how much frontier remains relative to explored territory.
 *
 * A higher ratio means more unvisited frontier nodes are available,
 * suggesting the user is actively pushing into new territory.
 *
 * Formula: frontierCount / max(exploredCount, 1), clamped to [0.0, 1.0]
 *
 * @param exploredCount  - Number of explored nodes
 * @param frontierCount  - Number of frontier (unvisited) nodes
 * @returns Exploration velocity in [0.0, 1.0]
 */
function computeExplorationVelocity(
  exploredCount: number,
  frontierCount: number
): number {
  const ratio = frontierCount / Math.max(exploredCount, 1);
  return clamp(ratio, 0, 1);
}

/**
 * Compute the novelty appetite composite score.
 *
 * Weighted blend of four diversity/exploration metrics:
 *   - Genre Diversity:       30%
 *   - Artist Diversity:      20%
 *   - Boundary Openness:     25%
 *   - Exploration Velocity:  25%
 *
 * @param genreDiversity      - Normalized Shannon entropy
 * @param artistDiversity     - Inverse Herfindahl index
 * @param boundaryOpenness    - Genre-to-artist ratio (scaled)
 * @param explorationVelocity - Frontier-to-explored ratio
 * @returns Novelty appetite in [0.0, 1.0]
 */
function computeNoveltyAppetite(
  genreDiversity: number,
  artistDiversity: number,
  boundaryOpenness: number,
  explorationVelocity: number
): number {
  return (
    genreDiversity * NOVELTY_WEIGHTS.genreDiversity +
    artistDiversity * NOVELTY_WEIGHTS.artistDiversity +
    boundaryOpenness * NOVELTY_WEIGHTS.boundaryOpenness +
    explorationVelocity * NOVELTY_WEIGHTS.explorationVelocity
  );
}

/**
 * Map a readiness score to a human-readable label.
 *
 * | Range         | Label       |
 * |---------------|-------------|
 * | [0.00, 0.25)  | low         |
 * | [0.25, 0.50)  | moderate    |
 * | [0.50, 0.75)  | high        |
 * | [0.75, 1.00]  | very high   |
 *
 * @param readiness - Overall readiness score in [0.0, 1.0]
 * @returns Human-readable readiness band
 */
function readinessLabel(
  readiness: number
): DiscoveryProfile['readinessLabel'] {
  if (readiness < 0.25) return 'low';
  if (readiness < 0.50) return 'moderate';
  if (readiness < 0.75) return 'high';
  return 'very high';
}

/**
 * Compute the optimal novelty level for recommendations.
 *
 * Low-readiness users receive subtle, nearby suggestions (closer to 0.2).
 * High-readiness users receive bolder, farther-out recommendations (up to 0.8).
 *
 * Formula: 0.2 + overallReadiness × 0.6
 *
 * @param overallReadiness - Composite readiness score in [0.0, 1.0]
 * @returns Optimal novelty distance in [0.2, 0.8]
 */
function computeOptimalNoveltyLevel(overallReadiness: number): number {
  return NOVELTY_FLOOR + overallReadiness * NOVELTY_RANGE;
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Compute a full discovery readiness profile from the user's explored graph nodes.
 *
 * This function is pure: it derives all metrics from the input data without
 * side effects. The optional `previousProfile` parameter is accepted for
 * future use (e.g. trajectory smoothing, momentum tracking) but is not
 * used in the current MVP implementation.
 *
 * @param exploredNodes   - Array of explored OrcaNode entries (state = 'explored')
 * @param frontierCount   - Number of frontier nodes currently available
 * @param previousProfile - The last computed DiscoveryProfile, or null if first run
 * @returns A fully-populated DiscoveryProfile
 *
 * @example
 * ```ts
 * const profile = computeDiscoveryProfile(exploredNodes, 42, null);
 * console.log(profile.readinessLabel); // 'moderate'
 * console.log(profile.optimalNoveltyLevel); // 0.47
 * ```
 */
export function computeDiscoveryProfile(
  exploredNodes: OrcaNode[],
  frontierCount: number,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _previousProfile: DiscoveryProfile | null
): DiscoveryProfile {
  // Edge case: no data available
  if (exploredNodes.length === 0) {
    return emptyProfile();
  }

  // ── Individual metrics ──────────────────────────────────────────
  const genreDiversity = computeGenreDiversity(exploredNodes);
  const artistDiversity = computeArtistDiversity(exploredNodes);
  const boundaryOpenness = computeBoundaryOpenness(exploredNodes);
  const explorationVelocity = computeExplorationVelocity(
    exploredNodes.length,
    frontierCount
  );

  // ── Composite scores ───────────────────────────────────────────
  const noveltyAppetite = computeNoveltyAppetite(
    genreDiversity,
    artistDiversity,
    boundaryOpenness,
    explorationVelocity
  );

  // MVP: overall readiness mirrors novelty appetite.
  // These will diverge once we integrate interaction signals (likes,
  // skips, dwell-time) and temporal momentum from previousProfile.
  const overallReadiness = noveltyAppetite;

  const label = readinessLabel(overallReadiness);
  const optimalNoveltyLevel = computeOptimalNoveltyLevel(overallReadiness);

  return {
    noveltyAppetite,
    genreDiversity,
    artistDiversity,
    boundaryOpenness,
    explorationVelocity,
    overallReadiness,
    readinessLabel: label,
    optimalNoveltyLevel,
  };
}
