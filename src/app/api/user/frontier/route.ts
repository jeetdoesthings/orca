export const dynamic = 'force-dynamic';
// TODO: Migrate internal api/user/frontier endpoint and filename to expansion terminology in a future cleanup.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { materializeWorldDeduped } from '@/lib/frontier/materialize-lock';
import { detectGeographicGaps } from '@/lib/metrics/geographicCoverage';
import { computeAdventurousness } from '@/lib/metrics/adventurousness';
import type { OrcaNode } from '@/lib/graph/types';
import { assessUserColdStart } from '@/lib/identity/cold-start';
import { resolveDemoUser } from '@/lib/auth/demo-user';
export const maxDuration = 300;

/**
 * GET /api/user/frontier — pure read of cached frontier.
 * Never materializes (Ticket 4). Explicit write: POST here or POST /api/world/regenerate.
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const isDemo = url.searchParams.get('demo') === 'true';

    let userId: string;

    if (isDemo) {
      const demoId = await resolveDemoUser();
      if (!demoId) {
        return new NextResponse('No demo data available', { status: 404 });
      }
      userId = demoId;
    } else {
      const session = await getServerSession(authOptions);
      if (!session || !session.user || !session.user.spotifyId) {
        return new NextResponse('Unauthorized', { status: 401 });
      }
      userId = session.user.spotifyId;
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

    const isComputing = user.frontierStatus === 'COMPUTING';

    // Actively computing and no cache yet — pure status, no rebuild
    if (!isDemo && isComputing && !user.frontierData) {
      return NextResponse.json({ status: 'computing' });
    }

    // Never computed — pure pending; client must POST regenerate / POST frontier
    if (!isDemo && (user.frontierStatus === 'PENDING' || !user.frontierData)) {
      return NextResponse.json({
        status: 'pending',
        frontierStatus: user.frontierStatus ?? 'PENDING',
        needsMaterialization: true,
      });
    }

    let frontierNodes: OrcaNode[] = [];
    let perimeterData: unknown[] = [];
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

    const geographicGaps = detectGeographicGaps(exploredNodes, frontierNodes);

    let adventurousness = null;
    if (user.adventurousnessHistory) {
      try {
        const history = JSON.parse(user.adventurousnessHistory);
        adventurousness = history[history.length - 1] || null;
      } catch {
        /* ignore corrupt history */
      }
    }

    if (!adventurousness && exploredNodes.length > 0) {
      adventurousness = computeAdventurousness(exploredNodes, frontierNodes, null);
    }

    const cold = await assessUserColdStart(userId);

    // Stuck COMPUTING but cache exists: serve cache; never self-heal on GET
    return NextResponse.json(
      {
        status: 'ready',
        frontierNodes,
        perimeterData,
        geographicGaps,
        adventurousness,
        frontierComputedAt: user.frontierComputedAt,
        frontierStatus: user.frontierStatus,
        coldStart: cold.coldStart,
        coldStartReason: cold.reason,
        ...(cold.coldStart
          ? { message: 'still learning your taste' }
          : {}),
        ...(isComputing ? { staleComputing: true } : {}),
      },
      {
        headers: {
          'Cache-Control':
            process.env.NODE_ENV === 'development' ? 'no-store' : 'private, max-age=1800',
        },
      },
    );
  } catch (error) {
    console.error('[API user/frontier] GET Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * POST /api/user/frontier — explicit materialize trigger (Ticket 4 write path).
 * Prefer POST /api/world/regenerate for full materialization from clients.
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
    const accessToken = session.spotifyAccessToken || '';

    // Audit fix H2: await the materialization (deduped per user) so the run
    // survives serverless; the client polls GET for status.
    const result = await materializeWorldDeduped(userId, {
      accessToken,
      fullMaterialization: true,
    });

    return NextResponse.json({
      status: 'recompute_complete',
      snapshotVersion: result.worldState.snapshotVersion,
      frontierCount: result.frontierNodes.length,
    });
  } catch (error) {
    console.error('[API user/frontier] POST Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
