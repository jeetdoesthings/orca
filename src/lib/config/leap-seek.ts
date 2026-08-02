/**
 * Leap-seek retrieval configuration (second CUB path).
 * Starts from Territory graph far nodes — not seed adjacency.
 */

export const LeapSeekConfig = {
  /** How many distant territories to target per materialize */
  territoriesPerPass: 5,
  /** Extra territories when leap bucket still thin (Component 2 refill) */
  refillExtraTerritories: 3,
  /** Anchors pulled per territory */
  minAnchorsPerTerritory: 3,
  maxAnchorsPerTerritory: 6,
  /** Rolling rotation window (materialize history) */
  rotationWindow: 5,
  /** Penalty applied to recently targeted territories (0–1 farScore scale) */
  recentTargetPenalty: 0.35,
  /** Min farScore to consider a territory "distant enough" (soft; ranking still sorts) */
  minFarScore: 0.28,
  /**
   * Far-score blend weights (must sum ~1) — four metadata axes only.
   * PROVISIONAL — no audio component (never had one here).
   */
  farScoreWeights: {
    territory: 0.4,
    scene: 0.25,
    era: 0.2,
    language: 0.15,
  },
  /**
   * GRE stages treated as home / not leap targets.
   * Exploring+ means user already has footprint — not a leap.
   */
  excludeGreStages: [
    'EXPLORING',
    'GROWING',
    'INTEGRATED',
    'CORE_IDENTITY',
  ] as const,
  /** Last.fm tag cache TTL (ms) — 7 days */
  anchorCacheTtlMs: 7 * 24 * 60 * 60 * 1000,
  /** Discovery confidence for leap_seek anchors (tag-sourced) */
  defaultDiscoveryConfidence: 0.62,
  /** Soft popularity floor for "good entry" ranking (in-territory, not global) */
  entryRankBoost: 0.15,
} as const;
