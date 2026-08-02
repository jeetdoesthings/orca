/**
 * Genre Relationship Engine (GRE) configuration.
 * Controls logarithmic exposure parameters, half-lifes, stability deltas, and stage calibration values.
 */
export const GreConfig = {
  /** listenCount coefficient in familiarity calculation */
  familiarityListenWeight: 0.015,
  /** memoryCount coefficient in familiarity calculation */
  familiarityMemoryWeight: 0.12,
  /** uniqueArtistCount coefficient in familiarity calculation */
  familiarityUniqueWeight: 0.08,
  /** base log coefficient for diversity spreads */
  diversityBaseLogMultiplier: 2.2,
  /** compatibility score coefficient in identity calculation */
  identityCompatibilityWeight: 0.6,
  /** persistence coefficient in identity calculation */
  identityMemoryWeight: 0.4,
  /** recency exponential decay half-life in days */
  recencyHalfLifeDays: 25.0,
  /** stability baseline offset coefficient */
  stabilityBaseOffset: 0.5,
  /** stability velocity multiplier coefficient */
  stabilityVelocityWeight: 6.0,
  /** stability delta multiplier coefficient */
  stabilityDeltaWeight: 2.5,
  
  /** Stage calibration values for multi-dimensional stage evaluation */
  stageCalibrationValues: {
    core: { familiarity: 0.68, diversity: 0.48, identity: 0.65, recency: 0.45 },
    integrated: { familiarity: 0.48, diversity: 0.38, identity: 0.45, recency: 0.35 },
    growing: { recency: 0.5, familiarity: 0.22, stability: 0.5 },
    exploring: { recency: 0.45, diversity: 0.3, familiarityLimit: 0.42 },
    rediscover: { familiarity: 0.45, recencyLimit: 0.25 },
    introduced: { familiarityLimit: 0.08, recencyLimit: 0.2 }
  },
  
  /** GRE confidence blend weights (P1-3) */
  confidenceWeights: {
    identity: 0.4,
    familiarity: 0.4,
    stability: 0.2
  },

  /** GRE confidence floor — minimum believable relationship confidence.
   * P1-3 widened from the legacy 0.5 floor to the spec range 0.0: a genre
   * the user has never engaged with genuinely warrants ~0 confidence, and
   * the previous 0.5 floor collapsed the bottom of the range, hiding weak
   * evidence in OCSE's downstream dimension blend. */
  confidenceFloor: 0.0,

  /** GRE confidence ceiling — caps the trust signal even when every weight
   * runs hot (prevents overcommitting to a single observation). */
  confidenceCeiling: 0.98,

  /**
   * Part 8: explicit state transition thresholds (tunable without code change).
   * Fix-plan map: Unexplored→UNTUCHED, Curious→INTRODUCED, Exploring→EXPLORING,
   * Resident→INTEGRATED/CORE_IDENTITY, Dormant/Returning→REDISCOVER.
   */
  transitions: {
    /** Recency floor counting as first exposure (UNTUCHED→INTRODUCED). */
    firstExposureRecency: 0.05,
    /**
     * INTRODUCED→EXPLORING: need N durable TES-positive expansions in window
     * OR exploring metric proposal (see transitions.ts).
     */
    curiousToExploringDurableN: 2,
    /** Rolling window days for durable expansion count (documentation / callers). */
    durableExpansionWindowDays: 60,
    /** Inactivity days before Resident/Exploring → REDISCOVER (Dormant). */
    inactivityDaysToDormant: 45,
    /** Min days in INTEGRATED before CORE_IDENTITY allowed. */
    minDaysBeforeCore: 14,
    /** REDISCOVER→EXPLORING: recency above this = returning engagement. */
    returningRecency: 0.35,
    rediscover: {
      familiarityFloor: 0.2,
    },
  },
};
