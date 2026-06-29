/**
 * Graph construction from raw Spotify API data.
 * Builds edges from genre overlap and audio similarity.
 */
import type { OrcaNode, OrcaEdge, OrcaGraph, GenreRegion } from './types';
import { getGenreColor as getNormalisedGenreColor } from './genre-normaliser';

// ──────────────────────────────────────────────────
// Genre Color Palette (premium light-mode)
// ──────────────────────────────────────────────────


/**
 * Map a genre string to a hex color.
 * Delegates to the centralised genre normaliser.
 */
export function genreToColor(genre: string): string {
  return getNormalisedGenreColor(genre);
}

// ──────────────────────────────────────────────────
// Graph Builder
// ──────────────────────────────────────────────────

/**
 * Build the complete orca graph from nodes and initial edges.
 * Edges are already built by the kNN strategy in buildMusicBrainzEdges,
 * so this just deduplicates and computes genre regions.
 */
export function buildGraph(nodes: OrcaNode[], edges: OrcaEdge[]): OrcaGraph {
  // Deduplicate edges
  const edgeSet = new Set<string>();
  const dedupedEdges: OrcaEdge[] = [];

  for (const e of edges) {
    const src = typeof e.source === 'string' ? e.source : e.source.id;
    const tgt = typeof e.target === 'string' ? e.target : e.target.id;
    const key = edgeKey(src, tgt);
    if (!edgeSet.has(key)) {
      edgeSet.add(key);
      dedupedEdges.push(e);
    }
  }

  // Build genre regions
  const genres = buildGenreRegions(nodes);

  return { nodes, edges: dedupedEdges, genres };
}

// ──────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}


/**
 * Extract genre regions from all nodes.
 * Centroids are initialized to [0,0,0] — updated by the layout engine.
 */
function buildGenreRegions(nodes: OrcaNode[]): GenreRegion[] {
  const genreMap = new Map<string, { nodeIds: string[] }>();

  for (const node of nodes) {
    for (const genre of node.genres) {
      const lower = genre.toLowerCase();
      if (!genreMap.has(lower)) {
        genreMap.set(lower, { nodeIds: [] });
      }
      genreMap.get(lower)!.nodeIds.push(node.id);
    }
  }

  const regions: GenreRegion[] = [];
  for (const [name, data] of genreMap) {
    // Only create regions for genres with >1 artist
    if (data.nodeIds.length >= 2) {
      regions.push({
        id: name.replace(/\s+/g, '-'),
        name: name,
        color: genreToColor(name),
        centroid: [0, 0, 0],
        nodeCount: data.nodeIds.length,
        nodeIds: data.nodeIds,
      });
    }
  }

  // Sort by node count descending — biggest genres first
  regions.sort((a, b) => b.nodeCount - a.nodeCount);

  return regions;
}
