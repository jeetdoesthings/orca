import { prisma } from '@/lib/prisma';
import type { OrcaNode } from '@/lib/graph/types';
import type { RecommendationSurface } from '@/lib/ocse/ocse-types';
import type { ReadinessState } from '@/lib/readiness/readiness-types';

/**
 * Versioned world snapshot metadata + last frontier nodes.
 *
 * Persistence: User.worldStateData (JSON meta) + User.frontierData (nodes).
 * The filesystem store (world-state-*.json) has been removed — multi-instance safe.
 */
export interface WorldState {
  candidateUniverseVersion: number;
  ocseEvaluationVersion: number;
  snapshotVersion: number;
  lastGeneratedAt: string;
  visibleNodeIds: string[];
  lastNodes: OrcaNode[];
  delta?: {
    added: string[];
    removed: string[];
    changed: string[];
  };
  /** Change C: full surface for instant tier switches (no CUB re-query). */
  recommendationSurface?: RecommendationSurface | null;
  /** Change B/F: session readiness default. */
  readinessState?: ReadinessState | null;
  /** Leap-seek rotation history (territories targeted recently). */
  leapSeekHistory?: { territoryIds: string[]; materializeCount: number } | null;
  /** Component 2: leap bucket used near-pool widen. */
  leapBucketFallback?: boolean;
  /** Shore empty after shore-seek. */
  shoreBucketFallback?: boolean;
  /** Distance variance too compressed. */
  distanceVarianceCollapsed?: boolean;
}

interface WorldStateMeta {
  candidateUniverseVersion: number;
  ocseEvaluationVersion: number;
  snapshotVersion: number;
  lastGeneratedAt: string;
  visibleNodeIds: string[];
  delta?: WorldState['delta'];
  recommendationSurface?: RecommendationSurface | null;
  readinessState?: ReadinessState | null;
  leapSeekHistory?: { territoryIds: string[]; materializeCount: number } | null;
  leapBucketFallback?: boolean;
  shoreBucketFallback?: boolean;
  distanceVarianceCollapsed?: boolean;
}

function emptyMeta(): WorldStateMeta {
  return {
    candidateUniverseVersion: 0,
    ocseEvaluationVersion: 0,
    snapshotVersion: 0,
    lastGeneratedAt: new Date(0).toISOString(),
    visibleNodeIds: [],
    recommendationSurface: null,
    readinessState: null,
    leapSeekHistory: null,
    leapBucketFallback: false,
    shoreBucketFallback: false,
    distanceVarianceCollapsed: false,
  };
}

function parseMeta(raw: string | null | undefined): WorldStateMeta {
  if (!raw) return emptyMeta();
  try {
    const parsed = JSON.parse(raw) as Partial<WorldStateMeta>;
    return {
      candidateUniverseVersion: parsed.candidateUniverseVersion ?? 0,
      ocseEvaluationVersion: parsed.ocseEvaluationVersion ?? 0,
      snapshotVersion: parsed.snapshotVersion ?? 0,
      lastGeneratedAt: parsed.lastGeneratedAt ?? new Date(0).toISOString(),
      visibleNodeIds: Array.isArray(parsed.visibleNodeIds) ? parsed.visibleNodeIds : [],
      delta: parsed.delta,
      recommendationSurface: parsed.recommendationSurface ?? null,
      readinessState: parsed.readinessState ?? null,
      leapSeekHistory: parsed.leapSeekHistory ?? null,
      leapBucketFallback: parsed.leapBucketFallback ?? false,
      shoreBucketFallback: parsed.shoreBucketFallback ?? false,
      distanceVarianceCollapsed: parsed.distanceVarianceCollapsed ?? false,
    };
  } catch (err) {
    console.error('[WorldStateStore] Failed to parse worldStateData:', err);
    return emptyMeta();
  }
}

function parseNodes(raw: string | null | undefined): OrcaNode[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OrcaNode[]) : [];
  } catch (err) {
    console.error('[WorldStateStore] Failed to parse frontierData:', err);
    return [];
  }
}

/**
 * Read the user's world snapshot from the database.
 * @param userId Spotify user id (domain key used across frontier tables)
 */
export async function readWorldState(userId: string): Promise<WorldState> {
  const user = await prisma.user.findUnique({
    where: { spotifyId: userId },
    select: { worldStateData: true, frontierData: true },
  });

  const meta = parseMeta(user?.worldStateData);
  const lastNodes = parseNodes(user?.frontierData);

  return {
    ...meta,
    lastNodes,
  };
}

/**
 * Persist world snapshot metadata (and optionally keep frontierData in sync
 * via the caller). Does not write lastNodes — materializer writes frontierData.
 */
export async function writeWorldState(userId: string, state: WorldState): Promise<void> {
  const meta: WorldStateMeta = {
    candidateUniverseVersion: state.candidateUniverseVersion,
    ocseEvaluationVersion: state.ocseEvaluationVersion,
    snapshotVersion: state.snapshotVersion,
    lastGeneratedAt: state.lastGeneratedAt,
    visibleNodeIds: state.visibleNodeIds,
    delta: state.delta,
    recommendationSurface: state.recommendationSurface ?? null,
    readinessState: state.readinessState ?? null,
    leapSeekHistory: state.leapSeekHistory ?? null,
    leapBucketFallback: state.leapBucketFallback ?? false,
    shoreBucketFallback: state.shoreBucketFallback ?? false,
    distanceVarianceCollapsed: state.distanceVarianceCollapsed ?? false,
  };

  await prisma.user.update({
    where: { spotifyId: userId },
    data: {
      worldStateData: JSON.stringify(meta),
    },
  });
}
