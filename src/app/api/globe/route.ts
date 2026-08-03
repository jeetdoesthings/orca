import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { buildGenreSnapshot, buildArtistSnapshot } from '@/lib/graph/genre-intelligence-builder';
import { readWorldState } from '@/lib/frontier/world-state-store';
import {
  projectWorld,
  buildUnexploredByTerritory,
} from '@/lib/frontier/world-projection';
import type { DepthBandId } from '@/lib/config/world';
import { parseRequestRuntimeConfig } from '@/lib/config/request-runtime';
import { assessUserColdStart } from '@/lib/identity/cold-start';
import { resolveDemoUser } from '@/lib/auth/demo-user';

/**
 * Canonical GET — pure projection of the user's already-materialized world.
 * Does NOT rebuild the frontier or mutate process.env.
 * Explicit rebuild: POST /api/world/regenerate (or integrate/ignore/explore paths).
 */
export async function GET(request: NextRequest) {
  // Request-scoped config only — never mutates process.env (RULE-8).
  // regenerate=true on GET is ignored (logged); clients must POST to regenerate.
  const runtimeConfig = parseRequestRuntimeConfig(request);
  if (runtimeConfig.regenerate) {
    console.warn(
      '[/api/globe] regenerate requested on GET — ignored. Use POST /api/world/regenerate.',
    );
  }

  try {
    const url = new URL(request.url);
    const isDemo = url.searchParams.get('demo') === 'true';

    let userId: string;
    if (isDemo) {
      const demoId = await resolveDemoUser();
      if (!demoId) {
        return NextResponse.json({ error: 'No demo data available' }, { status: 404 });
      }
      userId = demoId;
    } else {
      const session = await getServerSession(authOptions);
      if (!session || !session.user || !(session as any).user.spotifyId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      userId = (session as any).user.spotifyId;
    }

    const dbUser = await prisma.user.findUnique({
      where: { spotifyId: userId },
      select: {
        globeData: true,
        homeRegion: true,
        profileData: true,
        frontierStatus: true,
      },
    });

    if (!dbUser || !dbUser.globeData) {
      return NextResponse.json({ status: 'syncing' });
    }

    let graphData;
    try {
      graphData = JSON.parse(dbUser.globeData);
    } catch {
      console.error('[/api/globe] Corrupt globeData for user', userId);
      return NextResponse.json({ error: 'Corrupt globe data' }, { status: 500 });
    }
    const nodes = graphData.nodes || [];
    const edges = graphData.edges || [];
    const exploredNodeIds = nodes
      .filter((n: { id: string; state?: string }) => n.state !== 'frontier')
      .map((n: { id: string }) => n.id);

    const [
      relationships,
      affinities,
      familiarities,
      adoptions,
      memories,
      recentExplored,
      memberships,
      bridges,
    ] = await Promise.all([
      prisma.userTerritoryRelationship.findMany({ where: { userId } }),
      prisma.userTerritoryAffinity.findMany({ where: { userId } }),
      prisma.territoryFamiliarity.findMany({ where: { userId } }),
      prisma.territoryAdoption.findMany({ where: { userId } }),
      prisma.userArtistMemory.findMany({
        where: { userId },
        select: {
          artistId: true,
          memoryStrength: true,
          memoryState: true,
          persistence: true,
        },
      }),
      prisma.exploredArtist.findMany({
        where: {
          userId,
          exploredAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
        select: { artistId: true },
      }),
      prisma.territoryMembership.findMany({
        where: { artistId: { in: exploredNodeIds } },
      }),
      prisma.territoryBridge.findMany({
        where: { artistId: { in: exploredNodeIds } },
      }),
    ]);

    const recentExploredIds = new Set<string>(recentExplored.map((e: any) => e.artistId));
    const artistTerritoryMap = new Map<string, any>(memberships.map((m: any) => [m.artistId, m]));
    const bridgeArtistIds = new Set<string>(bridges.map((b: any) => b.artistId));

    const genreToTerritoryCount = new Map<string, Map<string, number>>();
    nodes.forEach((node: { id: string; genres?: string[] }) => {
      const primaryGenre = node.genres?.[0]?.toLowerCase();
      if (!primaryGenre) return;
      const mem = artistTerritoryMap.get(node.id) as { territoryId: string } | undefined;
      if (!mem) return;
      if (!genreToTerritoryCount.has(primaryGenre)) {
        genreToTerritoryCount.set(primaryGenre, new Map());
      }
      const counts = genreToTerritoryCount.get(primaryGenre)!;
      counts.set(mem.territoryId, (counts.get(mem.territoryId) || 0) + 1);
    });

    const genreToTerritoryMap = new Map<string, string>();
    genreToTerritoryCount.forEach((counts, genre) => {
      let maxCount = -1;
      let bestTerritory = '';
      counts.forEach((count, territoryId) => {
        if (count > maxCount) {
          maxCount = count;
          bestTerritory = territoryId;
        }
      });
      if (bestTerritory) {
        genreToTerritoryMap.set(genre, bestTerritory);
      }
    });

    const ctx = {
      userId,
      relationships,
      affinities,
      familiarities,
      adoptions,
      memories,
      recentExploredIds,
      artistTerritoryMap,
      bridgeArtistIds,
      activeIntervention: null as null,
      genreToTerritoryMap,
    };

    const enrichedNodes = nodes.map((node: unknown) => buildArtistSnapshot(node, ctx));
    const enrichedNodeById = new Map<string, any>(
      enrichedNodes.map((node: { id: string }) => [node.id, node]),
    );

    const enrichedEdges = edges.map((edge: {
      source: string | { id: string };
      target: string | { id: string };
      similarity?: number;
    }) => {
      const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
      const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
      const sourceNode = enrichedNodeById.get(sourceId);
      const targetNode = enrichedNodeById.get(targetId);
      const isBridgeEdge =
        sourceNode && targetNode && sourceNode.territory !== targetNode.territory;

      return {
        source: sourceId,
        target: targetId,
        sourceId,
        targetId,
        similarity: edge.similarity ?? 0.5,
        isBridgeEdge: !!isBridgeEdge,
      };
    });

    const rawGenresList = Array.from(
      new Set(
        nodes
          .flatMap((n: { genres?: string[] }) => n.genres || [])
          .map((g: string) => g.toLowerCase()),
      ),
    ) as string[];
    const artistsByGenre = new Map<string, any[]>();
    enrichedNodes.forEach((node: { genres?: string[] }) => {
      node.genres?.forEach((g: string) => {
        const genre = g.toLowerCase();
        const artists = artistsByGenre.get(genre);
        if (artists) {
          artists.push(node);
        } else {
          artistsByGenre.set(genre, [node]);
        }
      });
    });
    const enrichedGenres = rawGenresList.map((genre: string) =>
      buildGenreSnapshot(genre, artistsByGenre.get(genre) || [], ctx),
    );

    let userPosition = {
      primaryTerritoryId: 'Territory_v2_001',
      lat: 0,
      lng: 0,
    };

    if (dbUser.homeRegion) {
      try {
        const home = JSON.parse(dbUser.homeRegion);
        userPosition = {
          primaryTerritoryId: home.territoryId || 'Territory_v2_001',
          lat: home.lat ?? 0,
          lng: home.lng ?? 0,
        };
      } catch {
        /* keep defaults */
      }
    }

    const dominantGenres = enrichedGenres
      .filter((g: { relationship?: { current?: string }; name: string }) => g.relationship?.current === 'RESIDENT')
      .map((g: { name: string }) => g.name);
    const emergingGenres = enrichedGenres
      .filter(
        (g: { relationship?: { current?: string } }) =>
          g.relationship?.current === 'CURIOUS' || g.relationship?.current === 'EXPLORING',
      )
      .map((g: { name: string }) => g.name);
    const untouchedGenres = enrichedGenres
      .filter((g: { relationship?: { current?: string } }) => g.relationship?.current === 'UNEXPLORED')
      .map((g: { name: string }) => g.name);
    const genreDiversity = Math.min(1.0, Math.round((enrichedGenres.length / 25) * 100) / 100);
    const comfortBias =
      enrichedGenres.length > 0
        ? Math.round((dominantGenres.length / enrichedGenres.length) * 100) / 100
        : 0.5;
    const expansionLevel = Math.round((1 - comfortBias) * 100) / 100;
    const expansionMetadata = {
      expansionLevel,
      comfortBias,
      genreDiversity,
      dominantGenres,
      emergingGenres,
      untouchedGenres,
    };

    // Pure read of DB-backed world state — never regenerates on GET.
    const worldState = await readWorldState(userId);
      const clientVersion = parseInt(url.searchParams.get('version') || '-1', 10);
      if (
        worldState.snapshotVersion > 0 &&
        clientVersion === worldState.snapshotVersion
      ) {
        const response = NextResponse.json({
          status: 'ready',
          upToDate: true,
          snapshotVersion: worldState.snapshotVersion,
        });
        response.headers.set('Cache-Control', 'private, max-age=10');
        return response;
      }

      const candidateNodes = worldState.lastNodes || [];
      // No frontier yet: return explored-only world with pending_frontier hint
      // so the client can trigger POST /api/world/regenerate if desired.
      const cold = await assessUserColdStart(userId);

      if (worldState.snapshotVersion === 0 && candidateNodes.length === 0) {
        const response = NextResponse.json({
          status: 'ready',
          frontierStatus: dbUser.frontierStatus,
          snapshotVersion: 0,
          needsMaterialization: true,
          coldStart: cold.coldStart,
          coldStartReason: cold.reason,
          ...(cold.coldStart ? { message: 'still learning your taste' } : {}),
          nodes: enrichedNodes,
          edges: enrichedEdges,
          genres: enrichedGenres,
          expansionMetadata,
          userPosition,
          homeRegion: {
            lat: userPosition.lat,
            lng: userPosition.lng,
            spread: 1.0,
            territoryId: userPosition.primaryTerritoryId,
          },
        });
        response.headers.set('Cache-Control', 'private, max-age=30');
        return response;
      }

      const combinedNodes = [...enrichedNodes, ...candidateNodes];
      const combinedNodeIds = new Set(combinedNodes.map((n: { id: string }) => n.id));
      const filteredEdges = enrichedEdges.filter(
        (edge: { sourceId: string; targetId: string }) =>
          combinedNodeIds.has(edge.sourceId) && combinedNodeIds.has(edge.targetId),
      );

      const tierParam = url.searchParams.get('tier');
      const depthParam = url.searchParams.get('depth') as DepthBandId | null;
      const sliderValue = parseFloat(url.searchParams.get('slider') || '0.5');
      const recommended =
        worldState.readinessState?.recommendedTier ?? 'expansion';
      const readinessTier =
        tierParam && ['comfort', 'expansion', 'leap'].includes(tierParam)
          ? (tierParam as 'comfort' | 'expansion' | 'leap')
          : recommended;

      // Prefer readiness tier projection (Change D/E); fall back to legacy depth/slider
      const projectionMode: number | DepthBandId | 'comfort' | 'expansion' | 'leap' =
        tierParam || worldState.readinessState
          ? readinessTier
          : depthParam &&
              ['shallow', 'deeper', 'deep', 'deepest', 'all'].includes(depthParam)
            ? depthParam
            : sliderValue;

      const surface = worldState.recommendationSurface;
      const bucketIds =
        surface && typeof projectionMode === 'string' &&
        ['comfort', 'expansion', 'leap'].includes(projectionMode)
          ? new Set(
              (surface[projectionMode as 'comfort' | 'expansion' | 'leap'] ?? []).map(
                (p: { candidateId: string }) => p.candidateId,
              ),
            )
          : undefined;

      let projection = projectWorld(combinedNodes, filteredEdges, projectionMode as any);
      // Re-apply with explicit bucket ids when surface present
      if (bucketIds && typeof projectionMode === 'string' && ['comfort', 'expansion', 'leap'].includes(projectionMode)) {
        const { applyTierEmphasis } = await import('@/lib/frontier/world-projection');
        projection = {
          ...projection,
          nodes: applyTierEmphasis(
            projection.nodes,
            projectionMode as 'comfort' | 'expansion' | 'leap',
            bucketIds,
          ),
        };
      }

      // Precomputed unexplored-by-territory from materialised frontier (before depth filter)
      const unexploredByTerritory = buildUnexploredByTerritory(
        candidateNodes.map((n) => ({
          ...n,
          state: n.state || ('frontier' as const),
        })),
      );

      const response = NextResponse.json({
        status: 'ready',
        snapshotVersion: worldState.snapshotVersion,
        candidateUniverseVersion: worldState.candidateUniverseVersion,
        ocseVersion: worldState.ocseEvaluationVersion,
        generatedAt: worldState.lastGeneratedAt,
        worldDeltaId: `delta_${worldState.snapshotVersion}`,
        upToDate: false,
        worldDelta: worldState.delta || { added: [], removed: [], changed: [] },
        coldStart: cold.coldStart,
        coldStartReason: cold.reason,
        ...(cold.coldStart ? { message: 'still learning your taste' } : {}),
        nodes: projection.nodes,
        edges: projection.edges,
        genres: enrichedGenres,
        expansionMetadata,
        projectionStats: projection.stats,
        unexploredByTerritory,
        readinessState: worldState.readinessState ?? null,
        recommendedTier: recommended,
        activeTier: readinessTier,
        leapBucketFallback:
          worldState.leapBucketFallback ??
          surface?.leapBucketFallback ??
          false,
        shoreBucketFallback:
          worldState.shoreBucketFallback ??
          surface?.shoreBucketFallback ??
          false,
        distanceVarianceCollapsed:
          worldState.distanceVarianceCollapsed ??
          surface?.distanceVarianceCollapsed ??
          false,
        recommendationSurface: surface
          ? {
              comfort: surface.comfort.map((p) => p.candidateId),
              expansion: surface.expansion.map((p) => p.candidateId),
              leap: surface.leap.map((p) => p.candidateId),
              readiness: surface.readiness,
              generatedAt: surface.generatedAt,
              leapBucketFallback: surface.leapBucketFallback ?? false,
              leapSeekInLeapCount: surface.leapSeekInLeapCount ?? 0,
              shoreBucketFallback: surface.shoreBucketFallback ?? false,
              distanceVarianceCollapsed:
                surface.distanceVarianceCollapsed ?? false,
              shoreSeekInShoreCount: surface.shoreSeekInShoreCount ?? 0,
            }
          : null,
        depthBand: typeof projectionMode === 'string' ? projectionMode : undefined,
        userPosition,
        homeRegion: {
          lat: userPosition.lat,
          lng: userPosition.lng,
          spread: 1.0,
          territoryId: userPosition.primaryTerritoryId,
        },
      });
      return response;
  } catch (error: unknown) {
    console.error('[/api/globe] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
