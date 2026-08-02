/**
 * Visual World Composer / Layout defaults configuration.
 * WPE projection window + expansion band thresholds live here (single source).
 */
export const WorldConfig = {
  /** Maximum artist node representation percentage cap per single genre */
  genreCapPercent: 0.25,
  /** Default visible capacity node limit for visualizer layout */
  maxVisibleNodeCount: 150,
  /**
   * OCSE decisionConfidence floor for "recommended" (HIGH band).
   * Display admit uses visibilityThresholdDisplay (so frontier is not wiped).
   */
  visibilityThreshold: 0.45,
  /** Soft admit for globe Unexplored surface — show more than strict recommend. */
  visibilityThresholdDisplay: 0.18,
  confidenceBands: {
    high: 0.7,
    medium: 0.4
  },
  /**
   * Legacy continuous slider → cumulative max distance.
   * Prefer readinessTiers (below) for product UI.
   */
  projectionWindow: {
    min: 0.0,
    baseMax: 0.2,
    sliderSpan: 0.8,
  },
  /**
   * Product exploration-depth control (single cycle button under globe).
   * Maps to Recommendation Surface buckets + all.
   */
  explorationDepth: {
    close: {
      label: 'Close',
      desc: 'Stay close to territory you already know',
      bucket: 'comfort' as const,
      /** expansionDistance window when surface buckets missing */
      distanceMin: 0,
      distanceMax: 0.34,
    },
    far: {
      label: 'Far',
      desc: 'Open new territory at a steady pace',
      bucket: 'expansion' as const,
      distanceMin: 0.34,
      distanceMax: 0.67,
    },
    farther: {
      label: 'Farther',
      desc: 'Stretch into territory far from home',
      bucket: 'leap' as const,
      distanceMin: 0.67,
      distanceMax: 1.01,
    },
    /** Full map — all depths at once */
    all: {
      label: 'All',
      desc: 'All unexplored territory on the map',
      bucket: null,
      distanceMin: 0,
      distanceMax: 1.01,
    },
  } as const,
  /**
   * Backend readiness buckets (Recommendation Surface). UI depth labels map here.
   */
  readinessTiers: {
    comfort: {
      label: 'Close',
      desc: 'Stay close to territory you already know',
    },
    expansion: {
      label: 'Far',
      desc: 'Open new territory at a steady pace',
    },
    leap: {
      label: 'Farther',
      desc: 'Stretch into territory far from home',
    },
  } as const,
  /**
   * Change E: emphasis when node is / is not in the active surface bucket.
   * Nodes are never removed on tier switch.
   * inactive must stay high enough to read on the light globe (not ghost dots).
   */
  tierEmphasis: {
    active: 1.0,
    /** Out-of-depth frontier is hidden via visible=false; keep low if dimmed. */
    inactive: 0.22,
  },
  /**
   * Legacy depth bands — kept for older snapshots / tests.
   * Product UI uses readinessTiers.
   */
  depthBands: {
    shallow: {
      min: 0.0,
      max: 0.25,
      label: 'Near me',
      desc: 'Artists close to what you already like',
    },
    deeper: {
      min: 0.25,
      max: 0.5,
      label: 'A bit further',
      desc: 'Nearby styles you have not tried',
    },
    deep: {
      min: 0.5,
      max: 0.75,
      label: 'Far out',
      desc: 'Clearly outside your usual listening',
    },
    deepest: {
      min: 0.75,
      max: 1.01,
      label: 'Edge of map',
      desc: 'The farthest ORCA still links to you',
    },
    all: {
      min: 0.0,
      max: 1.01,
      label: 'Everything',
      desc: 'All unexplored artists',
    },
  } as const,
  expansionBands: {
    core: 0.15,
    familiar: 0.3,
    comfortEdge: 0.45,
    expansion: 0.7,
    outerEdge: 1.0
  }
};

export type DepthBandId = keyof typeof WorldConfig.depthBands;
export type ReadinessTierId = keyof typeof WorldConfig.readinessTiers;
export type ExplorationDepthId = keyof typeof WorldConfig.explorationDepth;

/** UI depth → surface bucket (null = all). */
export function explorationDepthToBucket(
  depth: ExplorationDepthId,
): ReadinessTierId | null {
  return WorldConfig.explorationDepth[depth].bucket;
}

/** Recommended readiness tier → default UI depth. */
export function bucketToExplorationDepth(
  bucket: ReadinessTierId | null | undefined,
): ExplorationDepthId {
  if (bucket === 'comfort') return 'close';
  if (bucket === 'leap') return 'farther';
  if (bucket === 'expansion') return 'far';
  return 'far';
}

/** Normalize surface bucket entries (id string or DecisionProfile-like). */
export function normalizeSurfaceIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === 'string' && item.length > 0) out.push(item);
    else if (item && typeof item === 'object') {
      const id =
        (item as { candidateId?: string; id?: string }).candidateId ||
        (item as { id?: string }).id;
      if (typeof id === 'string' && id.length > 0) out.push(id);
    }
  }
  return out;
}

/**
 * Node ids in a depth band.
 * Priority: readinessBucket on nodes → expansionDistance window → surface ids
 * (surface only if it intersects the live node set).
 */
export function nodeIdsForExplorationDepth(
  depth: ExplorationDepthId,
  nodes: Array<{
    id: string;
    expansionDistance?: number;
    readinessBucket?: string;
  }>,
  surface?: {
    comfort: unknown;
    expansion: unknown;
    leap: unknown;
  } | null,
): Set<string> | 'all' {
  if (depth === 'all') return 'all';
  const meta = WorldConfig.explorationDepth[depth];
  const bucket = meta.bucket;
  const nodeIdSet = new Set(nodes.map((n) => n.id));

  // 1) readinessBucket on nodes (set at materialize)
  if (bucket) {
    const byBucket = new Set(
      nodes.filter((n) => n.readinessBucket === bucket).map((n) => n.id),
    );
    if (byBucket.size > 0) return byBucket;
  }

  // 2) expansionDistance exclusive window
  const min = meta.distanceMin;
  const max = meta.distanceMax;
  const byDistance = new Set<string>();
  for (const n of nodes) {
    const d = n.expansionDistance;
    if (d == null || !Number.isFinite(d)) continue;
    if (d >= min && d < max) byDistance.add(n.id);
  }
  if (byDistance.size > 0) return byDistance;

  // 3) surface bucket ids (only those present in current frontier)
  if (bucket && surface) {
    const raw = normalizeSurfaceIds(
      (surface as Record<string, unknown>)[bucket],
    );
    const fromSurface = new Set(raw.filter((id) => nodeIdSet.has(id)));
    if (fromSurface.size > 0) return fromSurface;
  }

  // 4) Soft fill: few nearest to band mid (never the whole set)
  const mid = (min + Math.min(max, 1)) / 2;
  const ranked = [...nodes]
    .filter((n) => n.expansionDistance != null && Number.isFinite(n.expansionDistance))
    .sort(
      (a, b) =>
        Math.abs((a.expansionDistance as number) - mid) -
        Math.abs((b.expansionDistance as number) - mid),
    );
  const fill = new Set<string>();
  const cap = Math.min(8, Math.max(3, Math.ceil(nodes.length * 0.15)));
  for (const n of ranked.slice(0, cap)) fill.add(n.id);
  return fill;
}
