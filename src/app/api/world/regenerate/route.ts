import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { materializeWorldDeduped } from '@/lib/frontier/materialize-lock';
import { parseRequestRuntimeConfig } from '@/lib/config/request-runtime';
import { resolveDemoUser } from '@/lib/auth/demo-user';
export const maxDuration = 300;

/**
 * Canonical POST — explicit world materialization.
 * GET /api/globe is projection-only; this endpoint owns rebuilds.
 */
export async function POST(request: NextRequest) {
  // Parse (and ignore product-side) request config without mutating process.env.
  parseRequestRuntimeConfig(request);

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

    const result = await materializeWorldDeduped(userId, { fullMaterialization: true });

    return NextResponse.json({
      status: 'complete',
      snapshotVersion: result.worldState.snapshotVersion,
      candidateUniverseVersion: result.worldState.candidateUniverseVersion,
      ocseVersion: result.worldState.ocseEvaluationVersion,
      generatedAt: result.worldState.lastGeneratedAt,
      frontierCount: result.frontierNodes.length,
      worldDelta: result.worldState.delta,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[POST /api/world/regenerate] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
