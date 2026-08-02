/**
 * In-process ANN index for embedding-space lookups (Part 12).
 *
 * IVF-style: partition vectors into clusters; query scans only nprobe nearest
 * clusters — never brute-force full catalog when index is built.
 *
 * Not FAISS (native) / not full HNSW graph (ops weight). Pure TypeScript.
 * Cosine similarity (L2-normalized vectors).
 */

import { AnnConfig } from '@/lib/config/ann';

export interface AnnPoint {
  id: string;
  vector: number[];
  meta?: Record<string, unknown>;
}

export interface AnnSearchResult {
  id: string;
  score: number; // cosine similarity [−1, 1], higher = closer
  meta?: Record<string, unknown>;
}

export interface AnnSearchStats {
  catalogSize: number;
  vectorsScanned: number;
  clustersProbed: number;
  usedBruteForce: boolean;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** L2 normalize in place copy. */
export function l2Normalize(v: number[]): number[] {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s) || 1;
  return v.map((x) => x / n);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i++) dot += a[i] * b[i];
  return dot; // assumes normalized
}

/**
 * IVF ANN index.
 */
export class EmbeddingAnnIndex {
  private points: AnnPoint[] = [];
  private norms: number[][] = [];
  private centroids: number[][] = [];
  private inverted: number[][] = []; // cluster → point indices
  private built = false;
  private numClusters = AnnConfig.defaultNumClusters;

  get size(): number {
    return this.points.length;
  }

  get isBuilt(): boolean {
    return this.built;
  }

  /** Replace catalog and rebuild. */
  build(points: AnnPoint[], opts?: { numClusters?: number; seed?: number }): void {
    this.points = points.slice();
    this.norms = this.points.map((p) => l2Normalize(p.vector));
    this.numClusters = Math.max(
      1,
      Math.min(opts?.numClusters ?? AnnConfig.defaultNumClusters, Math.max(1, points.length)),
    );
    if (points.length === 0) {
      this.centroids = [];
      this.inverted = [];
      this.built = true;
      return;
    }
    if (points.length <= this.numClusters) {
      // Tiny catalog: one cluster per point effectively — still "built"
      this.numClusters = points.length;
    }
    this.centroids = this.kMeansPlusPlus(this.norms, this.numClusters, opts?.seed ?? AnnConfig.seed);
    this.inverted = Array.from({ length: this.numClusters }, () => []);
    for (let i = 0; i < this.norms.length; i++) {
      const c = this.nearestCentroid(this.norms[i]);
      this.inverted[c].push(i);
    }
    this.built = true;
  }

  /**
   * Approximate k-NN. Stats prove we do not scan full catalog when nprobe < k clusters.
   */
  search(
    query: number[],
    opts?: { topK?: number; nprobe?: number },
  ): { results: AnnSearchResult[]; stats: AnnSearchStats } {
    const topK = opts?.topK ?? AnnConfig.defaultTopK;
    const nprobe = Math.max(1, opts?.nprobe ?? AnnConfig.defaultNprobe);
    const q = l2Normalize(query);

    if (!this.built || this.points.length === 0) {
      return {
        results: [],
        stats: {
          catalogSize: 0,
          vectorsScanned: 0,
          clustersProbed: 0,
          usedBruteForce: true,
        },
      };
    }

    // Tiny index: brute ok
    if (this.points.length <= nprobe || this.centroids.length <= 1) {
      return this.bruteForce(q, topK);
    }

    // Rank centroids by similarity to query
    const centScores = this.centroids.map((c, i) => ({
      i,
      s: cosineSimilarity(q, c),
    }));
    centScores.sort((a, b) => b.s - a.s);
    const probe = centScores.slice(0, Math.min(nprobe, centScores.length));

    const candidates = new Set<number>();
    for (const { i } of probe) {
      for (const idx of this.inverted[i] ?? []) candidates.add(idx);
    }

    const scored: AnnSearchResult[] = [];
    for (const idx of candidates) {
      scored.push({
        id: this.points[idx].id,
        score: cosineSimilarity(q, this.norms[idx]),
        meta: this.points[idx].meta,
      });
    }
    scored.sort((a, b) => b.score - a.score);

    return {
      results: scored.slice(0, topK),
      stats: {
        catalogSize: this.points.length,
        vectorsScanned: candidates.size,
        clustersProbed: probe.length,
        usedBruteForce: false,
      },
    };
  }

  private bruteForce(
    q: number[],
    topK: number,
  ): { results: AnnSearchResult[]; stats: AnnSearchStats } {
    const scored = this.norms.map((v, i) => ({
      id: this.points[i].id,
      score: cosineSimilarity(q, v),
      meta: this.points[i].meta,
    }));
    scored.sort((a, b) => b.score - a.score);
    return {
      results: scored.slice(0, topK),
      stats: {
        catalogSize: this.points.length,
        vectorsScanned: this.points.length,
        clustersProbed: this.centroids.length,
        usedBruteForce: true,
      },
    };
  }

  private nearestCentroid(v: number[]): number {
    let best = 0;
    let bestS = -Infinity;
    for (let i = 0; i < this.centroids.length; i++) {
      const s = cosineSimilarity(v, this.centroids[i]);
      if (s > bestS) {
        bestS = s;
        best = i;
      }
    }
    return best;
  }

  private kMeansPlusPlus(data: number[][], k: number, seed: number): number[][] {
    const rand = mulberry32(seed);
    const dim = data[0]?.length ?? 0;
    if (data.length === 0 || dim === 0) return [];
    const kk = Math.min(k, data.length);
    const centers: number[][] = [];

    // First center random
    centers.push(data[Math.floor(rand() * data.length)].slice());

    while (centers.length < kk) {
      const dists = data.map((p) => {
        let minD = Infinity;
        for (const c of centers) {
          // cosine distance
          const d = 1 - cosineSimilarity(p, c);
          if (d < minD) minD = d;
        }
        return minD * minD;
      });
      const sum = dists.reduce((a, b) => a + b, 0) || 1;
      let r = rand() * sum;
      let idx = 0;
      for (let i = 0; i < dists.length; i++) {
        r -= dists[i];
        if (r <= 0) {
          idx = i;
          break;
        }
        idx = i;
      }
      centers.push(data[idx].slice());
    }

    // Few Lloyd iterations
    for (let iter = 0; iter < 8; iter++) {
      const sums = centers.map(() => new Array(dim).fill(0));
      const counts = centers.map(() => 0);
      for (const p of data) {
        let bi = 0;
        let bs = -Infinity;
        for (let i = 0; i < centers.length; i++) {
          const s = cosineSimilarity(p, centers[i]);
          if (s > bs) {
            bs = s;
            bi = i;
          }
        }
        counts[bi]++;
        for (let d = 0; d < dim; d++) sums[bi][d] += p[d];
      }
      for (let i = 0; i < centers.length; i++) {
        if (counts[i] === 0) continue;
        centers[i] = l2Normalize(sums[i].map((x) => x / counts[i]));
      }
    }

    return centers;
  }
}

/** Process-wide singleton for product path (optional). */
let globalIndex: EmbeddingAnnIndex | null = null;

export function getGlobalAnnIndex(): EmbeddingAnnIndex {
  if (!globalIndex) globalIndex = new EmbeddingAnnIndex();
  return globalIndex;
}

export function resetGlobalAnnIndex(): void {
  globalIndex = new EmbeddingAnnIndex();
}

/**
 * Load TrackEmbedding rows from DB into ANN index (real_audio preferred).
 */
export async function buildAnnIndexFromDb(opts?: {
  modelId?: string;
  limit?: number;
}): Promise<EmbeddingAnnIndex> {
  const { prisma } = await import('@/lib/prisma');
  const rows = await prisma.trackEmbedding.findMany({
    where: opts?.modelId ? { modelId: opts.modelId } : undefined,
    take: opts?.limit ?? 5000,
    orderBy: { computedAt: 'desc' },
  });

  const points: AnnPoint[] = [];
  for (const row of rows) {
    try {
      const vector = JSON.parse(row.embeddingVector) as number[];
      if (!Array.isArray(vector) || vector.length === 0) continue;
      points.push({
        id: row.trackKey,
        vector,
        meta: {
          confidenceTag: row.confidenceTag,
          modelId: row.modelId,
        },
      });
    } catch {
      // skip bad row
    }
  }

  const index = getGlobalAnnIndex();
  index.build(points);
  return index;
}
