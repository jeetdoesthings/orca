/**
 * Territory graph public API (Part 4).
 *
 * Runbook:
 *   1. seedTerritoryGraphFromAdjacency() — base from GENRE_ADJACENCY
 *   2. optional seedFromCoOccurrence(base, lastfmPairs) — reinforce/add edges
 *   3. computeAllPairs(graph) — cache; invalidates only on structureVersion change
 *   4. minTerritorySceneDistance / territoryPathDistance for Cultural Distance scene axis
 */

export type { TerritoryEdgeType, TerritoryGraph, TerritoryGraphEdge, AllPairsCache } from './types';
export {
  seedTerritoryGraphFromAdjacency,
  seedFromCoOccurrence,
  buildTestGraph,
  classifyEdgeType,
} from './seed';
export {
  shortestPathCosts,
  computeAllPairs,
  invalidateAllPairsCache,
  getCachedAllPairs,
  territoryPathDistance,
  minTerritorySceneDistance,
} from './shortest-path';

import { seedTerritoryGraphFromAdjacency } from './seed';
import type { TerritoryGraph } from './types';

let defaultGraph: TerritoryGraph | null = null;

/** Lazy singleton default graph (adjacency-seeded). */
export function getDefaultTerritoryGraph(): TerritoryGraph {
  if (!defaultGraph) {
    defaultGraph = seedTerritoryGraphFromAdjacency();
  }
  return defaultGraph;
}

/** Replace default (e.g. after co-occurrence rebuild). */
export function setDefaultTerritoryGraph(graph: TerritoryGraph): void {
  defaultGraph = graph;
}
