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
  // Only keep edges whose endpoints exist in the node set.
  // Stale adjacentTo / lastfm-* seed ids (e.g. lastfm-kanyewest) after Spotify
  // login otherwise crash d3-force-3d with "node not found: …".
  const nodeIds = new Set(nodes.map((n) => n.id));
  const alias = buildIdAliasMap(nodes);

  const edgeSet = new Set<string>();
  const dedupedEdges: OrcaEdge[] = [];

  for (const e of edges) {
    let src = typeof e.source === 'string' ? e.source : e.source.id;
    let tgt = typeof e.target === 'string' ? e.target : e.target.id;
    src = alias.get(src) || src;
    tgt = alias.get(tgt) || tgt;
    if (!nodeIds.has(src) || !nodeIds.has(tgt) || src === tgt) continue;
    const key = edgeKey(src, tgt);
    if (!edgeSet.has(key)) {
      edgeSet.add(key);
      dedupedEdges.push({
        ...e,
        source: src,
        target: tgt,
      } as OrcaEdge);
    }
  }

  // Build genre regions
  const genres = buildGenreRegions(nodes);

  return { nodes, edges: dedupedEdges, genres };
}

/**
 * Map alternate id forms → actual node id present in the graph.
 * e.g. lastfm-kanyewest / spotify-5K4… → 5K4… when that node exists.
 */
function buildIdAliasMap(nodes: OrcaNode[]): Map<string, string> {
  const map = new Map<string, string>();
  const byCompact = new Map<string, string>();

  const compact = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');

  for (const n of nodes) {
    map.set(n.id, n.id);
    if (n.id.startsWith('spotify-')) {
      map.set(n.id.slice('spotify-'.length), n.id);
    } else if (/^[0-9A-Za-z]{15,30}$/.test(n.id)) {
      map.set(`spotify-${n.id}`, n.id);
    }
    const key = compact(n.name || '');
    if (key) {
      // Prefer Spotify-shaped ids over lastfm when both names collide
      const prev = byCompact.get(key);
      if (
        !prev ||
        (n.id.startsWith('lastfm-') === false && String(prev).startsWith('lastfm-'))
      ) {
        byCompact.set(key, n.id);
      }
      map.set(`lastfm-${key}`, n.id);
    }
  }

  for (const [key, id] of byCompact) {
    map.set(`lastfm-${key}`, id);
  }
  return map;
}

/** Filter + remap edges so forceLink never sees missing endpoints. */
export function sanitizeGraphEdges(
  nodes: OrcaNode[],
  edges: OrcaEdge[],
): OrcaEdge[] {
  return buildGraph(nodes, edges).edges;
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
