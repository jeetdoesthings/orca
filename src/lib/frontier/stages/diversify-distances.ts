/**
 * Collapsed-distance handling at layout stage.
 *
 * HISTORICAL BUG: rewrote ALL expansionDistance values into rank-uniform
 * [0.12, 0.88], destroying EI Shore placements for shore_seek after scoring
 * had already put them under 0.34 (and after serve-log had captured real EI).
 *
 * WPE (world-projection.ts) only uses expansionDistance for visibility windows
 * (in/out of band) — it does NOT place nodes or need synthetic spread for
 * layout coordinates. Depth discrimination when variance is collapsed is
 * handled honestly via ensureDistanceSpread flags on the client, not silent
 * remapping here.
 *
 * Policy:
 * 1. Never overwrite shore_seek / leap_seek distances (real retrieval paths).
 * 2. Never overwrite distanceComponents.composite (EI truth).
 * 3. If variance collapsed: set honesty meta; only optionally rank-remap
 *    adjacency/unknown nodes that lack a real path — and only those.
 */

import type { OrcaNode } from '@/lib/graph/types';
import { normaliseGenre } from '@/lib/graph/genre-normaliser';
import { expansionBandFromDistance } from '@/lib/expansion/intelligence';

export interface DiversifyDistancesResult {
  /** True when input variance was below collapse threshold. */
  distanceVarianceCollapsed: boolean;
  /** How many adjacency/unknown nodes had expansionDistance rewritten. */
  remappedCount: number;
  /** How many real-path nodes were left untouched. */
  protectedCount: number;
}

const COLLAPSE_VARIANCE = 0.0025;

function retrievalPathOf(n: OrcaNode): string {
  return (
    n.retrievalPath ||
    (n as { retrieval_path?: string }).retrieval_path ||
    ''
  );
}

/** Real retrieval paths — EI distances must survive layout. */
export function isProtectedRetrievalPath(path: string | undefined): boolean {
  return path === 'shore_seek' || path === 'leap_seek';
}

function isProtectedNode(n: OrcaNode): boolean {
  return isProtectedRetrievalPath(retrievalPathOf(n));
}

/**
 * Detect collapse; protect shore_seek/leap_seek; optionally remap only
 * adjacency/unknown nodes so depth UI still has some spread on filler
 * candidates without inventing Shore from leap or wiping shore_seek.
 */
export function diversifyExpansionDistancesIfCollapsed(
  nodes: OrcaNode[],
): DiversifyDistancesResult {
  const empty: DiversifyDistancesResult = {
    distanceVarianceCollapsed: false,
    remappedCount: 0,
    protectedCount: 0,
  };
  if (nodes.length < 3) return empty;

  const dists = nodes
    .map((n) => n.expansionDistance)
    .filter((d): d is number => d != null && Number.isFinite(d));
  if (dists.length < 3) return empty;

  const mean = dists.reduce((a, b) => a + b, 0) / dists.length;
  const variance =
    dists.reduce((s, d) => s + (d - mean) * (d - mean), 0) / dists.length;

  const protectedNodes = nodes.filter(isProtectedNode);
  const unprotected = nodes.filter((n) => !isProtectedNode(n));

  if (variance >= COLLAPSE_VARIANCE) {
    return {
      distanceVarianceCollapsed: false,
      remappedCount: 0,
      protectedCount: protectedNodes.length,
    };
  }

  // Variance collapsed — honesty flag always; never touch protected paths.
  if (unprotected.length < 3) {
    console.warn(
      `[CUB Frontier Layout] Distance variance collapsed (var=${variance.toFixed(5)}) — ` +
        `no remap (${protectedNodes.length} protected real-path, ${unprotected.length} adjacency). ` +
        `distanceVarianceCollapsed=true`,
    );
    return {
      distanceVarianceCollapsed: true,
      remappedCount: 0,
      protectedCount: protectedNodes.length,
    };
  }

  // Rank-remap ONLY adjacency/unknown — leave shore_seek/leap_seek EI intact
  const scored = unprotected.map((n) => {
    const primary = normaliseGenre(n.genres?.length ? n.genres : ['pop']);
    const genreSpread = Math.min(1, (n.genres?.length ?? 1) / 4);
    let h = 0;
    const key = n.id + primary;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
    const jitter = (Math.abs(h) % 1000) / 1000;
    const obscurity = 1 - Math.min(100, n.popularity ?? 50) / 100;
    const popPenalty = primary === 'pop' ? 0.15 : 0;
    const score = genreSpread * 0.35 + obscurity * 0.4 + jitter * 0.4 - popPenalty;
    return { n, score };
  });
  scored.sort((a, b) => a.score - b.score);

  for (let i = 0; i < scored.length; i++) {
    const t = (i + 0.5) / scored.length;
    const d = Math.round((0.12 + t * 0.76) * 100) / 100;
    const node = scored[i].n;
    node.expansionDistance = d;
    node.expansionBand = expansionBandFromDistance(d);
    // Do NOT overwrite distanceComponents — EI composite stays for serve-log/calibration
    if (node.projectionMetadata) {
      node.projectionMetadata.expansionDistance = d;
      node.projectionMetadata.expansionBand = node.expansionBand;
    } else {
      node.projectionMetadata = {
        expansionDistance: d,
        expansionBand: node.expansionBand ?? 'EXPANSION',
      };
    }
  }

  console.warn(
    `[CUB Frontier Layout] Distance variance collapsed (var=${variance.toFixed(5)}): ` +
      `remapped ${scored.length} adjacency-only nodes; protected ${protectedNodes.length} real-path. ` +
      `distanceVarianceCollapsed=true`,
  );

  return {
    distanceVarianceCollapsed: true,
    remappedCount: scored.length,
    protectedCount: protectedNodes.length,
  };
}
