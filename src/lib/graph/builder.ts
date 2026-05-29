/**
 * Graph construction from raw Spotify API data.
 * Builds edges from genre overlap and audio similarity.
 */
import type { OrcaNode, OrcaEdge, OrcaGraph, GenreRegion } from './types';
import { getGenreColor as getNormalisedGenreColor, normaliseGenre } from './genre-normaliser';

// ──────────────────────────────────────────────────
// Genre Color Palette (premium light-mode)
// ──────────────────────────────────────────────────

const GENRE_COLORS: Record<string, string> = {
  'electronic': '#6BC7D9', 'edm': '#6BC7D9', 'electro': '#6BC7D9',
  'ambient': '#A89BEF', 'experimental': '#B7A8D6',
  'hip hop': '#C95C8A', 'hip-hop': '#C95C8A', 'rap': '#C95C8A',
  'r&b': '#B97BBF', 'rnb': '#B97BBF',
  'soul': '#9E67A5', 'funk': '#9E67A5',
  'pop': '#B7A8D6', 'k-pop': '#D4A8D6', 'j-pop': '#D4A8D6',
  'rock': '#D17A5C', 'alt': '#D17A5C', 'alternative': '#D17A5C',
  'metal': '#8E4A57', 'hardcore': '#8E4A57',
  'folk': '#91A78B', 'acoustic': '#91A78B', 'singer-songwriter': '#91A78B',
  'jazz': '#D99A6C', 'blues': '#6A8FBF',
  'classical': '#D8BE72', 'orchestra': '#D8BE72',
  'indie': '#7FAFCF', 'indie rock': '#7FAFCF', 'indie pop': '#7FAFCF',
  'country': '#C4A86B', 'latin': '#E8766A', 'reggaeton': '#E8766A',
  'punk': '#D45F5F', 'post-punk': '#D45F5F',
  'reggae': '#7BC47B', 'dancehall': '#7BC47B',
  'world': '#C9A85F',
  'dance': '#5FC4C4', 'house': '#5FB5D4', 'techno': '#8B9FD4',
  'trap': '#D46B8A', 'drill': '#A85C6B',
  'lo-fi': '#9BB5A0', 'lofi': '#9BB5A0',
  'gospel': '#D4C46B', 'worship': '#D4C46B',
};

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

function countSharedGenres(g1: string[], g2: string[]): number {
  const set1 = new Set(g1.map(g => g.toLowerCase()));
  return g2.filter(g => set1.has(g.toLowerCase())).length;
}

/** Cosine similarity between two audio signatures (normalized) */
function audioCosineSimilarity(
  a: { energy: number; valence: number; danceability: number; acousticness: number; instrumentalness: number; tempo: number },
  b: { energy: number; valence: number; danceability: number; acousticness: number; instrumentalness: number; tempo: number }
): number {
  // Normalize tempo to 0-1 range (assuming 40-200 BPM)
  const normTempo = (t: number) => Math.max(0, Math.min(1, (t - 40) / 160));

  const v1 = [a.energy, a.valence, a.danceability, a.acousticness, a.instrumentalness, normTempo(a.tempo)];
  const v2 = [b.energy, b.valence, b.danceability, b.acousticness, b.instrumentalness, normTempo(b.tempo)];

  let dot = 0, mag1 = 0, mag2 = 0;
  for (let i = 0; i < v1.length; i++) {
    dot += v1[i] * v2[i];
    mag1 += v1[i] * v1[i];
    mag2 += v2[i] * v2[i];
  }

  const denom = Math.sqrt(mag1) * Math.sqrt(mag2);
  return denom === 0 ? 0 : dot / denom;
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
