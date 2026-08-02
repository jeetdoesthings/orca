/**
 * Territory / genre graph types (Part 4).
 * Nodes = genres/territories; edges carry explicit type.
 */

export type TerritoryEdgeType = 'lineage' | 'fusion';

export interface TerritoryGraphEdge {
  from: string;
  to: string;
  type: TerritoryEdgeType;
  /** Path cost used in shortest-path (lineage < fusion). */
  cost: number;
  /** Optional co-occurrence support count from seeding. */
  coOccurrence?: number;
}

export interface TerritoryGraph {
  nodes: string[];
  edges: TerritoryGraphEdge[];
  /** Hash of structure (nodes + edge endpoints/types) for cache invalidation. */
  structureVersion: string;
}

/** All-pairs shortest path matrix + metadata. */
export interface AllPairsCache {
  structureVersion: string;
  /** Nested map: from → to → distance cost. Missing = unreachable. */
  distances: Record<string, Record<string, number>>;
  computedAt: string;
}
