/**
 * Seed Territory graph from adjacency + co-occurrence (Part 4).
 *
 * Not full hand-curation: GENRE_ADJACENCY + optional co-occurrence stats.
 * Edge typing:
 *   lineage — same musical family, directed "descended from" (lower cost)
 *   fusion  — cross-family undirected (higher cost, still traversable)
 */

import { GENRE_ADJACENCY, SYSTEM_GENRES } from '@/lib/config/genre-adjacency';
import { TerritoryGraphConfig } from '@/lib/config/territory-graph';
import type { TerritoryGraph, TerritoryGraphEdge, TerritoryEdgeType } from './types';

/** Genre families for lineage vs fusion classification. */
const GENRE_FAMILY: Record<string, string> = {
  'hip-hop': 'hiphop',
  trap: 'hiphop',
  drill: 'hiphop',
  grime: 'hiphop',
  'lo-fi-hip-hop': 'hiphop',
  'uk-garage': 'electronic',
  edm: 'electronic',
  house: 'electronic',
  techno: 'electronic',
  trance: 'electronic',
  'drum-and-bass': 'electronic',
  downtempo: 'electronic',
  ambient: 'electronic',
  pop: 'pop',
  'dance-pop': 'pop',
  rock: 'rock',
  'alternative-rock': 'rock',
  'indie-rock': 'rock',
  punk: 'rock',
  metal: 'rock',
  rnb: 'soul',
  soul: 'soul',
  funk: 'soul',
  jazz: 'soul',
  folk: 'acoustic',
  country: 'acoustic',
  classical: 'acoustic',
  latin: 'global',
  'world-music': 'global',
};

function familyOf(genre: string): string {
  return GENRE_FAMILY[genre] ?? 'other';
}

function structureHash(nodes: string[], edges: TerritoryGraphEdge[]): string {
  const n = [...nodes].sort().join(',');
  const e = edges
    .map((x) => `${x.from}>${x.to}:${x.type}:${x.cost.toFixed(3)}`)
    .sort()
    .join('|');
  // FNV-1a
  const s = `${n}#${e}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function edgeKey(from: string, to: string, type: TerritoryEdgeType): string {
  return `${from}|${to}|${type}`;
}

/**
 * Classify adjacency pair: same family → lineage (directed both ways for pathing),
 * different family → fusion undirected (both directions same cost).
 */
export function classifyEdgeType(a: string, b: string): TerritoryEdgeType {
  return familyOf(a) === familyOf(b) ? 'lineage' : 'fusion';
}

function costFor(type: TerritoryEdgeType, coOccurrence?: number): number {
  const base =
    type === 'lineage'
      ? TerritoryGraphConfig.lineageCost
      : TerritoryGraphConfig.fusionCost;
  if (coOccurrence == null || coOccurrence <= 0) return base;
  // Stronger co-occurrence slightly lowers cost (never below half base)
  const cap = TerritoryGraphConfig.coOccurrenceCap;
  const strength = Math.min(1, coOccurrence / cap);
  return base * (1 - 0.35 * strength);
}

/**
 * Build graph from GENRE_ADJACENCY (+ SYSTEM_GENRES nodes).
 */
export function seedTerritoryGraphFromAdjacency(): TerritoryGraph {
  const nodeSet = new Set<string>([...SYSTEM_GENRES]);
  for (const [k, neighbors] of Object.entries(GENRE_ADJACENCY)) {
    nodeSet.add(k);
    for (const n of neighbors) nodeSet.add(n);
  }

  const edges: TerritoryGraphEdge[] = [];
  const seen = new Set<string>();

  for (const [from, neighbors] of Object.entries(GENRE_ADJACENCY)) {
    for (const to of neighbors) {
      const type = classifyEdgeType(from, to);
      const cost = costFor(type);
      // Always store both directions for pathfinding (lineage still typed lineage)
      for (const [a, b] of [
        [from, to],
        [to, from],
      ] as const) {
        const key = edgeKey(a, b, type);
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ from: a, to: b, type, cost });
      }
    }
  }

  const nodes = Array.from(nodeSet).sort();
  return {
    nodes,
    edges,
    structureVersion: structureHash(nodes, edges),
  };
}

/**
 * Merge co-occurrence counts into a base graph (Last.fm tags / playlist stats).
 * High co-occurrence can add fusion edges or reinforce existing ones.
 */
export function seedFromCoOccurrence(
  base: TerritoryGraph,
  pairs: Array<{ a: string; b: string; count: number }>,
): TerritoryGraph {
  const min = TerritoryGraphConfig.minCoOccurrence;
  const edges = [...base.edges];
  const seen = new Set(edges.map((e) => edgeKey(e.from, e.to, e.type)));
  const nodeSet = new Set(base.nodes);

  for (const { a, b, count } of pairs) {
    if (count < min || a === b) continue;
    nodeSet.add(a);
    nodeSet.add(b);
    const type = classifyEdgeType(a, b);
    const cost = costFor(type, count);
    for (const [from, to] of [
      [a, b],
      [b, a],
    ] as const) {
      const key = edgeKey(from, to, type);
      if (seen.has(key)) {
        // Reinforce: lower cost if stronger co-occurrence
        const idx = edges.findIndex(
          (e) => e.from === from && e.to === to && e.type === type,
        );
        if (idx >= 0 && cost < edges[idx].cost) {
          edges[idx] = { ...edges[idx], cost, coOccurrence: count };
        }
        continue;
      }
      seen.add(key);
      edges.push({ from, to, type, cost, coOccurrence: count });
    }
  }

  const nodes = Array.from(nodeSet).sort();
  return {
    nodes,
    edges,
    structureVersion: structureHash(nodes, edges),
  };
}

/** Build a tiny known graph for tests (lineage + fusion). */
export function buildTestGraph(): TerritoryGraph {
  const lineageCost = TerritoryGraphConfig.lineageCost;
  const fusionCost = TerritoryGraphConfig.fusionCost;
  const edges: TerritoryGraphEdge[] = [
    { from: 'A', to: 'B', type: 'lineage', cost: lineageCost },
    { from: 'B', to: 'A', type: 'lineage', cost: lineageCost },
    { from: 'B', to: 'C', type: 'lineage', cost: lineageCost },
    { from: 'C', to: 'B', type: 'lineage', cost: lineageCost },
    // A—C fusion (same hop count as A-B-C lineage path of 2, but one fusion hop)
    { from: 'A', to: 'C', type: 'fusion', cost: fusionCost },
    { from: 'C', to: 'A', type: 'fusion', cost: fusionCost },
    // D only via fusion from C
    { from: 'C', to: 'D', type: 'fusion', cost: fusionCost },
    { from: 'D', to: 'C', type: 'fusion', cost: fusionCost },
  ];
  const nodes = ['A', 'B', 'C', 'D'];
  return {
    nodes,
    edges,
    structureVersion: structureHash(nodes, edges),
  };
}
