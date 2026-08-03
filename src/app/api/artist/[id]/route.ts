import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { resolveDemoUser } from '@/lib/auth/demo-user';

function getTerritoryDisplayName(metadata: string | null, fallbackId: string): string {
  if (!metadata) return fallbackId;
  try {
    return JSON.parse(metadata).displayName || fallbackId;
  } catch {
    return fallbackId;
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    const { id } = await params;
    
    const artist = await prisma.artist.findUnique({
      where: { id },
      include: {
        territoryMemberships: {
          include: { territory: true }
        },
        territoryBridges: {
          include: {
            territoryA: true,
            territoryB: true
          }
        }
      }
    });

    if (!artist) {
      return NextResponse.json({ error: 'Artist not found' }, { status: 404 });
    }

    // Resolve primary territory
    let territoryId = 'Territory_v2_001';
    let territoryName = 'Unknown Territory';
    if (artist.territoryMemberships.length > 0) {
      const primary = artist.territoryMemberships.find((tm: any) => tm.role === 'CORE') || artist.territoryMemberships[0];
      territoryId = primary.territoryId;
      territoryName = getTerritoryDisplayName(primary.territory.metadata, territoryId);
    }

    // Resolve bridge functions
    const connects = artist.territoryBridges.map((b: any) => {
      const fromName = getTerritoryDisplayName(b.territoryA.metadata, b.territoryAId);
      const toName = getTerritoryDisplayName(b.territoryB.metadata, b.territoryBId);
      return { from: fromName, to: toName };
    });

    const bridgeFunction = connects.length > 0 ? { connects } : null;

    // Resolve user relationship (from memories)
    const memory = await prisma.userArtistMemory.findUnique({
      where: { userId_artistId: { userId, artistId: id } }
    });

    const rel = await prisma.userTerritoryRelationship.findUnique({
      where: { userId_territoryId: { userId, territoryId } }
    });
    const relationshipState = rel ? rel.currentState : 'UNEXPLORED';

    // Get last organic listen
    const lastListen = await prisma.userListeningEvent.findFirst({
      where: {
        userId,
        artistId: id,
        initiationType: { in: ['SEARCH', 'ARTIST_PAGE', 'PLAYLIST'] }
      },
      orderBy: { timestamp: 'desc' }
    });

    let userRelationship = null;
    if (memory) {
      const strength = Math.round(memory.memoryStrength * 100);
      let memoryTrajectory: "GROWING" | "STABLE" | "FADING" = "GROWING";
      if (strength > 70 && memory.memoryState === 'INTERNALIZED') {
        memoryTrajectory = "STABLE";
      } else if (memory.persistence < 0.3) {
        memoryTrajectory = "FADING";
      }

      userRelationship = {
        memoryStrength: strength,
        memoryTrajectory,
        lastOrganicListen: lastListen ? lastListen.timestamp.toISOString() : null,
        relationshipState: memory.memoryState || relationshipState
      };
    }

    // Dynamic explanation
    let explanation = `A key artist within the ${territoryName} territory.`;
    if (connects.length > 0) {
      explanation = `${artist.displayName} bridges your listening from ${connects[0].from} to ${connects[0].to}.`;
    }

    const rawImg = artist.imageUrl || '';
    const imageUrl = rawImg
      ? (rawImg.startsWith('/api/') || rawImg.startsWith('data:') ? rawImg : `/api/orca/image-proxy?url=${encodeURIComponent(rawImg)}`)
      : '';

    const response = NextResponse.json({
      id: artist.id,
      name: artist.displayName,
      imageUrl,
      territory: {
        id: territoryId,
        name: territoryName
      },
      bridgeFunction,
      userRelationship,
      explanation
    });

    response.headers.set('Cache-Control', 'private, max-age=60');
    return response;

  } catch (error: any) {
    console.error('[/api/artist/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
