/**
 * Exclusive exploration-depth filter for unexplored (frontier) nodes.
 * Close / Far / Farther are exclusive distance bands; All = all reachable.
 *
 * forceRankSpread is a LAST RESORT only — sets honesty flags when it fires.
 * Prefer Close-seek (server) for real Close material before remapping.
 * Real retrieval paths (shore_seek / leap_seek) are NEVER remapped here.
 */

import type { OrcaNode } from '@/lib/graph/types';
import {
  WorldConfig,
  explorationDepthToBucket,
  type ExplorationDepthId,
  type ReadinessTierId,
} from '@/lib/config/world';

const CLOSE_MAX = WorldConfig.explorationDepth.close.distanceMax;
const FAR_MAX = WorldConfig.explorationDepth.far.distanceMax;

function bandOf(d: number): 'close' | 'far' | 'farther' {
  if (d < CLOSE_MAX) return 'close';
  if (d < FAR_MAX) return 'far';
  return 'farther';
}

function retrievalPathOf(n: OrcaNode): string {
  return (
    n.retrievalPath ||
    (n as { retrieval_path?: string }).retrieval_path ||
    ''
  );
}

function isProtectedRetrievalPath(path: string | undefined): boolean {
  return path === 'shore_seek' || path === 'leap_seek';
}

export interface DistanceSpreadMeta {
  /** Rank-remap ran because an exclusive band was empty. */
  shoreBucketFallback: boolean;
  /** Rank-remap ran because variance collapsed (< 0.002). */
  distanceVarianceCollapsed: boolean;
  didRemap: boolean;
  /** How many adjacency/unknown nodes were remapped. */
  remappedCount: number;
  /** How many real-path nodes were protected from remap. */
  protectedCount: number;
}

export interface DistanceSpreadResult {
  nodes: OrcaNode[];
  meta: DistanceSpreadMeta;
}

export interface FilterFrontierResult {
  nodes: OrcaNode[];
  meta: DistanceSpreadMeta;
}

/**
 * Rank-remap expansionDistance into [0.05, 0.95] for unprotected nodes only,
 * preserving relative order. Sets displayDistanceRemapped honesty flag.
 */
function forceRankSpread(list: OrcaNode[]): {
  remappedCount: number;
  protectedCount: number;
} {
  const protectedNodes = list.filter((n) => isProtectedRetrievalPath(retrievalPathOf(n)));
  const unprotected = list.filter((n) => !isProtectedRetrievalPath(retrievalPathOf(n)));

  const scored = unprotected.map((n, i) => {
    let h = 0;
    const key = n.id + (n.genres?.[0] || '');
    for (let j = 0; j < key.length; j++) h = (h * 31 + key.charCodeAt(j)) | 0;
    const jitter = (Math.abs(h) % 1000) / 1000;
    const base =
      n.expansionDistance != null && Number.isFinite(n.expansionDistance)
        ? n.expansionDistance
        : 0.5;
    const obscurity = 1 - Math.min(100, n.popularity ?? 50) / 100;
    return {
      n,
      score: base * 1000 + obscurity * 0.5 + jitter * 0.01 + i * 0.0001,
    };
  });
  scored.sort((a, b) => a.score - b.score);
  for (let i = 0; i < scored.length; i++) {
    const t = (i + 0.5) / scored.length;
    const d = Math.round((0.05 + t * 0.9) * 1000) / 1000;
    const node = scored[i].n;
    node.expansionDistance = d;
    if (node.projectionMetadata) {
      node.projectionMetadata.expansionDistance = d;
      node.projectionMetadata.displayDistanceRemapped = true;
    } else {
      node.projectionMetadata = {
        expansionDistance: d,
        expansionBand: node.expansionBand ?? 'EXPANSION',
        displayDistanceRemapped: true,
      };
    }
  }

  return {
    remappedCount: scored.length,
    protectedCount: protectedNodes.length,
  };
}

export interface EnsureDistanceSpreadOptions {
  /**
   * When false, never rank-remap — only fill missing distances.
   * Use after Shore-seek so empty Shore stays honestly empty until last resort.
   * Default true (last-resort remap with flags).
   */
  allowRemap?: boolean;
  /** Materialized recommendation-surface ids, preferred over distance bands when present. */
  surfaceBucketIds?: Record<ReadinessTierId, string[]> | null;
}

/**
 * Ensure expansionDistance usable for exclusive bands.
 * Remap only when allowRemap and (variance collapsed OR band empty).
 * Returns meta flags for UI honesty (not silent).
 * Real-path nodes (shore_seek / leap_seek) are protected from all remapping.
 */
export function ensureDistanceSpread(
  nodes: OrcaNode[],
  options: EnsureDistanceSpreadOptions = {},
): DistanceSpreadResult {
  const allowRemap = options.allowRemap !== false;
  const meta: DistanceSpreadMeta = {
    shoreBucketFallback: false,
    distanceVarianceCollapsed: false,
    didRemap: false,
    remappedCount: 0,
    protectedCount: 0,
  };

  if (nodes.length === 0) return { nodes: [], meta };
  const list = nodes.map((n) => ({ ...n }));

  list.forEach((n, i) => {
    if (n.expansionDistance == null || !Number.isFinite(n.expansionDistance)) {
      // Path-aware fallback for missing distances, not a rank remap.
      const path = retrievalPathOf(n);
      if (path === 'shore_seek') {
        n.expansionDistance = 0.25;
      } else if (path === 'leap_seek') {
        n.expansionDistance = 0.75;
      } else {
        n.expansionDistance = 0.1 + ((i + 0.5) / list.length) * 0.8;
      }
    }
  });

  if (list.length < 3 || !allowRemap) {
    return { nodes: list, meta };
  }

  const dists = list.map((n) => n.expansionDistance as number);
  const mean = dists.reduce((a, b) => a + b, 0) / dists.length;
  const variance =
    dists.reduce((s, d) => s + (d - mean) * (d - mean), 0) / dists.length;

  if (variance < 0.002) {
    const counts = forceRankSpread(list);
    meta.distanceVarianceCollapsed = true;
    meta.didRemap = true;
    meta.remappedCount = counts.remappedCount;
    meta.protectedCount = counts.protectedCount;
    return { nodes: list, meta };
  }

  const reachable = list.filter((n) => n.reachable !== false);
  if (reachable.length >= 3) {
    const occ = { close: 0, far: 0, farther: 0 };
    for (const n of reachable) {
      occ[bandOf(n.expansionDistance as number)]++;
    }
    if (occ.close === 0 || occ.far === 0 || occ.farther === 0) {
      const counts = forceRankSpread(list);
      // Empty exclusive band — primarily Close honesty (any empty band triggers)
      meta.shoreBucketFallback = occ.close === 0;
      meta.didRemap = true;
      meta.remappedCount = counts.remappedCount;
      meta.protectedCount = counts.protectedCount;
    }
  }

  return { nodes: list, meta };
}

/**
 * Apply exclusive depth filter.
 * Returns nodes with visible/inActiveDepth + honesty meta from any remap.
 */
export function filterFrontierByDepth(
  universe: OrcaNode[],
  depth: ExplorationDepthId,
  options?: EnsureDistanceSpreadOptions,
): FilterFrontierResult {
  const { nodes: spread, meta } = ensureDistanceSpread(universe, options);

  if (depth === 'all') {
    return {
      nodes: spread.map((n) => ({
        ...n,
        state: 'frontier' as const,
        visible: n.reachable !== false,
        tierEmphasis: n.reachable === false ? 0 : 1,
        inActiveDepth: n.reachable !== false,
      })),
      meta,
    };
  }

  const { distanceMin, distanceMax } = WorldConfig.explorationDepth[depth];
  const bucket = explorationDepthToBucket(depth);
  const bucketIds =
    bucket && options?.surfaceBucketIds?.[bucket]?.length
      ? new Set(options.surfaceBucketIds[bucket])
      : null;

  return {
    nodes: spread.map((n) => {
      if (n.reachable === false) {
        return {
          ...n,
          state: 'frontier' as const,
          visible: false,
          tierEmphasis: 0,
          inActiveDepth: false,
        };
      }
      const d =
        n.expansionDistance != null && Number.isFinite(n.expansionDistance)
          ? n.expansionDistance
          : 0.5;
      const inBand = bucketIds
        ? bucketIds.has(n.id)
        : d >= distanceMin && d < distanceMax;
      return {
        ...n,
        state: 'frontier' as const,
        visible: inBand,
        tierEmphasis: inBand ? 1 : 0,
        inActiveDepth: inBand,
      };
    }),
    meta,
  };
}

/** Count currently visible (in-band) frontier nodes. */
export function countVisibleFrontier(nodes: OrcaNode[]): number {
  return nodes.filter((n) => n.visible !== false && n.reachable !== false).length;
}
