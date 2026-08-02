/**
 * Expansion Intelligence configuration — four-axis metadata model.
 * Axes: territory | scene | era | language. audio_distance removed.
 *
 * All composite / blend weights are PROVISIONAL — recalibrate via
 * RecommendationServeLog + durability once volume accumulates.
 */
export const ExpansionConfig = {
  /**
   * @deprecated Legacy 4-term blend (acoustic/cultural/identity/familiarity).
   * Prefer compositeComponentWeights (four metadata axes).
   */
  distanceWeights: {
    acoustic: 0, // dropped
    cultural: 0.4,
    identity: 0.35,
    familiarity: 0.25,
  },
  /**
   * Composite across four first-class distance components.
   * PROVISIONAL — was five-way with audio 0.25; audio weight redistributed
   * proportionally onto territory/scene/era/language (was 0.25/0.2/0.15/0.15
   * of remaining 0.75 → scale by 1/0.75).
   * Sum = 1.0.
   */
  compositeComponentWeights: {
    // no audio key — structural removal
    territory: 0.333, // 0.25/0.75
    scene: 0.267, // 0.20/0.75
    era: 0.2, // 0.15/0.75
    language: 0.2, // 0.15/0.75
  },
  /**
   * Optional nudge of composite toward obscurity/familiarity (0 = off).
   * Not a fifth first-class component.
   */
  compositeFamiliarityNudge: 0,
  /** Identity establishedness blend weights (for identityDistance) */
  identityEstablishednessWeights: {
    familiarity: 0.4,
    identity: 0.3,
    recency: 0.3,
  },
  /** Gateway score weights (for expansionValue) */
  gatewayScoreWeights: {
    neighborGenres: 0.6,
    ownGenres: 0.4,
    divisor: 5.0,
  },
  /** Minimum expansion value (every candidate has some potential) */
  minimumExpansionValue: 0.1,
  /** Cold-start baseline expansion value (no data to assess quality) */
  coldStartBaseline: 0.3,
  /** Musical step size scaling */
  stepSizeScale: {
    base: 0.5,
    appetite: 0.5,
  },
  /** Min frontier candidates after CUB (catalog fill if short). */
  minFrontierCandidates: 80,

  // ── Part 2: prior incidental Familiarity ────────────────────────────
  priorFamiliarityK: 5,
  priorFamiliarityWeightScale: 40,

  // ── Part 3: Cultural Distance axes ──────────────────────────────────
  /** Weighted sum of linguistic / scene / era (must sum ~1). PROVISIONAL. */
  culturalAxisWeights: {
    linguistic: 0.3,
    scene: 0.45,
    era: 0.25,
  },
  culturalSceneMaxHops: 4,
  culturalEraHalfLifeYears: 25,
  culturalEraMissingDefault: 0.5,

  /**
   * Part 10: cold-start policy — wider frontier, more confidence tolerance.
   * Confidence tags are metadata-completeness based (not audio).
   */
  coldStart: {
    minIdentityArtists: 5,
    minListeningEvents: 10,
    minFrontierCandidates: 120,
    /**
     * Established users: prefer high/partial completeness; may soft-drop low.
     */
    establishedAllowedTags: [
      'high_confidence',
      'partial_confidence',
    ] as const,
  },
};
