/**
 * Approximate nearest-neighbor index config (Part 12).
 *
 * Choice: in-process IVF (inverted file / coarse quantizer), not FAISS/HNSW native.
 * Why: Next.js Node runtime, no native binary ops; catalog scores hundreds–thousands
 * of vectors today. IVF probes nprobe clusters only — O(nprobe * n/k) not O(n).
 * Upgrade path: swap backend for HNSW service if catalog hits millions.
 */
export const AnnConfig = {
  /** Default number of coarse clusters (centroids). */
  defaultNumClusters: 16,
  /** Clusters probed per query (higher = more recall, more work). */
  defaultNprobe: 3,
  /** Max k for search results. */
  defaultTopK: 20,
  /** Random seed for deterministic k-means++ init in tests. */
  seed: 42,
};
