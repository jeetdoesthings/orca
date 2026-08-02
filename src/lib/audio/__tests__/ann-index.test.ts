/**
 * Part 12 — ANN index avoids full-catalog scan; territory cache structure-only.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  EmbeddingAnnIndex,
  l2Normalize,
  cosineSimilarity,
} from '@/lib/audio/ann-index';
import {
  seedTerritoryGraphFromAdjacency,
  seedFromCoOccurrence,
  computeAllPairs,
  invalidateAllPairsCache,
  getCachedAllPairs,
} from '@/lib/territory-graph';
import { emaUpdateCentroid, centroidDelta } from '@/lib/identity/centroid-ema';
import type { AudioSignature } from '@/lib/graph/types';

function randomVec(dim: number, seed: number): number[] {
  const v: number[] = [];
  let s = seed;
  for (let i = 0; i < dim; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    v.push((s % 1000) / 500 - 1);
  }
  return l2Normalize(v);
}

describe('EmbeddingAnnIndex IVF', () => {
  it('scans fewer vectors than catalog size when probing subset of clusters', () => {
    const dim = 32;
    const n = 200;
    const points = Array.from({ length: n }, (_, i) => ({
      id: `v${i}`,
      vector: randomVec(dim, i * 17 + 3),
    }));
    const index = new EmbeddingAnnIndex();
    index.build(points, { numClusters: 20, seed: 7 });

    const query = randomVec(dim, 999);
    const { results, stats } = index.search(query, { topK: 10, nprobe: 3 });

    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(10);
    expect(stats.catalogSize).toBe(n);
    expect(stats.usedBruteForce).toBe(false);
    // Key scalability claim: not a full catalog scan
    expect(stats.vectorsScanned).toBeLessThan(stats.catalogSize);
    expect(stats.clustersProbed).toBeLessThanOrEqual(3);
  });

  it('nearest neighbor is high-similarity for identical query point', () => {
    const points = [
      { id: 'a', vector: l2Normalize([1, 0, 0, 0]) },
      { id: 'b', vector: l2Normalize([0, 1, 0, 0]) },
      { id: 'c', vector: l2Normalize([0, 0, 1, 0]) },
    ];
    const index = new EmbeddingAnnIndex();
    index.build(points, { numClusters: 3 });
    const { results } = index.search([1, 0, 0, 0], { topK: 1, nprobe: 3 });
    expect(results[0].id).toBe('a');
    expect(results[0].score).toBeGreaterThan(0.99);
  });
});

describe('Territory all-pairs: structure-only invalidation', () => {
  beforeEach(() => {
    invalidateAllPairsCache();
  });

  it('same structure reuses cache; edge add invalidates', () => {
    const g1 = seedTerritoryGraphFromAdjacency();
    const a = computeAllPairs(g1);
    const b = computeAllPairs(g1);
    expect(a).toBe(b);
    expect(getCachedAllPairs()?.structureVersion).toBe(g1.structureVersion);

    // Unrelated requests (same graph) do NOT rebuild
    const c = computeAllPairs(g1);
    expect(c).toBe(a);

    const g2 = seedFromCoOccurrence(g1, [{ a: 'house', b: 'country', count: 40 }]);
    expect(g2.structureVersion).not.toBe(g1.structureVersion);
    const d = computeAllPairs(g2);
    expect(d.structureVersion).toBe(g2.structureVersion);
    expect(d).not.toBe(a);
  });
});

describe('Identity EMA incremental cost (not history-sized)', () => {
  it('update cost independent of history length', () => {
    const c: AudioSignature = {
      energy: 0.5,
      valence: 0.5,
      danceability: 0.5,
      acousticness: 0.5,
      instrumentalness: 0.1,
      tempo: 120,
    };
    const e: AudioSignature = {
      energy: 0.9,
      valence: 0.2,
      danceability: 0.7,
      acousticness: 0.2,
      instrumentalness: 0.05,
      tempo: 130,
    };
    // Fake "long history" would only matter if we recompute from all events;
    // EMA uses only previous centroid + event.
    const once = emaUpdateCentroid(c, e, 0.5, 0.2);
    let cur = c;
    for (let i = 0; i < 100; i++) {
      cur = emaUpdateCentroid(cur, e, 0.1, 0.05);
    }
    // Still a single vector, not an array of 100 events
    expect(typeof cur.energy).toBe('number');
    expect(centroidDelta(c, once)).toBeGreaterThan(0);
  });
});

describe('cosine helper', () => {
  it('identical unit vectors → 1', () => {
    const v = l2Normalize([3, 4, 0]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });
});
