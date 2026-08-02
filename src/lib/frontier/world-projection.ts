import type { OrcaNode } from '@/lib/graph/types';
import {
  WorldConfig,
  type DepthBandId,
  type ReadinessTierId,
} from '@/lib/config/world';
import { normaliseGenreOrUnknown } from '@/lib/graph/genre-normaliser';

export interface WorldSnapshotStats {
  visibleArtists: number;
  hiddenArtists: number;
  visibleEdgeCount: number;
  projectionWindow: { min: number; max: number };
  averageExpansionDistance: number;
  currentSliderPosition: number;
  depthBand?: DepthBandId;
  visibleExpansionBandDistribution: {
    CORE: number;
    FAMILIAR: number;
    COMFORT_EDGE: number;
    EXPANSION: number;
    OUTER_EDGE: number;
  };
}

export interface WorldProjectionSnapshot {
  nodes: OrcaNode[];
  edges: any[];
  stats: WorldSnapshotStats;
}

export interface UnexploredTerritoryBucket {
  territory: string;
  count: number;
  avgDistance: number;
  artistIds: string[];
  /** Counts per depth band for UI chips */
  byDepth: Record<DepthBandId, number>;
}

/**
 * Projection window from continuous slider (legacy).
 * Prefer depth-band exclusive ranges for the product UI.
 */
export function calculateProjectionWindow(slider: number): { min: number; max: number } {
  const S = Math.min(1.0, Math.max(0.0, slider));
  const { min, baseMax, sliderSpan } = WorldConfig.projectionWindow;
  return {
    min,
    max: Math.round((baseMax + S * sliderSpan) * 100) / 100,
  };
}

/** Exclusive distance range for a depth button. */
export function getDepthBandWindow(band: DepthBandId): { min: number; max: number } {
  const b = WorldConfig.depthBands[band] ?? WorldConfig.depthBands.all;
  return { min: b.min, max: b.max };
}

export function depthBandForDistance(distance: number): Exclude<DepthBandId, 'all'> {
  const d = Math.min(1, Math.max(0, distance));
  if (d < 0.25) return 'shallow';
  if (d < 0.5) return 'deeper';
  if (d < 0.75) return 'deep';
  return 'deepest';
}

/**
 * Precompute unexplored (frontier) artists grouped by primary territory/genre.
 * Call after materialize / on globe payload — cheap pure function.
 */
export function buildUnexploredByTerritory(nodes: OrcaNode[]): UnexploredTerritoryBucket[] {
  const map = new Map<string, OrcaNode[]>();
  for (const n of nodes) {
    if (n.state !== 'frontier') continue;
    if (n.reachable === false) continue;
    // Do not invent pop for empty/unmapped tags — bucket as unknown
    const territory = normaliseGenreOrUnknown(n.genres) ?? 'unknown';
    if (!map.has(territory)) map.set(territory, []);
    map.get(territory)!.push(n);
  }

  const emptyDepth = (): Record<DepthBandId, number> => ({
    shallow: 0,
    deeper: 0,
    deep: 0,
    deepest: 0,
    all: 0,
  });

  const out: UnexploredTerritoryBucket[] = [];
  for (const [territory, list] of map) {
    const byDepth = emptyDepth();
    let sumD = 0;
    for (const n of list) {
      const d = n.expansionDistance ?? 0;
      sumD += d;
      const band = depthBandForDistance(d);
      byDepth[band]++;
      byDepth.all++;
    }
    out.push({
      territory,
      count: list.length,
      avgDistance: list.length ? Math.round((sumD / list.length) * 100) / 100 : 0,
      artistIds: list.map((n) => n.id),
      byDepth,
    });
  }
  return out.sort((a, b) => b.count - a.count);
}

/**
 * True when this node is a frontier/expansion candidate (not pure identity).
 */
export function isProjectionCandidate(node: OrcaNode): boolean {
  return (
    node.state === 'frontier' ||
    !!node.projectionMetadata ||
    !!node.candidateEvidence ||
    node.expansionDistance != null
  );
}

const READINESS_TIERS = new Set(['comfort', 'expansion', 'leap']);

export function isReadinessTierId(v: string): v is ReadinessTierId {
  return READINESS_TIERS.has(v);
}

/**
 * Apply exploration depth membership to frontier nodes.
 *
 * - Explored identity: always visible
 * - Frontier in active depth: visible + full emphasis
 * - Frontier outside depth: hidden (depth is a real filter, not a dimmer)
 * - Alo: all reachable frontier visible
 */
export function applyTierEmphasis(
  nodes: OrcaNode[],
  activeTier: ReadinessTierId | 'all',
  activeBucketIds?: Set<string> | 'all',
): OrcaNode[] {
  const active = WorldConfig.tierEmphasis.active;
  const emphasizeAll =
    activeTier === 'all' || activeBucketIds === 'all';
  return nodes.map((node) => {
    // Explored (identity) always on
    if (!isProjectionCandidate(node) || node.state === 'explored') {
      return { ...node, visible: true, tierEmphasis: active };
    }
    if (node.reachable === false) {
      return {
        ...node,
        visible: false,
        tierEmphasis: 0,
        inActiveDepth: false,
      };
    }
    if (emphasizeAll) {
      return {
        ...node,
        visible: true,
        tierEmphasis: active,
        inActiveDepth: true,
      };
    }
    let inBucket: boolean;
    if (activeBucketIds instanceof Set) {
      inBucket = activeBucketIds.has(node.id);
    } else {
      inBucket = node.readinessBucket === activeTier;
    }
    return {
      ...node,
      // Depth filter: out-of-band unexplored do not render / list
      visible: inBucket,
      tierEmphasis: inBucket ? active : 0,
      inActiveDepth: inBucket,
    };
  });
}

/** Frontier nodes emphasized for the active tier (for recommendation cards). */
export function nodesInActiveTier(
  nodes: OrcaNode[],
  activeTier: ReadinessTierId,
  activeBucketIds?: Set<string>,
): OrcaNode[] {
  return nodes.filter((n) => {
    if (n.state !== 'frontier') return false;
    if (n.reachable === false) return false;
    if (activeBucketIds) return activeBucketIds.has(n.id);
    return n.readinessBucket === activeTier;
  });
}

/**
 * WPE: set only `visible` from a distance window (legacy depth bands).
 * For readiness tiers, prefer `applyTierEmphasis` (Change E — no node deletion).
 *
 * Never mutates OCSE `reachable` / decisionConfidence — those are immutable
 * after materialize (RULE-12 / single ownership of projection vs selection).
 *
 * @param sliderOrBand — continuous [0,1] slider OR depth band id OR readiness tier
 */
export function applyProjectionVisibility(
  nodes: OrcaNode[],
  sliderOrBand: number | DepthBandId | ReadinessTierId,
): OrcaNode[] {
  // Change D/E: readiness tier → emphasize, never filter-out
  if (typeof sliderOrBand === 'string' && isReadinessTierId(sliderOrBand)) {
    return applyTierEmphasis(nodes, sliderOrBand);
  }

  const { min, max } =
    typeof sliderOrBand === 'string'
      ? getDepthBandWindow(sliderOrBand)
      : calculateProjectionWindow(sliderOrBand);
  return nodes.map((node) => {
    if (!isProjectionCandidate(node)) {
      // Explored identity always visible on the globe.
      return { ...node, visible: true };
    }
    // OCSE hard-reject stays hidden regardless of depth button
    if (node.reachable === false) {
      return { ...node, visible: false };
    }
    const distance = node.expansionDistance ?? 0.0;
    // Exclusive bands: [min, max). "all" and deepest use max>1 so edge included.
    const inWindow =
      typeof sliderOrBand === 'string' && sliderOrBand === 'all'
        ? true
        : distance >= min && distance < max;
    return { ...node, visible: inWindow };
  });
}

/**
 * Projects the fully evaluated candidate universe into the visual globe
 * by adjusting visibility without altering coordinates, layout, or OCSE reachable.
 */
export function projectWorld(
  nodes: OrcaNode[],
  edges: any[],
  sliderOrBand: number | DepthBandId = 0.5,
): WorldProjectionSnapshot {
  const { min, max } =
    typeof sliderOrBand === 'string'
      ? getDepthBandWindow(sliderOrBand)
      : calculateProjectionWindow(sliderOrBand);

  let visibleCount = 0;
  let hiddenCount = 0;
  let totalExpansionDistance = 0;
  let visibleCandidatesCount = 0;

  const bandDistribution = {
    CORE: 0,
    FAMILIAR: 0,
    COMFORT_EDGE: 0,
    EXPANSION: 0,
    OUTER_EDGE: 0,
  };

  const projectedNodes = applyProjectionVisibility(nodes, sliderOrBand);

  for (const node of projectedNodes) {
    const isCandidate = isProjectionCandidate(node);
    const distance = node.expansionDistance ?? 0.0;
    const isVisible = node.visible !== false;

    if (isVisible) {
      visibleCount++;
      if (isCandidate) {
        totalExpansionDistance += distance;
        visibleCandidatesCount++;
        const band = node.expansionBand;
        if (band && band in bandDistribution) {
          bandDistribution[band as keyof typeof bandDistribution]++;
        }
      }
    } else {
      hiddenCount++;
    }
  }

  const visibleNodeIds = new Set(
    projectedNodes.filter((n) => n.visible).map((n) => n.id)
  );

  // 2. Process Edges Visibility
  let visibleEdgeCount = 0;
  const projectedEdges = edges.map((edge) => {
    const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
    const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;

    const isVisible = visibleNodeIds.has(sourceId) && visibleNodeIds.has(targetId);
    if (isVisible) {
      visibleEdgeCount++;
    }

    return {
      ...edge,
      visible: isVisible,
    };
  });

  const averageExpansionDistance =
    visibleCandidatesCount > 0
      ? Math.round((totalExpansionDistance / visibleCandidatesCount) * 100) / 100
      : 0.0;

  const stats: WorldSnapshotStats = {
    visibleArtists: visibleCount,
    hiddenArtists: hiddenCount,
    visibleEdgeCount,
    projectionWindow: { min, max },
    averageExpansionDistance,
    currentSliderPosition:
      typeof sliderOrBand === 'number'
        ? sliderOrBand
        : sliderOrBand === 'all'
          ? 1
          : (min + Math.min(max, 1)) / 2,
    depthBand: typeof sliderOrBand === 'string' ? sliderOrBand : undefined,
    visibleExpansionBandDistribution: bandDistribution,
  };

  return {
    nodes: projectedNodes,
    edges: projectedEdges,
    stats,
  };
}
export { projectWorld as runWorldProjection };
