/**
 * Territory graph path costs + structure versioning (Backend Fix Part 4).
 *
 * Lineage edges cost LESS (smaller conceptual jump).
 * Fusion edges cost MORE but remain traversable (genre fusion is real expansion).
 */
export const TerritoryGraphConfig = {
  /** Path cost for lineage (descended-from) hops. */
  lineageCost: 0.5,
  /** Path cost for fusion (cross-pollination) hops. */
  fusionCost: 1.0,
  /**
   * Max all-pairs path cost used to normalize scene distance to [0,1].
   * Paths beyond this clamp to 1.
   */
  maxPathCostForNorm: 4.0,
  /**
   * Min co-occurrence count to keep an auto-seeded edge (Last.fm / playlist stats).
   * Hand-review only high-traffic nodes after auto-gen.
   */
  minCoOccurrence: 3,
  /** Cap raw co-occurrence weight into (0, 1] before cost mapping. */
  coOccurrenceCap: 100,
};
