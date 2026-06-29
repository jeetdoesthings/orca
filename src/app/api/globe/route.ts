import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { buildGenreSnapshot, buildArtistSnapshot } from '@/lib/graph/genre-intelligence-builder';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const isDemo = url.searchParams.get('demo') === 'true';

    let userId: string;
    if (isDemo) {
      const demoUser = await prisma.user.findFirst({
        where: { syncStatus: 'COMPLETE' },
        select: { spotifyId: true },
      });
      if (!demoUser) {
        return NextResponse.json({ error: 'No demo data available' }, { status: 404 });
      }
      userId = demoUser.spotifyId!;
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
      }
    });

    if (!dbUser || !dbUser.globeData) {
      return NextResponse.json({ status: 'syncing' });
    }

    const graphData = JSON.parse(dbUser.globeData);
    const nodes = graphData.nodes || [];
    const edges = graphData.edges || [];

    // Retrieve all active and template journeys for Layer 8 Journey Sequencing
    const activeIntervention = await prisma.longitudinalIntervention.findFirst({
      where: { userId, state: 'ACTIVE' },
      orderBy: { createdAt: 'desc' }
    });

    let journeyArtistIds = new Set<string>();
    const journeyRolesMap = new Map<string, string>();
    const journeyNodeIndexes = new Map<string, number>();
    let activeJourneyTargetTerritory = '';
    let activeJourneyDetails: any = null;

    if (activeIntervention) {
      const template = await prisma.globalPathwayTemplate.findFirst({
        where: { targetTerritory: activeIntervention.targetTerritoryId }
      });
      if (template) {
        try {
          const artistIds: string[] = JSON.parse(template.pathwayNodes);
          artistIds.forEach((id, index) => {
            journeyArtistIds.add(id);
            journeyNodeIndexes.set(id, index);
            
            let role: string;
            if (index === 0) role = 'ANCHOR';
            else if (index === artistIds.length - 1) role = 'DESTINATION';
            else if (index === 1 && artistIds.length > 3) role = 'BRIDGE';
            else role = 'INTERMEDIATE';

            journeyRolesMap.set(id, role);
          });
          activeJourneyTargetTerritory = activeIntervention.targetTerritoryId;

          // Build Journey Snapshot
          activeJourneyDetails = {
            active: true,
            id: activeIntervention.id,
            title: `Journey to ${activeIntervention.targetTerritoryId}`,
            targetTerritory: activeIntervention.targetTerritoryId,
            currentStep: 2,
            totalSteps: artistIds.length,
            progressPercent: Math.round((2 / artistIds.length) * 100),
            steps: artistIds.map((id, idx) => ({
              position: idx + 1,
              artistId: id,
              artistName: id, // resolved client-side or fallback
              imageUrl: null,
              role: journeyRolesMap.get(id) || 'INTERMEDIATE',
              status: idx === 0 ? 'completed' : idx === 1 ? 'current' : 'upcoming'
            }))
          };
        } catch {}
      }
    }

    if (!activeJourneyDetails) {
      activeJourneyDetails = {
        active: false,
        id: null,
        title: null,
        targetTerritory: null,
        currentStep: null,
        totalSteps: null,
        progressPercent: 0,
        steps: null
      };
    }

    // Pre-query database layers to build snapshot context
    const [
      relationships,
      affinities,
      familiarities,
      adoptions,
      memories,
      recentExplored,
      memberships,
      bridges
    ] = await Promise.all([
      prisma.userTerritoryRelationship.findMany({ where: { userId } }),
      prisma.userTerritoryAffinity.findMany({ where: { userId } }),
      prisma.territoryFamiliarity.findMany({ where: { userId } }),
      prisma.territoryAdoption.findMany({ where: { userId } }),
      prisma.userArtistMemory.findMany({ where: { userId } }),
      prisma.exploredArtist.findMany({
        where: { userId, exploredAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
        select: { artistId: true }
      }),
      prisma.territoryMembership.findMany({
        where: { artistId: { in: nodes.map((n: any) => n.id) } }
      }),
      prisma.territoryBridge.findMany({
        where: { artistId: { in: nodes.map((n: any) => n.id) } }
      })
    ]);

    const recentExploredIds = new Set(recentExplored.map(e => e.artistId));
    const artistTerritoryMap = new Map(memberships.map(m => [m.artistId, m]));
    const bridgeArtistIds = new Set(bridges.map(b => b.artistId));

    // Map raw Spotify genres to Territory IDs
    const genreToTerritoryCount = new Map<string, Map<string, number>>();
    nodes.forEach((node: any) => {
      const primaryGenre = node.genres?.[0]?.toLowerCase();
      if (!primaryGenre) return;

      const mem = artistTerritoryMap.get(node.id);
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
      activeIntervention,
      journeyArtistIds,
      journeyRolesMap,
      journeyNodeIndexes,
      activeJourneyTargetTerritory,
      genreToTerritoryMap,
    };

    // 1. Build Artist Snapshots
    const enrichedNodes = nodes.map((node: any) => buildArtistSnapshot(node, ctx));

    // 2. Build Edge Snapshots (adding isJourneyEdge properties and checking bounds)
    const enrichedEdges = edges.map((edge: any) => {
      const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
      const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;

      const sourceNode = enrichedNodes.find((n: any) => n.id === sourceId);
      const targetNode = enrichedNodes.find((n: any) => n.id === targetId);
      const isBridgeEdge = sourceNode && targetNode && sourceNode.territory !== targetNode.territory;

      let isJourneyEdge = false;
      if (journeyArtistIds.has(sourceId) && journeyArtistIds.has(targetId)) {
        const idxA = journeyNodeIndexes.get(sourceId) ?? -1;
        const idxB = journeyNodeIndexes.get(targetId) ?? -1;
        if (Math.abs(idxA - idxB) === 1) {
          isJourneyEdge = true;
        }
      }

      return {
        source: sourceId,
        target: targetId,
        sourceId,
        targetId,
        similarity: edge.similarity ?? 0.5,
        isBridgeEdge: !!isBridgeEdge,
        isJourneyEdge
      };
    });

    // 3. Build Genre Snapshots (GIS)
    const rawGenresList = Array.from(new Set(nodes.flatMap((n: any) => n.genres || []).map((g: string) => g.toLowerCase()))) as string[];
    const enrichedGenres = rawGenresList.map((genre: string) => {
      const genreArtists = enrichedNodes.filter((n: any) => n.genres?.map((g: string) => g.toLowerCase()).includes(genre));
      return buildGenreSnapshot(genre, genreArtists, ctx);
    });

    let userPosition = {
      primaryTerritoryId: 'Territory_v2_001',
      lat: 0,
      lng: 0
    };

    if (dbUser.homeRegion) {
      try {
        const home = JSON.parse(dbUser.homeRegion);
        userPosition = {
          primaryTerritoryId: home.territoryId || 'Territory_v2_001',
          lat: home.lat ?? 0,
          lng: home.lng ?? 0
        };
      } catch {}
    }

    const response = NextResponse.json({
      status: 'ready',
      nodes: enrichedNodes,
      edges: enrichedEdges,
      genres: enrichedGenres,
      journey: activeJourneyDetails,
      userPosition,
      homeRegion: {
        lat: userPosition.lat,
        lng: userPosition.lng,
        spread: 1.0,
        territoryId: userPosition.primaryTerritoryId
      }
    });

    response.headers.set('Cache-Control', 'private, max-age=60');
    return response;

  } catch (error: any) {
    console.error('[/api/globe] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
