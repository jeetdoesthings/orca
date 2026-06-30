import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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

    // Set memoryState to 'DORMANT' as representation of ignore
    await prisma.userArtistMemory.upsert({
      where: { userId_artistId: { userId, artistId: id } },
      create: {
        userId,
        artistId: id,
        memoryState: 'DORMANT',
        memoryStrength: 0.0,
        familiarity: 0.0,
        agency: 0.0,
        explorationDepth: 0.0,
        persistence: 0.0
      },
      update: {
        memoryState: 'DORMANT',
        memoryStrength: 0.0
      }
    });

    // Update ignore freshness metrics in world state
    const { readWorldState, writeWorldState } = await import('@/lib/frontier/world-state-store');
    const state = readWorldState(userId);
    let metrics = state.nodeMetrics[id];
    if (!metrics) {
      metrics = {
        lastEvaluated: new Date().toISOString(),
        lastVisible: new Date(0).toISOString(),
        timesShown: 0,
        timesIgnored: 0,
        timesIntegrated: 0,
        visibilityCooldown: 0
      };
      state.nodeMetrics[id] = metrics;
    }
    metrics.timesIgnored++;
    metrics.visibilityCooldown = metrics.timesIgnored * 3;
    writeWorldState(userId, state);

    // Invalidate state and recompute frontier
    const { triggerWorldRegeneration } = await import('@/lib/frontier/world-regeneration');
    await triggerWorldRegeneration(userId);

    return NextResponse.json({
      status: 'success',
      artistId: id,
      ignored: true
    });

  } catch (error: any) {
    console.error('[POST /api/artist/[id]/ignore] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
