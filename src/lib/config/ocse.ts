/**
 * OCSE Decision Engine configuration.
 * Cooldown, legacy dimension blend, Part 7 DecisionScore geo-mean weights.
 */
export const OcseConfig = {
  /** interaction history decay factors */
  cooldownPenalties: {
    ignoredMultiplier: 0.5,
    dismissedMultiplier: 0.3,
    recentShownLimitHours: 24.0,
    recentShownPenalty: 0.15,
    extendedShownPenalty: 0.6,
    extendedShownLimitHours: 72.0
  },
  
  /**
   * Legacy additive dimension blend (still computed for inspectability).
   * Final ranking DecisionScore uses decisionScoreWeights geo-mean (Part 7).
   */
  dimensionWeights: {
    relationshipSupport: 0.2,
    growthContribution: 0.2,
    noveltyContribution: 0.15,
    discoveryConfidence: 0.15,
    timingContribution: 0.15,
    sliderCompatibility: 0.15
  },

  /**
   * Part 7: weighted geometric mean factors for DecisionScore.
   * Should sum ~1. All must be genuinely present (geo-mean property).
   */
  decisionScoreWeights: {
    tes: 0.35,
    readiness: 0.25,
    diversity: 0.2,
    confidence: 0.2,
  },

  /**
   * Part 7 Readiness — exp recovery after same-direction rejections.
   * halfLifeDays: ~3–7 days default; tune without code change.
   */
  readiness: {
    halfLifeDays: 5,
    skipRejectWeight: 0.45,
    territoryRejectWeight: 1.2,
    /** GRE stage multiplies base readiness (Curious more frequent exposure). */
    stageMultiplier: {
      UNTUCHED: 0.85,
      INTRODUCED: 1.0,
      EXPLORING: 0.95,
      GROWING: 0.9,
      INTEGRATED: 0.65,
      CORE_IDENTITY: 0.55,
      REDISCOVER: 0.85,
      DEFAULT: 0.85,
    } as Record<string, number>,
  },

  /** Part 7 batch Diversity */
  diversity: {
    /** Single-candidate batch: neutral diversity (no pairwise). */
    singletonDefault: 0.5,
  },

  /**
   * Part 11: territory-wide "not for me" cooldown (days).
   * Suppresses candidates in that territory direction for this window.
   */
  territoryRejectCooldownDays: 30,

  /** Reasons decision filter thresholds */
  thresholds: {
    highQuality: 0.65,
    supportsGrowth: 0.8,
    expandTaste: 0.7,
    goodTiming: 0.7
  },

  /**
   * Change C: Recommendation Surface — PROVISIONAL per-bucket distance weights.
   * Four-axis model (audio_distance dropped). Audio's former weight redistributed
   * proportionally onto remaining axes so each bucket still sums to 1.0.
   * Recalibrate via RecommendationServeLog + durability (Change H); not final.
   */
  bucketDistanceWeights: {
    // comfort: was audio 0.35 / rest 0.65 → scale rest by 1/0.65
    comfort: {
      territory: 0.385, // 0.25/0.65
      scene: 0.231, // 0.15/0.65
      era: 0.231, // 0.15/0.65
      language: 0.154, // 0.10/0.65
    },
    // expansion: was audio 0.2 / rest 0.8
    expansion: {
      territory: 0.375, // 0.30/0.8
      scene: 0.25, // 0.20/0.8
      era: 0.188, // 0.15/0.8
      language: 0.188, // 0.15/0.8
    },
    // leap: was audio 0.1 / rest 0.9 — reinforce territory + language (leap emphasis)
    leap: {
      territory: 0.333, // 0.30/0.9
      scene: 0.222, // 0.20/0.9
      era: 0.167, // 0.15/0.9
      language: 0.278, // 0.25/0.9
    },
  } as const,

  /**
   * Ideal distance center per bucket (0–1) for each of four axes.
   * Comfort wants low distance; leap wants high territory/language.
   * PROVISIONAL.
   */
  bucketDistanceTargets: {
    comfort: {
      territory: 0.25,
      scene: 0.3,
      era: 0.35,
      language: 0.25,
    },
    expansion: {
      territory: 0.5,
      scene: 0.5,
      era: 0.5,
      language: 0.5,
    },
    leap: {
      territory: 0.8,
      scene: 0.75,
      era: 0.6,
      language: 0.8,
    },
  } as const,

  /** Min viable population per bucket before widening. */
  minBucketPopulation: 8,

  /** Widen target tolerance in steps when bucket is short. */
  bucketWidenSteps: [0.15, 0.28, 0.42, 0.6],

  /** Geo-mean weights inside a bucket (provisional). */
  surfaceScoreWeights: {
    distanceFit: 0.4,
    readinessFit: 0.2,
    diversity: 0.2,
    confidence: 0.2,
  },

  /** Per-stage relationship support (P1-4): each GRE 7-state yields a
   * scalar `relationshipSupport` contribution. Configuring separately from
   * the if/else chain makes the dimension's mapping tunable without touching
   * the evaluator, and surfaces the values that were previously buried inline. */
  relationshipSupportByStage: {
    CORE_IDENTITY: 0.35,
    INTEGRATED: 0.35,
    GROWING: 0.9,
    EXPLORING: 0.9,
    REDISCOVER: 0.9,
    INTRODUCED: 0.72,
    UNTUCHED: 0.58,
    // fallback: stages outside the canonical 7-state taxonomy (e.g. legacy
    // pre-persisted rows).
    DEFAULT: 0.5
  },

  /**
   * P1-6 growthContribution — how much a candidate expands the currently
   * visible world (explored + prior frontier), not raw GRE diversity alone.
   */
  growthContribution: {
    /** Already in currentVisibleWorldIds — no growth. */
    alreadyVisible: 0.0,
    /** Cold start (empty visible set) — everything is growth. */
    emptyWorld: 1.0,
    /**
     * Weight on GRE inverse-diversity when candidate is not yet visible.
     * Remaining weight = baseNew (always-on novelty for unseen candidates).
     */
    diversityWeight: 0.6,
    /** Floor for not-yet-visible candidates after blend. */
    baseNew: 0.4,
  },
};
