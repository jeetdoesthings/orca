/**
 * Graph expansion: merge new data, identify frontier candidates.
 */
import type { OrcaNode, OrcaEdge, OrcaGraph } from './types';
import { buildGraph, genreToColor } from './builder';

/**
 * Merge newly fetched nodes and edges into an existing graph.
 * Handles deduplication, frontier state preservation, and genre region recomputation.
 */
export function mergeExpansion(
  existing: OrcaGraph,
  newNodes: OrcaNode[],
  newEdges: OrcaEdge[]
): OrcaGraph {
  const existingNodeIds = new Set(existing.nodes.map(n => n.id));
  const mergedNodes = [...existing.nodes];

  // Add new nodes that don't exist yet
  for (const node of newNodes) {
    if (!existingNodeIds.has(node.id)) {
      mergedNodes.push(node);
      existingNodeIds.add(node.id);
    }
  }

  // Merge edges, deduplicating
  const edgeSet = new Set<string>();
  const mergedEdges = [...existing.edges];

  for (const e of existing.edges) {
    const src = typeof e.source === 'string' ? e.source : e.source.id;
    const tgt = typeof e.target === 'string' ? e.target : e.target.id;
    edgeSet.add(edgeKey(src, tgt));
  }

  for (const e of newEdges) {
    const src = typeof e.source === 'string' ? e.source : e.source.id;
    const tgt = typeof e.target === 'string' ? e.target : e.target.id;
    const key = edgeKey(src, tgt);
    // Only add edge if both nodes exist in the graph
    if (!edgeSet.has(key) && existingNodeIds.has(src) && existingNodeIds.has(tgt)) {
      edgeSet.add(key);
      mergedEdges.push(e);
    }
  }

  // Rebuild genre regions from merged nodes
  return buildGraph(mergedNodes, mergedEdges);
}

/**
 * Get the next batch of artist IDs to expand (fetch related artists for).
 * Prioritizes frontier nodes adjacent to highly-weighted explored nodes.
 */
export function getExpansionCandidates(
  graph: OrcaGraph,
  expandedIds: Set<string>,
  batchSize: number = 5
): string[] {
  // Build adjacency map for scoring
  const adjacency = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    const src = typeof edge.source === 'string' ? edge.source : edge.source.id;
    const tgt = typeof edge.target === 'string' ? edge.target : edge.target.id;
    if (!adjacency.has(src)) adjacency.set(src, new Set());
    if (!adjacency.has(tgt)) adjacency.set(tgt, new Set());
    adjacency.get(src)!.add(tgt);
    adjacency.get(tgt)!.add(src);
  }

  // Weight map for explored nodes
  const weightMap = new Map<string, number>();
  for (const node of graph.nodes) {
    if (node.state === 'explored') {
      weightMap.set(node.id, node.weight);
    }
  }

  // Score each unexpanded explored node by its weight + connected exploration value
  const candidates: { id: string; score: number }[] = [];

  for (const node of graph.nodes) {
    // Expand explored nodes first (their related artists become frontier)
    if (node.state === 'explored' && !expandedIds.has(node.id)) {
      candidates.push({ id: node.id, score: node.weight * 2 });
      continue;
    }

    // Then expand frontier nodes that are highly connected to explored territory
    if (node.state === 'frontier' && !expandedIds.has(node.id)) {
      const neighbors = adjacency.get(node.id);
      if (neighbors) {
        let score = 0;
        for (const neighborId of neighbors) {
          score += weightMap.get(neighborId) ?? 0;
        }
        candidates.push({ id: node.id, score });
      }
    }
  }

  // Sort by score descending, take top batchSize
  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, batchSize).map(c => c.id);
}

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}
