/**
 * Weighted shortest paths on Territory graph (Part 4).
 * Lineage vs fusion costs differ — same hop count can yield different distance.
 *
 * All-pairs cached; invalidate only when structureVersion changes (Part 12 rule).
 */

import { TerritoryGraphConfig } from '@/lib/config/territory-graph';
import type { AllPairsCache, TerritoryGraph, TerritoryGraphEdge } from './types';

let cachedPairs: AllPairsCache | null = null;
let cachedGraphVersion: string | null = null;

function adjacencyList(
  edges: TerritoryGraphEdge[],
): Map<string, Array<{ to: string; cost: number; type: string }>> {
  const adj = new Map<string, Array<{ to: string; cost: number; type: string }>>();
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push({ to: e.to, cost: e.cost, type: e.type });
  }
  return adj;
}

/** Dijkstra from single source. */
export function shortestPathCosts(
  graph: TerritoryGraph,
  source: string,
): Map<string, number> {
  const adj = adjacencyList(graph.edges);
  const dist = new Map<string, number>();
  for (const n of graph.nodes) dist.set(n, Infinity);
  if (!dist.has(source)) dist.set(source, Infinity);
  dist.set(source, 0);

  const pq: Array<{ node: string; d: number }> = [{ node: source, d: 0 }];
  while (pq.length > 0) {
    pq.sort((a, b) => a.d - b.d);
    const { node, d } = pq.shift()!;
    if (d > (dist.get(node) ?? Infinity)) continue;
    for (const { to, cost } of adj.get(node) ?? []) {
      const nd = d + cost;
      if (nd < (dist.get(to) ?? Infinity)) {
        dist.set(to, nd);
        pq.push({ node: to, d: nd });
      }
    }
  }
  return dist;
}

/**
 * All-pairs shortest paths. Cached until structureVersion changes.
 */
export function computeAllPairs(graph: TerritoryGraph): AllPairsCache {
  if (cachedPairs && cachedGraphVersion === graph.structureVersion) {
    return cachedPairs;
  }

  const distances: Record<string, Record<string, number>> = {};
  for (const src of graph.nodes) {
    const dmap = shortestPathCosts(graph, src);
    distances[src] = {};
    for (const [to, d] of dmap) {
      if (Number.isFinite(d)) distances[src][to] = d;
    }
  }

  cachedPairs = {
    structureVersion: graph.structureVersion,
    distances,
    computedAt: new Date().toISOString(),
  };
  cachedGraphVersion = graph.structureVersion;
  return cachedPairs;
}

/** Force cache clear (tests / structure mutation). */
export function invalidateAllPairsCache(): void {
  cachedPairs = null;
  cachedGraphVersion = null;
}

export function getCachedAllPairs(): AllPairsCache | null {
  return cachedPairs;
}

/**
 * Distance between two nodes using all-pairs cache.
 * Returns Infinity if unreachable.
 */
export function territoryPathDistance(
  graph: TerritoryGraph,
  from: string,
  to: string,
): number {
  if (from === to) return 0;
  const pairs = computeAllPairs(graph);
  return pairs.distances[from]?.[to] ?? Infinity;
}

/**
 * Min path cost between any user genre and any candidate genre, normalized [0,1].
 */
export function minTerritorySceneDistance(
  graph: TerritoryGraph,
  userGenres: string[],
  candidateGenres: string[],
): number {
  if (userGenres.length === 0 || candidateGenres.length === 0) return 1.0;

  let best = Infinity;
  for (const u of userGenres) {
    for (const c of candidateGenres) {
      if (u === c) return 0;
      const d = territoryPathDistance(graph, u, c);
      if (d < best) best = d;
    }
  }
  if (!Number.isFinite(best)) return 1.0;
  const max = TerritoryGraphConfig.maxPathCostForNorm;
  return Math.min(1, best / max);
}
