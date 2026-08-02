/**
 * Shore-seek: depth within already-explored territory (not outward adjacency).
 * Uses four-axis EI for distances (no audio). PROVISIONAL thresholds.
 */

export const ShoreSeekConfig = {
  /** Target count of shore_seek candidates per materialize */
  targetCount: 28,
  /** Max lesser-known peers pulled per explored seed artist */
  maxPerSeed: 4,
  /** Cap seeds we expand from (heaviest first) */
  maxSeeds: 24,
  /**
   * Prefer artists less popular than seed (deep cuts / secondary).
   * Peer popularity must be <= seedPop + this margin.
   */
  popularityMargin: 8,
  /** Absolute max popularity for a shore_seek peer (avoid mega-stars) */
  maxPeerPopularity: 72,
  /** Min discovery confidence for catalog peers */
  defaultDiscoveryConfidence: 0.68,
  /** Soft bar: composite distance expected under Shore max (0.34) */
  shoreDistanceMax: 0.34,
  /** Min shore-range candidates before we consider pool "short" */
  minShorePopulation: 8,
} as const;
