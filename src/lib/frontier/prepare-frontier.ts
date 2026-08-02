/**
 * Client/server shared: fix stale frontier snapshots so depth UI works
 * even before a full rematerialize (old data: all reachable=false, flat distances).
 *
 * Same honesty rules as diversify-distances: never rewrite shore_seek / leap_seek
 * expansionDistance. Silent full-set rank-remap was the same class of bug as layout diversify.
 */
import type { OrcaNode } from '@/lib/graph/types';
import { expansionBandFromDistance } from '@/lib/expansion/intelligence';
import { normaliseGenre } from '@/lib/graph/genre-normaliser';
import { isProtectedRetrievalPath } from './stages/diversify-distances';

export interface PrepareFrontierMeta {
  /** True when input variance was below collapse threshold. */
  distanceVarianceCollapsed: boolean;
  /** How many adjacency/unknown nodes had expansionDistance rewritten. */
  remappedCount: number;
  /** How many real-path nodes were left untouched. */
  protectedCount: number;
}

/**
 * Soft-admit + optional diversify of collapsed adjacency distances for display.
 * Does not re-run OCSE/EI. Does not touch real retrieval-path distances.
 *
 * Returns both the prepared node list and honesty metadata so callers can surface
 * when display distances are synthetic vs. grounded.
 */
export function prepareFrontierForDisplay(nodes: OrcaNode[]): {
  nodes: OrcaNode[];
  meta: PrepareFrontierMeta;
} {
  const emptyMeta: PrepareFrontierMeta = {
    distanceVarianceCollapsed: false,
    remappedCount: 0,
    protectedCount: 0,
  };
  if (!nodes.length) return { nodes, meta: emptyMeta };
  const list = nodes.map((n) => ({ ...n }));

  // Soft-admit: if every frontier node was OCSE-rejected, promote top half
  const anyReachable = list.some((n) => n.reachable !== false);
  if (!anyReachable) {
    const ranked = [...list].sort(
      (a, b) =>
        (b.candidateEvidence?.decisionConfidence ?? 0) -
        (a.candidateEvidence?.decisionConfidence ?? 0),
    );
    const promote = Math.max(12, Math.ceil(ranked.length * 0.6));
    const ids = new Set(ranked.slice(0, promote).map((n) => n.id));
    for (const n of list) {
      if (ids.has(n.id)) n.reachable = true;
    }
  }

  const dists = list
    .map((n) => n.expansionDistance)
    .filter((d): d is number => d != null && Number.isFinite(d));
  if (dists.length < 3) return { nodes: list, meta: emptyMeta };

  const mean = dists.reduce((a, b) => a + b, 0) / dists.length;
  const variance =
    dists.reduce((s, d) => s + (d - mean) * (d - mean), 0) / dists.length;
  if (variance >= 0.0025) return { nodes: list, meta: emptyMeta };

  // Collapse: remap ONLY unprotected adjacency — keep shore_seek / leap_seek
  const protectedNodes = list.filter((n) => {
    const path =
      n.retrievalPath ||
      (n as { retrieval_path?: string }).retrieval_path ||
      '';
    return isProtectedRetrievalPath(path);
  });
  const unprotected = list.filter((n) => {
    const path =
      n.retrievalPath ||
      (n as { retrieval_path?: string }).retrieval_path ||
      '';
    return !isProtectedRetrievalPath(path);
  });
  if (unprotected.length < 3) {
    return {
      nodes: list,
      meta: {
        distanceVarianceCollapsed: true,
        remappedCount: 0,
        protectedCount: protectedNodes.length,
      },
    };
  }

  const scored = unprotected.map((n) => {
    const primary = normaliseGenre(n.genres?.length ? n.genres : []);
    const genreSpread = Math.min(1, (n.genres?.length ?? 1) / 4);
    let h = 0;
    const key = n.id + primary;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
    const jitter = (Math.abs(h) % 1000) / 1000;
    const obscurity = 1 - Math.min(100, n.popularity ?? 50) / 100;
    const popPenalty = primary === 'pop' ? 0.15 : 0;
    return {
      n,
      score: genreSpread * 0.35 + obscurity * 0.4 + jitter * 0.4 - popPenalty,
    };
  });
  scored.sort((a, b) => a.score - b.score);
  for (let i = 0; i < scored.length; i++) {
    const t = (i + 0.5) / scored.length;
    const d = Math.round((0.12 + t * 0.76) * 100) / 100;
    const node = scored[i].n;
    node.expansionDistance = d;
    node.expansionBand = expansionBandFromDistance(d);
    node.projectionMetadata = {
      expansionDistance: d,
      expansionBand: node.expansionBand ?? 'EXPANSION',
      displayDistanceRemapped: true,
    };
  }

  return {
    nodes: list,
    meta: {
      distanceVarianceCollapsed: true,
      remappedCount: scored.length,
      protectedCount: protectedNodes.length,
    },
  };
}
