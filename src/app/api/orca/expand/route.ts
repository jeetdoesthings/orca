/**
 * POST /api/orca/expand
 *
 * Product expansion reads the **already-materialized** frontier (Ticket 4).
 * Never calls `buildFrontierNodes` directly — sole stage runner lives inside
 * `materializeWorld`. If frontier empty but identity exists, materialize once
 * then filter by seed artistIds.
 *
 * Body: { artistIds: string[], sliderValue?: number }
 * Response: { source: 'orca-expand-canonical', nodes: OrcaNode[], edges: OrcaEdge[] }
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { resolveDemoUser } from '@/lib/auth/demo-user';
import { materializeWorld } from '@/lib/frontier/pipeline-runner';
import { readWorldState } from '@/lib/frontier/world-state-store';
import type { OrcaNode, OrcaEdge } from '@/lib/graph/types';

export async function POST(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const isDemo = url.searchParams.get('demo') === 'true';

    let body: { artistIds?: string[]; sliderValue?: number; demo?: boolean } = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const demoMode = isDemo || body.demo === true;

    let userId: string;
    let accessToken = '';
    if (demoMode) {
      const demoId = await resolveDemoUser();
      if (!demoId) {
        return NextResponse.json({ error: 'No demo data available' }, { status: 404 });
      }
      userId = demoId;
    } else {
      const session = await getServerSession(authOptions);
      if (!session?.user?.spotifyId) {
        return new NextResponse('Unauthorized', { status: 401 });
      }
      userId = session.user.spotifyId;
      accessToken = session.spotifyAccessToken || '';
    }

    const seedIds = Array.isArray(body.artistIds)
      ? body.artistIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [];
    if (seedIds.length === 0) {
      return NextResponse.json({ error: 'artistIds required' }, { status: 400 });
    }

    const sliderValue =
      typeof body.sliderValue === 'number' && body.sliderValue >= 0 && body.sliderValue <= 1
        ? body.sliderValue
        : 0.5;

    const user = await prisma.user.findUnique({
      where: { spotifyId: userId },
      select: { globeData: true },
    });
    if (!user?.globeData) {
      return NextResponse.json({ error: 'No globe data — sync first' }, { status: 404 });
    }

    let exploredNodes: OrcaNode[] = [];
    try {
      const parsed = JSON.parse(user.globeData) as { nodes?: OrcaNode[] };
      exploredNodes = parsed.nodes || [];
    } catch {
      return NextResponse.json({ error: 'Corrupt globeData' }, { status: 500 });
    }

    if (exploredNodes.length === 0) {
      return NextResponse.json({
        source: 'orca-expand-canonical',
        nodes: [],
        edges: [],
      });
    }

    // Read materialized frontier only. Empty → sole writer materializeWorld.
    let worldState = await readWorldState(userId);
    let frontierNodes = worldState.lastNodes || [];

    if (frontierNodes.length === 0) {
      const result = await materializeWorld(userId, {
        exploredNodes,
        accessToken,
        sliderValue,
        fullMaterialization: true,
      });
      frontierNodes = result.frontierNodes;
    }

    const seedSet = new Set(seedIds);
    // Prefer nodes adjacent to the requested seeds; if none match, return the
    // full frontier so the client still receives pipeline-evaluated candidates.
    const adjacent = frontierNodes.filter(
      (n) => Array.isArray(n.adjacentTo) && n.adjacentTo.some((id) => seedSet.has(id)),
    );
    const nodes = adjacent.length > 0 ? adjacent : frontierNodes;

    const edges: OrcaEdge[] = [];
    for (const n of nodes) {
      for (const src of n.adjacentTo || []) {
        if (
          seedSet.has(src) ||
          frontierNodes.some((f) => f.id === src) ||
          exploredNodes.some((e) => e.id === src)
        ) {
          edges.push({
            source: src,
            target: n.id,
            type: 'related',
            weight: 0.5,
          });
        }
      }
    }

    return NextResponse.json({
      source: 'orca-expand-canonical',
      nodes,
      edges,
    });
  } catch (err) {
    console.error('[API orca/expand] Failed:', err);
    return NextResponse.json({ error: 'Expand failed' }, { status: 500 });
  }
}
