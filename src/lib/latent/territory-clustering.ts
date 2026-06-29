/**
 * ORCA Taste Territories Clustering Engine
 * 
 * Implements a k-Nearest Neighbors similarity graph construction and 
 * a multi-level Louvain community detection algorithm in TypeScript.
 */

export interface LatentNode {
  id: string; // Artist ID
  vector: number[]; // Fused embedding vector (33D)
}

export interface LatentEdge {
  source: string;
  target: string;
  weight: number;
}

import { cosineSimilarity } from '@/lib/math';
export { cosineSimilarity };

/**
 * Builds a k-Nearest Neighbors similarity graph from a list of nodes.
 * 
 * @param nodes List of artists with their fused embedding vectors
 * @param k Number of nearest neighbors per artist
 * @param minSimilarity Minimum cosine similarity threshold to create an edge
 */
export function buildKnnGraph(
  nodes: LatentNode[],
  k: number = 10,
  minSimilarity: number = 0.3
): LatentEdge[] {
  const edges: LatentEdge[] = [];
  const edgeSet = new Set<string>();

  const getEdgeKey = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);

  // 1. Compute all pairwise similarities
  const N = nodes.length;
  const similarities: { targetIndex: number; sim: number }[][] = Array.from(
    { length: N },
    () => []
  );

  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const sim = cosineSimilarity(nodes[i].vector, nodes[j].vector);
      if (sim >= minSimilarity) {
        similarities[i].push({ targetIndex: j, sim });
        similarities[j].push({ targetIndex: i, sim });
      }
    }
  }

  // 2. Extract top-k neighbors for each node and add edges
  for (let i = 0; i < N; i++) {
    // Sort similarities descending
    similarities[i].sort((a, b) => b.sim - a.sim);
    const topK = similarities[i].slice(0, k);

    for (const neighbor of topK) {
      const u = nodes[i].id;
      const v = nodes[neighbor.targetIndex].id;
      const key = getEdgeKey(u, v);

      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push({
          source: u,
          target: v,
          weight: neighbor.sim,
        });
      }
    }
  }

  return edges;
}

/**
 * Internally represents a node during Louvain iterations.
 */
interface LouvainNodeAdjacency {
  neighbor: number; // Neighbor node index
  weight: number;   // Edge weight
}

/**
 * Runs the multi-level Louvain community detection algorithm.
 * Returns a map of community index to array of artist IDs.
 * 
 * @param nodes List of nodes to cluster
 * @param edges Similarity edges between nodes
 */
export function runLouvainClustering(
  nodes: LatentNode[],
  edges: LatentEdge[]
): Map<number, string[]> {
  const idToIndex = new Map<string, number>();
  const indexToId: string[] = [];

  nodes.forEach((n, idx) => {
    idToIndex.set(n.id, idx);
    indexToId.push(n.id);
  });

  const N = nodes.length;
  if (N === 0) return new Map();

  // Create initial adjacency list representation
  let adj: LouvainNodeAdjacency[][] = Array.from({ length: N }, () => []);
  let selfLoops = new Array<number>(N).fill(0);

  edges.forEach((e) => {
    const u = idToIndex.get(e.source);
    const v = idToIndex.get(e.target);
    if (u !== undefined && v !== undefined) {
      if (u === v) {
        selfLoops[u] += e.weight;
      } else {
        adj[u].push({ neighbor: v, weight: e.weight });
        adj[v].push({ neighbor: u, weight: e.weight });
      }
    }
  });

  // Track original node map to reconstruct nested community paths
  const originalToCurrent = Array.from({ length: N }, (_, i) => i);

  let currentN = N;
  let converged = false;

  while (!converged && currentN > 1) {
    // 1. Run modularity optimization on current level
    const { communities: levelCommunities, moved } = runModularityOptimization(
      currentN,
      adj,
      selfLoops
    );

    if (!moved) {
      converged = true;
      break;
    }

    // 2. Contract the graph to build the next level
    const uniqueComms = Array.from(new Set(levelCommunities)).sort((a, b) => a - b);
    const commToNewIndex = new Map<number, number>();
    uniqueComms.forEach((c, idx) => commToNewIndex.set(c, idx));

    // Map original nodes to the new contiguous community indices
    for (let i = 0; i < N; i++) {
      const oldComm = originalToCurrent[i];
      const nextLevelComm = levelCommunities[oldComm];
      originalToCurrent[i] = commToNewIndex.get(nextLevelComm)!;
    }

    const nextN = uniqueComms.length;
    const nextAdj: LouvainNodeAdjacency[][] = Array.from({ length: nextN }, () => []);
    const nextSelfLoops = new Array<number>(nextN).fill(0);

    // Aggregate weights between communities
    const interCommunityWeights = Array.from({ length: nextN }, () => new Map<number, number>());

    for (let u = 0; u < currentN; u++) {
      const uComm = commToNewIndex.get(levelCommunities[u])!;
      
      // Add self loop contribution from u's self loops and internal community links
      nextSelfLoops[uComm] += selfLoops[u];

      adj[u].forEach((edge) => {
        const vComm = commToNewIndex.get(levelCommunities[edge.neighbor])!;
        if (uComm === vComm) {
          // Internal edge within community becomes self loop (counted twice, so divide by 2 later, or sum directly)
          // Since adj lists edges in both directions, we divide weight by 2 when creating self loop
          nextSelfLoops[uComm] += edge.weight / 2;
        } else {
          // External edge between communities
          const currentWeight = interCommunityWeights[uComm].get(vComm) ?? 0;
          interCommunityWeights[uComm].set(vComm, currentWeight + edge.weight);
        }
      });
    }

    // Reconstruct adjacency list for next level
    for (let u = 0; u < nextN; u++) {
      for (const [v, weight] of interCommunityWeights[u].entries()) {
        nextAdj[u].push({ neighbor: v, weight });
      }
    }

    adj = nextAdj;
    selfLoops = nextSelfLoops;
    currentN = nextN;
  }

  // Group original artist IDs by final community indexes
  const communitiesMap = new Map<number, string[]>();
  for (let i = 0; i < N; i++) {
    const comm = originalToCurrent[i];
    if (!communitiesMap.has(comm)) {
      communitiesMap.set(comm, []);
    }
    communitiesMap.get(comm)!.push(indexToId[i]);
  }

  return communitiesMap;
}

/**
 * Optimizes modularity by moving individual nodes between communities.
 */
function runModularityOptimization(
  n: number,
  adj: LouvainNodeAdjacency[][],
  selfLoops: number[]
): { communities: number[]; moved: boolean } {
  const communities = Array.from({ length: n }, (_, i) => i);

  // Compute node degrees (k_i) and total network weight (2m)
  const k = new Array<number>(n).fill(0);
  let doubleM = 0;

  for (let i = 0; i < n; i++) {
    let degree = selfLoops[i];
    adj[i].forEach((edge) => {
      degree += edge.weight;
    });
    k[i] = degree;
    doubleM += degree;
  }

  if (doubleM === 0) {
    return { communities, moved: false };
  }

  // SigmaTot[c]: sum of degrees of all nodes in community c
  const sigmaTot = [...k];
  // SigmaIn[c]: sum of weights of internal edges of community c
  const sigmaIn = [...selfLoops];

  let anyMoved = false;
  let iterations = 0;
  let levelMoved = true;

  while (levelMoved && iterations < 20) {
    levelMoved = false;
    iterations++;

    for (let i = 0; i < n; i++) {
      const currComm = communities[i];
      const k_i = k[i];

      // 1. Calculate weights from node i to adjacent communities
      const k_i_in = new Map<number, number>();
      adj[i].forEach((edge) => {
        const neighborComm = communities[edge.neighbor];
        const w = k_i_in.get(neighborComm) ?? 0;
        k_i_in.set(neighborComm, w + edge.weight);
      });

      // 2. Remove node i from its current community
      communities[i] = -1;
      sigmaTot[currComm] -= k_i;
      const iToCurrCommWeight = k_i_in.get(currComm) ?? 0;
      sigmaIn[currComm] -= selfLoops[i] + 2 * iToCurrCommWeight;

      // 3. Find the community that yields maximum modularity gain
      let bestComm = currComm;
      let maxGainNum = 0;

      for (const [comm, k_in] of k_i_in.entries()) {
        if (comm === currComm) continue;

        // Modularity gain formula:
        // Delta Q = (k_i_in / m) - (SigmaTot * k_i / (2 * m^2))
        // To maximize Delta Q, since doubleM = 2m is constant:
        // Delta Q * doubleM^2 = 2 * (k_in * doubleM - sigmaTot[comm] * k_i)
        const gainNum = 2 * (k_in * doubleM - sigmaTot[comm] * k_i);

        if (gainNum > maxGainNum) {
          maxGainNum = gainNum;
          bestComm = comm;
        }
      }

      // 4. Move node i to the best community (or put back in current)
      communities[i] = bestComm;
      sigmaTot[bestComm] += k_i;
      const iToBestCommWeight = k_i_in.get(bestComm) ?? 0;
      sigmaIn[bestComm] += selfLoops[i] + 2 * iToBestCommWeight;

      if (bestComm !== currComm) {
        levelMoved = true;
        anyMoved = true;
      }
    }
  }

  return { communities, moved: anyMoved };
}
