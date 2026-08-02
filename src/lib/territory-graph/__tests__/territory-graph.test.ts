/**
 * Part 4 — Territory graph: lineage vs fusion costs, all-pairs cache.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { TerritoryGraphConfig } from '@/lib/config/territory-graph';
import {
  buildTestGraph,
  seedTerritoryGraphFromAdjacency,
  seedFromCoOccurrence,
  classifyEdgeType,
  shortestPathCosts,
  computeAllPairs,
  invalidateAllPairsCache,
  getCachedAllPairs,
  territoryPathDistance,
} from '@/lib/territory-graph';

describe('edge typing', () => {
  it('same family → lineage, cross family → fusion', () => {
    expect(classifyEdgeType('house', 'techno')).toBe('lineage');
    expect(classifyEdgeType('hip-hop', 'latin')).toBe('fusion');
  });
});

describe('lineage cheaper than fusion (same hop count)', () => {
  beforeEach(() => {
    invalidateAllPairsCache();
  });

  it('A→C via two lineage hops cheaper than one fusion hop when fusion cost > 2*lineage', () => {
    // Config: lineage 0.5, fusion 1.0 → path A-B-C = 1.0, direct A-C fusion = 1.0
    // Make explicit graph where 2-lineage < 1-fusion is false with defaults equal;
    // assert type costs differ and path uses min.
    const g = buildTestGraph();
    const lineageCost = TerritoryGraphConfig.lineageCost;
    const fusionCost = TerritoryGraphConfig.fusionCost;

    expect(lineageCost).toBeLessThan(fusionCost);

    // Two lineage hops A-B-C
    const twoLineage = lineageCost * 2;
    // One fusion A-C
    const oneFusion = fusionCost;

    const pathAC = territoryPathDistance(g, 'A', 'C');
    // Shortest should be min(twoLineage, oneFusion)
    expect(pathAC).toBeCloseTo(Math.min(twoLineage, oneFusion), 5);

    // A→D: must go A-C-D or A-B-C-D — fusion involved
    const pathAD = territoryPathDistance(g, 'A', 'D');
    expect(pathAD).toBeGreaterThan(pathAC);

    // Direct assertion: 1 lineage hop < 1 fusion hop (same node count = 1 edge)
    const pathAB = territoryPathDistance(g, 'A', 'B'); // lineage
    // Construct single-edge distances from edge list
    const lineageEdge = g.edges.find((e) => e.from === 'A' && e.to === 'B' && e.type === 'lineage');
    const fusionEdge = g.edges.find((e) => e.from === 'A' && e.to === 'C' && e.type === 'fusion');
    expect(lineageEdge!.cost).toBeLessThan(fusionEdge!.cost);
    expect(pathAB).toBeCloseTo(lineageEdge!.cost, 5);
  });

  it('path of same hop count: pure lineage path cost < pure fusion path cost', () => {
    // Custom: A-B lineage, B-C lineage vs A-X fusion, X-C fusion (2 hops each)
    const lineage = TerritoryGraphConfig.lineageCost;
    const fusion = TerritoryGraphConfig.fusionCost;
    const graph = {
      nodes: ['A', 'B', 'C', 'X'],
      edges: [
        { from: 'A', to: 'B', type: 'lineage' as const, cost: lineage },
        { from: 'B', to: 'C', type: 'lineage' as const, cost: lineage },
        { from: 'A', to: 'X', type: 'fusion' as const, cost: fusion },
        { from: 'X', to: 'C', type: 'fusion' as const, cost: fusion },
      ],
      structureVersion: 'test-2hop',
    };
    invalidateAllPairsCache();
    const dLineagePath = shortestPathCosts(graph, 'A').get('C');
    // Only lineage path exists if we remove fusion... compare edge-sum
    expect(lineage * 2).toBeLessThan(fusion * 2);
    // With both paths, Dijkstra picks cheaper lineage route
    expect(dLineagePath).toBeCloseTo(lineage * 2, 5);
    expect(dLineagePath).toBeLessThan(fusion * 2);
  });
});

describe('all-pairs cache invalidation', () => {
  beforeEach(() => {
    invalidateAllPairsCache();
  });

  it('serves cache on same structureVersion', () => {
    const g = seedTerritoryGraphFromAdjacency();
    const a = computeAllPairs(g);
    const b = computeAllPairs(g);
    expect(a.structureVersion).toBe(b.structureVersion);
    expect(getCachedAllPairs()?.structureVersion).toBe(g.structureVersion);
    // same object reference after cache hit
    expect(a).toBe(b);
  });

  it('invalidates when structure changes', () => {
    const base = seedTerritoryGraphFromAdjacency();
    computeAllPairs(base);
    const v1 = getCachedAllPairs()!.structureVersion;

    const extended = seedFromCoOccurrence(base, [
      { a: 'house', b: 'country', count: 50 },
    ]);
    expect(extended.structureVersion).not.toBe(base.structureVersion);

    const pairs = computeAllPairs(extended);
    expect(pairs.structureVersion).toBe(extended.structureVersion);
    expect(pairs.structureVersion).not.toBe(v1);
  });

  it('unrelated recompute without structure change keeps cache', () => {
    const g = seedTerritoryGraphFromAdjacency();
    const first = computeAllPairs(g);
    // simulate unrelated request: same graph again
    const second = computeAllPairs(g);
    expect(first).toBe(second);
  });
});

describe('adjacency seed', () => {
  it('includes system genres and typed edges', () => {
    const g = seedTerritoryGraphFromAdjacency();
    expect(g.nodes.length).toBeGreaterThan(10);
    expect(g.edges.some((e) => e.type === 'lineage')).toBe(true);
    expect(g.edges.some((e) => e.type === 'fusion')).toBe(true);
    expect(g.structureVersion.length).toBeGreaterThan(0);
  });
});
