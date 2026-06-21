export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { computeAndStoreFrontier } from '@/lib/frontier/computeAndStoreFrontier';
import { detectGeographicGaps } from '@/lib/metrics/geographicCoverage';
import { computeAdventurousness } from '@/lib/metrics/adventurousness';
import type { OrcaNode } from '@/lib/graph/types';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const isDemo = url.searchParams.get('demo') === 'true';

    let userId: string;
    let accessToken = '';

    if (isDemo) {
      const demoUser = await prisma.user.findFirst({
        where: { syncStatus: 'COMPLETE' },
        select: { spotifyId: true },
      });
      if (!demoUser) {
        return new NextResponse('No demo data available', { status: 404 });
      }
      userId = demoUser.spotifyId!;
    } else {
      const session = await getServerSession(authOptions);
      if (!session || !session.user || !session.user.spotifyId) {
        return new NextResponse('Unauthorized', { status: 401 });
      }
      userId = session.user.spotifyId;
      accessToken = session.spotifyAccessToken || '';
    }

    const user = await prisma.user.findUnique({
      where: { spotifyId: userId },
      select: {
        globeData: true,
        frontierData: true,
        perimeterData: true,
        frontierStatus: true,
        frontierComputedAt: true,
        adventurousnessHistory: true,
      },
    });

    if (!user) {
      return NextResponse.json({ status: 'no_data' });
    }

    // Parse cached frontier and boundary data
    let frontierNodes: OrcaNode[] = [];
    let perimeterData: any[] = [];
    let exploredNodes: OrcaNode[] = [];

    try {
      frontierNodes = JSON.parse(user.frontierData || '[]');
      perimeterData = JSON.parse(user.perimeterData || '[]');
      if (user.globeData) {
        exploredNodes = JSON.parse(user.globeData).nodes || [];
      }
    } catch (e) {
      console.error('[API frontier] JSON parsing error:', e);
    }

    const isComputing = user.frontierStatus === 'COMPUTING';
    const computedAt = user.frontierComputedAt ? new Date(user.frontierComputedAt) : null;
    const now = new Date();
    // 45 seconds threshold to assume background task was killed/stuck due to server restart/re-compile
    const isStuck = isComputing && computedAt && (now.getTime() - computedAt.getTime() > 45 * 1000);

    // If it's a demo, we never want to trigger computeAndStoreFrontier or return "computing".
    // We just return whatever we have, or fallback to empty arrays.
    if (isDemo) {
      const geographicGaps = detectGeographicGaps(exploredNodes, frontierNodes);
      let adventurousness = null;
      if (user.adventurousnessHistory) {
        try {
          const history = JSON.parse(user.adventurousnessHistory);
          adventurousness = history[history.length - 1] || null;
        } catch {}
      }
      if (!adventurousness && exploredNodes.length > 0) {
        adventurousness = computeAdventurousness(exploredNodes, frontierNodes, null);
      }
      return NextResponse.json(
        {
          status: 'ready',
          frontierNodes,
          perimeterData,
          geographicGaps,
          adventurousness,
          frontierComputedAt: user.frontierComputedAt,
        },
        {
          headers: {
            'Cache-Control': process.env.NODE_ENV === 'development' ? 'no-store' : 'private, max-age=1800',
          },
        }
      );
    }

    // 1. If never computed, or stuck without data, trigger and poll
    if (user.frontierStatus === 'PENDING' || !user.frontierData || (isStuck && frontierNodes.length === 0)) {
      if (exploredNodes.length > 0) {
        computeAndStoreFrontier(userId, exploredNodes, accessToken).catch(err => {
          console.error('[API frontier] Background frontier calculation error:', err);
        });
      }
      return NextResponse.json({ status: 'computing' });
    }

    // 2. If stuck but we DO have cached nodes, trigger a self-healing recomputation in the background, but continue to serve the cache immediately!
    if (isStuck) {
      console.log(`[API frontier] Self-healing active: stuck in COMPUTING (computedAt: ${computedAt}). Re-triggering background sync...`);
      computeAndStoreFrontier(userId, exploredNodes, accessToken).catch(err => {
        console.error('[API frontier] Self-healing recomputation failed:', err);
      });
    } else if (isComputing && frontierNodes.length === 0) {
      // Actively computing and no cached nodes available yet
      return NextResponse.json({ status: 'computing' });
    }

    // Compute dynamic geographic gaps on the fly to match freshest explore actions
    const geographicGaps = detectGeographicGaps(exploredNodes, frontierNodes);

    // Get adventurousness snapshot
    let adventurousness = null;
    if (user.adventurousnessHistory) {
      try {
        const history = JSON.parse(user.adventurousnessHistory);
        adventurousness = history[history.length - 1] || null;
      } catch {}
    }
    
    // Fallback if metric is not yet stored
    if (!adventurousness && exploredNodes.length > 0) {
      adventurousness = computeAdventurousness(exploredNodes, frontierNodes, null);
    }

    return NextResponse.json(
      {
        status: 'ready',
        frontierNodes,
        perimeterData,
        geographicGaps,
        adventurousness,
        frontierComputedAt: user.frontierComputedAt,
      },
      {
        headers: {
          'Cache-Control': process.env.NODE_ENV === 'development' ? 'no-store' : 'private, max-age=1800',
        },
      }
    );
  } catch (error) {
    console.error('[API user/frontier] GET Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * POST /api/user/frontier — Force recompute frontier data.
 * Resets frontierStatus to PENDING and clears stale data so the next GET
 * triggers a fresh computation with updated pipeline logic.
 */
export async function POST(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const isDemo = url.searchParams.get('demo') === 'true';

    if (isDemo) {
      return NextResponse.json({ status: 'recompute_triggered' });
    }

    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.spotifyId) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const userId = session.user.spotifyId;

    await prisma.user.update({
      where: { spotifyId: userId },
      data: {
        frontierStatus: 'PENDING',
        frontierData: null,
      },
    });

    console.log(`[API frontier] Force recompute triggered for user ${userId}`);
    return NextResponse.json({ status: 'recompute_triggered' });
  } catch (error) {
    console.error('[API user/frontier] POST Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
