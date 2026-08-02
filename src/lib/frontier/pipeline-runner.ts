/**
 * Single materialization path for the ORCA world.
 *
 * Every caller that needs a fresh frontier / world snapshot goes through
 * `materializeWorld`. Options control optional post-steps; write semantics
 * for frontierData + worldStateData are always identical.
 */

import { prisma } from '@/lib/prisma';
import type { OrcaNode } from '@/lib/graph/types';
import { buildFrontierNodes } from './buildFrontierNodes';
import { computeGenrePerimeter } from './genrePerimeter';
import { computeAdventurousness } from '../metrics/adventurousness';
import type { AdventurousnessMetric } from '../metrics/adventurousness';
import { computeUserProfile } from '../profile/profile-engine';
import { computeDiscoveryProfile } from '../profile/discovery-readiness';
import { generateExplanations } from '../profile/explainer';
import type { UserProfile } from '../profile/types';
import { computeUserTerritoryMapping } from '../profile/territory-mapping';
import { readWorldState, type WorldState } from './world-state-store';
import { computeWorldDelta } from './world-delta';
import { filterHallucinatedNodes } from './anti-hallucination';

const GLOBE_BIOMES = [
  'hip-hop', 'trap', 'drill', 'edm', 'house', 'techno', 'trance',
  'drum-and-bass', 'pop', 'dance-pop', 'rock', 'alternative-rock',
  'indie-rock', 'punk', 'metal', 'rnb', 'soul', 'funk', 'folk',
  'country', 'ambient', 'classical', 'jazz', 'latin', 'world-music',
];

export interface MaterializeWorldOptions {
  /** Pre-loaded explored nodes; if omitted, loaded from User.globeData. */
  exploredNodes?: OrcaNode[];
  /** Spotify access token (empty string forces retrieval fallbacks). */
  accessToken?: string;
  /** OCSE slider context (default 0.5). Legacy — prefer explicitTier. */
  sliderValue?: number;
  /** Change B/D: session tier override into Readiness Model. */
  explicitTier?: 'comfort' | 'expansion' | 'leap' | null;
  /**
   * When true (default), also recompute perimeter, adventurousness, profile
   * patch/full, and territory chain. Feedback-driven rebuilds want this on.
   */
  fullMaterialization?: boolean;
}

export interface MaterializeWorldResult {
  frontierNodes: OrcaNode[];
  worldState: WorldState;
}

/**
 * Canonical world materializer.
 * Marks frontierStatus, builds frontier, poison-filters, bumps world versions,
 * writes frontierData + worldStateData, optionally runs profile/territory.
 */
export async function materializeWorld(
  userId: string,
  options: MaterializeWorldOptions = {},
): Promise<MaterializeWorldResult> {
  const full = options.fullMaterialization !== false;
  const sliderValue = options.sliderValue ?? 0.5;

  await prisma.user.update({
    where: { spotifyId: userId },
    data: { frontierStatus: 'COMPUTING' },
  });

  try {
    console.log(`[PipelineRunner] Materializing world for user ${userId} (full=${full})...`);

    // ── Resolve explored nodes + token ──
    let exploredNodes = options.exploredNodes;
    let accessToken = options.accessToken;

    if (!exploredNodes || accessToken === undefined) {
      const user = await prisma.user.findUnique({
        where: { spotifyId: userId },
        select: { id: true, globeData: true },
      });
      if (!user) {
        throw new Error(`User not found: ${userId}`);
      }
      if (!exploredNodes) {
        exploredNodes = [];
        if (user.globeData) {
          try {
            exploredNodes = JSON.parse(user.globeData).nodes || [];
          } catch (e) {
            console.error('[PipelineRunner] Error parsing globeData:', e);
          }
        }
      }
      if (accessToken === undefined) {
        const account = await prisma.account.findFirst({
          where: { userId: user.id, provider: 'spotify' },
          select: { access_token: true },
        });
        accessToken = account?.access_token || '';
      }
    }

    // ── Build frontier (typed result — no process globals) ──
    const built = await buildFrontierNodes(
      exploredNodes || [],
      accessToken || '',
      userId,
      { sliderValue, explicitTier: options.explicitTier ?? null },
    );
    let frontierNodes = built.nodes;
    const surface = built.surface;
    const leapSeekMeta = built.leapSeekMeta;

    // Anti-hallucination gate (§3.6): structural id/name/genre + catalog grounding.
    const hallu = await filterHallucinatedNodes(frontierNodes);
    if (hallu.rejected.length > 0) {
      console.warn(
        `[PipelineRunner] Anti-hallucination: dropped ${hallu.rejected.length} of ` +
          `${frontierNodes.length} candidates for ${userId}`,
        hallu.rejected.slice(0, 8).map((r) => `${r.id}:${r.reasons.join('+')}`),
      );
    }
    frontierNodes = hallu.accepted;

    const previous = await readWorldState(userId);
    const prevHist = previous.leapSeekHistory?.territoryIds ?? [];
    const newTargets = leapSeekMeta.targetedTerritories ?? [];
    const mergedHist = [...newTargets, ...prevHist]
      .filter((t, i, a) => a.indexOf(t) === i)
      .slice(0, 12);

    // ── World snapshot versions + delta ──
    const delta = computeWorldDelta(previous.lastNodes || [], frontierNodes);
    const worldState: WorldState = {
      candidateUniverseVersion: previous.candidateUniverseVersion + 1,
      ocseEvaluationVersion: previous.ocseEvaluationVersion + 1,
      snapshotVersion: previous.snapshotVersion + 1,
      lastGeneratedAt: new Date().toISOString(),
      visibleNodeIds: frontierNodes.map((n) => n.id),
      lastNodes: frontierNodes,
      delta,
      recommendationSurface: surface,
      readinessState: built.readiness ?? surface?.readiness ?? null,
      leapSeekHistory: {
        territoryIds: mergedHist,
        materializeCount: (previous.leapSeekHistory?.materializeCount ?? 0) + 1,
      },
      leapBucketFallback: surface?.leapBucketFallback ?? false,
      shoreBucketFallback: surface?.shoreBucketFallback ?? false,
      distanceVarianceCollapsed: surface?.distanceVarianceCollapsed ?? false,
    };

    // ── Optional: perimeter + adventurousness ──
    let perimeterJson: string | undefined;
    let adventurousnessJson: string | undefined;

    if (full) {
      const perimeters = GLOBE_BIOMES.map((genre) => {
        const points = computeGenrePerimeter(exploredNodes!, genre);
        if (points && points.length >= 3) {
          return { genre, points, color: getGenreColorHex(genre) };
        }
        return null;
      }).filter(Boolean);

      const user = await prisma.user.findUnique({
        where: { spotifyId: userId },
        select: { adventurousnessHistory: true },
      });

      let history: AdventurousnessMetric[] = [];
      if (user?.adventurousnessHistory) {
        try {
          history = JSON.parse(user.adventurousnessHistory);
        } catch {
          history = [];
        }
      }

      const currentMetric = computeAdventurousness(exploredNodes!, frontierNodes, history);
      history.push(currentMetric);
      if (history.length > 50) {
        history = history.slice(history.length - 50);
      }

      perimeterJson = JSON.stringify(perimeters);
      adventurousnessJson = JSON.stringify(history);
    }

    // ── Single write of frontier + status + optional metrics + world meta ──
    await prisma.user.update({
      where: { spotifyId: userId },
      data: {
        frontierData: JSON.stringify(frontierNodes),
        frontierStatus: 'COMPLETE',
        frontierComputedAt: new Date(),
        worldStateData: JSON.stringify({
          candidateUniverseVersion: worldState.candidateUniverseVersion,
          ocseEvaluationVersion: worldState.ocseEvaluationVersion,
          snapshotVersion: worldState.snapshotVersion,
          lastGeneratedAt: worldState.lastGeneratedAt,
          visibleNodeIds: worldState.visibleNodeIds,
          delta: worldState.delta,
          recommendationSurface: worldState.recommendationSurface ?? null,
          readinessState: worldState.readinessState ?? null,
          leapSeekHistory: worldState.leapSeekHistory ?? null,
          leapBucketFallback: worldState.leapBucketFallback ?? false,
          shoreBucketFallback: worldState.shoreBucketFallback ?? false,
          distanceVarianceCollapsed: worldState.distanceVarianceCollapsed ?? false,
        }),
        ...(perimeterJson !== undefined ? { perimeterData: perimeterJson } : {}),
        ...(adventurousnessJson !== undefined
          ? { adventurousnessHistory: adventurousnessJson }
          : {}),
      },
    });

    // ── Optional: profile + territory chain ──
    if (full) {
      await updateProfileAfterFrontier(userId, frontierNodes);
    }

    console.log(
      `[PipelineRunner] Done for ${userId}. Snapshot v${worldState.snapshotVersion} ` +
        `(+${delta.added.length} -${delta.removed.length} ~${delta.changed.length})`,
    );

    return { frontierNodes, worldState };
  } catch (error) {
    console.error(`[PipelineRunner] Failed for user ${userId}:`, error);
    await prisma.user.update({
      where: { spotifyId: userId },
      data: { frontierStatus: 'FAILED' },
    });
    throw error;
  }
}

async function updateProfileAfterFrontier(
  userId: string,
  frontierNodes: OrcaNode[],
): Promise<void> {
  try {
    const userRecord = await prisma.user.findUnique({
      where: { spotifyId: userId },
      select: { profileData: true, globeData: true, lastSyncAt: true },
    });

    if (!userRecord?.profileData) return;

    let exploredNodes: OrcaNode[] = [];
    if (userRecord.globeData) {
      exploredNodes = JSON.parse(userRecord.globeData).nodes || [];
    }

    const currentProfile: UserProfile = JSON.parse(userRecord.profileData);

    const isPostSyncPatch =
      userRecord.lastSyncAt &&
      Math.abs(
        new Date(userRecord.lastSyncAt).getTime() -
          new Date(currentProfile.updatedAt).getTime(),
      ) <
        10 * 60 * 1000;

    if (isPostSyncPatch) {
      const updatedDiscovery = computeDiscoveryProfile(
        exploredNodes,
        frontierNodes.length,
        currentProfile.discoveryProfile,
      );
      const updatedExplanations = generateExplanations(
        currentProfile.sonicProfile,
        currentProfile.traitProfile,
        updatedDiscovery,
        currentProfile.trajectoryProfile,
        currentProfile.confidenceProfile,
      );

      currentProfile.discoveryProfile = updatedDiscovery;
      currentProfile.explanations = updatedExplanations;
      currentProfile.updatedAt = new Date().toISOString();

      await prisma.user.update({
        where: { spotifyId: userId },
        data: {
          profileData: JSON.stringify(currentProfile),
          profileComputedAt: new Date(),
        },
      });
    } else {
      const updatedProfile = computeUserProfile(
        userId,
        exploredNodes,
        frontierNodes.length,
        currentProfile,
      );
      await prisma.user.update({
        where: { spotifyId: userId },
        data: {
          profileData: JSON.stringify(updatedProfile),
          profileComputedAt: new Date(),
          profileVersion: updatedProfile.version,
        },
      });
    }

    try {
      console.log(`[PipelineRunner] Computing territory mapping for ${userId}...`);
      await computeUserTerritoryMapping(userId);
    } catch (territoryErr) {
      console.error(
        `[PipelineRunner] Territory mapping failed:`,
        territoryErr instanceof Error ? territoryErr.message : String(territoryErr),
      );
    }
  } catch (profileErr) {
    console.error(
      `[PipelineRunner] Profile update failed for ${userId}:`,
      profileErr,
    );
  }
}

function getGenreColorHex(genre: string): string {
  const colors: Record<string, string> = {
    'hip-hop': '#C95C8A',
    trap: '#D46B8A',
    drill: '#A85C6B',
    edm: '#6BC7D9',
    house: '#5FB5D4',
    techno: '#8B9FD4',
    trance: '#5FC4C4',
    'drum-and-bass': '#3EAEB1',
    pop: '#B7A8D6',
    'dance-pop': '#D4A8D6',
    rock: '#D17A5C',
    'alternative-rock': '#E88C74',
    'indie-rock': '#7FAFCF',
    punk: '#D45F5F',
    metal: '#8E4A57',
    rnb: '#B97BBF',
    soul: '#9E67A5',
    funk: '#7851A9',
    folk: '#91A78B',
    country: '#C4A86B',
    ambient: '#A89BEF',
    classical: '#D8BE72',
    jazz: '#D99A6C',
    latin: '#E8766A',
    'world-music': '#C9A85F',
  };
  return colors[genre] || '#B7A8D6';
}

export { readWorldState };
