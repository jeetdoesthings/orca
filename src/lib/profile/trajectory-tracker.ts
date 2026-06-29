/**
 * ORCA Trajectory Tracker
 *
 * Tracks how a user's taste profile changes over time by comparing
 * current profile snapshots against previous ones. Detects meaningful
 * shifts across sonic dimensions, trait scores, and discovery metrics
 * to produce a trajectory characterization.
 *
 * All logic is data-driven — no hard-coded artist names, genre names,
 * or fixed branching tied to specific musicians.
 */

import type {
  TrajectoryProfile,
  TrajectoryShift,
  SonicProfile,
  TraitScore,
  DiscoveryProfile,
} from './types';

// ─── Constants ──────────────────────────────────────────────────────

/**
 * Minimum absolute difference in a metric before it's considered
 * a meaningful shift (avoids noise from rounding / tiny fluctuations).
 */
const SHIFT_THRESHOLD = 0.03;

/**
 * Maximum plausible per-dimension shift magnitude.
 * Used to normalize velocity into 0.0–1.0.
 */
const VELOCITY_NORMALIZER = 0.3;

/**
 * The velocity boundary between "low" and "high" for trend labelling.
 */
const HIGH_VELOCITY_CUTOFF = 0.5;

/**
 * Number of leading trait scores to compare for shift detection.
 */
const TOP_TRAITS_TO_COMPARE = 5;

/**
 * Sonic centroid dimensions to compare between snapshots.
 * These keys must exist on AudioSignature but are filtered to the
 * 0–1 normalized dimensions (excludes tempo which is on a BPM scale).
 */
const CENTROID_DIMENSIONS: readonly string[] = [
  'energy',
  'valence',
  'danceability',
  'acousticness',
  'instrumentalness',
] as const;

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Create a single TrajectoryShift from a before/after pair.
 *
 * @param metric   - Human-readable name of the metric
 * @param previous - Previous snapshot value
 * @param current  - Current snapshot value
 * @returns A fully populated TrajectoryShift object
 */
function buildShift(
  metric: string,
  previous: number,
  current: number,
): TrajectoryShift {
  const diff = current - previous;
  const magnitude = Math.abs(diff);

  let direction: TrajectoryShift['direction'] = 'stable';
  if (diff > SHIFT_THRESHOLD) direction = 'up';
  else if (diff < -SHIFT_THRESHOLD) direction = 'down';

  return {
    metric,
    previousValue: previous,
    currentValue: current,
    direction,
    magnitude,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Detect shifts across sonic centroid dimensions.
 *
 * Iterates over the normalized centroid dimensions and emits a
 * TrajectoryShift for each dimension whose absolute difference
 * exceeds the shift threshold.
 *
 * @param current  - Current sonic profile
 * @param previous - Previous sonic profile
 * @returns Array of detected sonic shifts
 */
function detectSonicShifts(
  current: SonicProfile,
  previous: SonicProfile,
): TrajectoryShift[] {
  const shifts: TrajectoryShift[] = [];

  for (const dim of CENTROID_DIMENSIONS) {
    const curVal = current.centroid[dim as keyof typeof current.centroid] as number;
    const prevVal = previous.centroid[dim as keyof typeof previous.centroid] as number;

    if (curVal == null || prevVal == null) continue;

    const diff = Math.abs(curVal - prevVal);
    if (diff > SHIFT_THRESHOLD) {
      shifts.push(buildShift(dim, prevVal, curVal));
    }
  }

  return shifts;
}

/**
 * Detect a shift in genre diversity between discovery profiles.
 *
 * @param current  - Current discovery profile
 * @param previous - Previous discovery profile
 * @returns A TrajectoryShift if the change exceeds threshold, else null
 */
function detectGenreDiversityShift(
  current: DiscoveryProfile,
  previous: DiscoveryProfile,
): TrajectoryShift | null {
  const diff = Math.abs(current.genreDiversity - previous.genreDiversity);
  if (diff > SHIFT_THRESHOLD) {
    return buildShift('genreDiversity', previous.genreDiversity, current.genreDiversity);
  }
  return null;
}

/**
 * Detect shifts in the top N dominant trait scores.
 *
 * Compares trait scores that appear in the current top-N by score
 * against their previous values (if they existed). Traits that are
 * new (no previous counterpart) are reported with a previousValue of 0.
 *
 * @param current  - Current trait scores
 * @param previous - Previous trait scores
 * @returns Array of detected trait shifts
 */
function detectTraitShifts(
  current: TraitScore[],
  previous: TraitScore[],
): TrajectoryShift[] {
  const shifts: TrajectoryShift[] = [];

  // Sort current scores descending and take the top N
  const topCurrent = [...current]
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_TRAITS_TO_COMPARE);

  // Index previous scores by traitId for O(1) lookup
  const previousMap = new Map<string, number>();
  for (const t of previous) {
    previousMap.set(t.traitId, t.score);
  }

  for (const trait of topCurrent) {
    const prevScore = previousMap.get(trait.traitId) ?? 0;
    const diff = Math.abs(trait.score - prevScore);
    if (diff > SHIFT_THRESHOLD) {
      shifts.push(buildShift(`trait:${trait.traitId}`, prevScore, trait.score));
    }
  }

  return shifts;
}

/**
 * Count widening and narrowing signals from the shift data and
 * profile comparisons.
 *
 * Widening signals:
 *   - Genre diversity increased
 *   - Dominant sonic dimensions changed (different set membership)
 *   - New traits appeared in the top N that weren't in the previous set
 *
 * Narrowing signals:
 *   - Genre diversity decreased
 *   - Feature variance decreased across any centroid dimension
 *
 * @returns Tuple of [wideningCount, narrowingCount]
 */
function countDirectionSignals(
  currentSonic: SonicProfile,
  currentTraitScores: TraitScore[],
  currentDiscovery: DiscoveryProfile,
  previousSonic: SonicProfile,
  previousTraitScores: TraitScore[],
  previousDiscovery: DiscoveryProfile,
): [number, number] {
  let widening = 0;
  let narrowing = 0;

  // Genre diversity direction
  if (currentDiscovery.genreDiversity > previousDiscovery.genreDiversity + SHIFT_THRESHOLD) {
    widening++;
  } else if (currentDiscovery.genreDiversity < previousDiscovery.genreDiversity - SHIFT_THRESHOLD) {
    narrowing++;
  }

  // Dominant dimensions changed (set difference)
  const prevDominantSet = new Set(previousSonic.dominantDimensions);
  const curDominantSet = new Set(currentSonic.dominantDimensions);
  const newDimensions = [...curDominantSet].filter((d) => !prevDominantSet.has(d));
  if (newDimensions.length > 0) {
    widening++;
  }

  // New traits appearing in top N
  const previousTraitIds = new Set(
    [...previousTraitScores]
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_TRAITS_TO_COMPARE)
      .map((t) => t.traitId),
  );
  const currentTopTraits = [...currentTraitScores]
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_TRAITS_TO_COMPARE);
  const newTraits = currentTopTraits.filter((t) => !previousTraitIds.has(t.traitId));
  if (newTraits.length > 0) {
    widening++;
  }

  // Feature variance decreased across centroid dimensions
  for (const dim of CENTROID_DIMENSIONS) {
    const curVar = currentSonic.variance[dim as keyof typeof currentSonic.variance] as number;
    const prevVar = previousSonic.variance[dim as keyof typeof previousSonic.variance] as number;

    if (curVar != null && prevVar != null && curVar < prevVar - SHIFT_THRESHOLD) {
      narrowing++;
    }
  }

  return [widening, narrowing];
}

/**
 * Determine the overall trajectory direction from widening and
 * narrowing signal counts.
 *
 * @param widening  - Number of widening signals detected
 * @param narrowing - Number of narrowing signals detected
 * @returns The trajectory direction label
 */
function determineDirection(
  widening: number,
  narrowing: number,
): TrajectoryProfile['direction'] {
  if (widening > 2 && narrowing > 2) return 'oscillating';
  if (widening > narrowing + 1) return 'widening';
  if (narrowing > widening + 1) return 'narrowing';
  return 'stable';
}

/**
 * Compute velocity from the collected shifts.
 *
 * Velocity is the average magnitude of all detected shifts,
 * normalized by the maximum plausible per-dimension shift and
 * clamped to the 0.0–1.0 range.
 *
 * @param shifts - All detected trajectory shifts
 * @returns Normalized velocity in [0.0, 1.0]
 */
function computeVelocity(shifts: TrajectoryShift[]): number {
  if (shifts.length === 0) return 0;

  const totalMagnitude = shifts.reduce((sum, s) => sum + s.magnitude, 0);
  const avgMagnitude = totalMagnitude / shifts.length;
  const raw = avgMagnitude / VELOCITY_NORMALIZER;

  return Math.min(1.0, Math.max(0.0, raw));
}

/**
 * Generate a human-readable long-term trend description from
 * the computed direction and velocity.
 *
 * @param direction - The trajectory direction
 * @param velocity  - The normalized velocity
 * @returns A descriptive trend sentence
 */
function describeTrend(
  direction: TrajectoryProfile['direction'],
  velocity: number,
): string {
  const highVelocity = velocity >= HIGH_VELOCITY_CUTOFF;

  switch (direction) {
    case 'widening':
      return highVelocity
        ? 'Taste is rapidly expanding into new territory'
        : 'Taste is gradually broadening';

    case 'narrowing':
      return highVelocity
        ? 'Taste is focusing intensely on core preferences'
        : 'Taste is slowly consolidating';

    case 'oscillating':
      return 'Taste is actively exploring while returning to familiar ground';

    case 'stable':
      return highVelocity
        ? 'Active listening with consistent core preferences'
        : 'Settled and consistent taste identity';
  }
}

// ─── Main Export ─────────────────────────────────────────────────────

/**
 * Compute a trajectory profile by comparing the current profile
 * snapshot against a previous one.
 *
 * When no previous data is available (first-time profiling), returns
 * a default "stable" trajectory indicating that history will begin
 * accumulating from this point.
 *
 * When previous data IS available, the function:
 *   1. Detects meaningful shifts across sonic, trait, and discovery dimensions
 *   2. Counts widening / narrowing signals to determine overall direction
 *   3. Computes velocity (average shift magnitude, normalized)
 *   4. Derives stability as the inverse of velocity
 *   5. Generates a human-readable trend description
 *
 * @param currentSonic       - Current sonic profile snapshot
 * @param currentTraitScores - Current trait score array
 * @param currentDiscovery   - Current discovery profile snapshot
 * @param previousSonic      - Previous sonic profile, or null if first run
 * @param previousTraitScores - Previous trait scores, or null if first run
 * @param previousDiscovery  - Previous discovery profile, or null if first run
 * @returns A complete TrajectoryProfile
 */
export function computeTrajectoryProfile(
  currentSonic: SonicProfile,
  currentTraitScores: TraitScore[],
  currentDiscovery: DiscoveryProfile,
  previousSonic: SonicProfile | null,
  previousTraitScores: TraitScore[] | null,
  previousDiscovery: DiscoveryProfile | null,
): TrajectoryProfile {
  // ── First snapshot: no history to compare against ──────────────
  if (!previousSonic || !previousTraitScores || !previousDiscovery) {
    return {
      direction: 'stable',
      velocity: 0,
      recentShifts: [],
      longTermTrend: 'First profile snapshot — trajectory will emerge over time.',
      stability: 1.0,
    };
  }

  // ── Step 1: Detect shifts ─────────────────────────────────────
  const sonicShifts = detectSonicShifts(currentSonic, previousSonic);
  const genreShift = detectGenreDiversityShift(currentDiscovery, previousDiscovery);
  const traitShifts = detectTraitShifts(currentTraitScores, previousTraitScores);

  const recentShifts: TrajectoryShift[] = [
    ...sonicShifts,
    ...(genreShift ? [genreShift] : []),
    ...traitShifts,
  ];

  // ── Step 2: Determine direction ───────────────────────────────
  const [widening, narrowing] = countDirectionSignals(
    currentSonic,
    currentTraitScores,
    currentDiscovery,
    previousSonic,
    previousTraitScores,
    previousDiscovery,
  );
  const direction = determineDirection(widening, narrowing);

  // ── Step 3: Velocity ──────────────────────────────────────────
  const velocity = computeVelocity(recentShifts);

  // ── Step 4: Stability ─────────────────────────────────────────
  const stability = 1.0 - velocity;

  // ── Step 5: Long-term trend ───────────────────────────────────
  const longTermTrend = describeTrend(direction, velocity);

  return {
    direction,
    velocity,
    recentShifts,
    longTermTrend,
    stability,
  };
}
