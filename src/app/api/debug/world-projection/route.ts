export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { readWorldState } from '@/lib/frontier/world-state-store';
import { projectWorld } from '@/lib/frontier/world-projection';
import { parseRequestRuntimeConfig } from '@/lib/config/request-runtime';
import { resolveDemoUser } from '@/lib/auth/demo-user';

export async function GET(request: NextRequest) {
  try {
    const runtimeConfig = parseRequestRuntimeConfig(request);
      const url = new URL(request.url);
      const isDemo = url.searchParams.get('demo') === 'true';
      const sliderValStr = url.searchParams.get('slider') || '0.5';
      const sliderValue = parseFloat(sliderValStr);

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
        select: { globeData: true }
      });

      if (!dbUser || !dbUser.globeData) {
        return NextResponse.json({ error: 'User world data not synced' }, { status: 404 });
      }

      const graphData = JSON.parse(dbUser.globeData);
      const edges = graphData.edges || [];

      // Load evaluated candidates snapshot
      const worldState = await readWorldState(userId);
      const candidates = worldState.lastNodes || [];

      // Run World Projection Engine
      const projection = projectWorld(candidates, edges, sliderValue);

      // Distinguish visible vs hidden items
      const visibleArtists = projection.nodes.filter(n => n.visible).map(n => n.name);
      const hiddenArtists = projection.nodes.filter(n => !n.visible).map(n => n.name);
      const visibleEdges = projection.edges.filter(e => e.visible).map(e => `${e.source} -> ${e.target}`);
      const hiddenEdges = projection.edges.filter(e => !e.visible).map(e => `${e.source} -> ${e.target}`);

      return NextResponse.json({
        status: 'success',
        sliderValue,
        projectionWindow: projection.stats.projectionWindow,
        visibleArtistsCount: visibleArtists.length,
        hiddenArtistsCount: hiddenArtists.length,
        visibleEdgesCount: visibleEdges.length,
        hiddenEdgesCount: hiddenEdges.length,
        visibleArtistsSample: visibleArtists.slice(0, 30),
        hiddenArtistsSample: hiddenArtists.slice(0, 30),
        visibleEdgesSample: visibleEdges.slice(0, 30),
        hiddenEdgesSample: hiddenEdges.slice(0, 30),
        stats: projection.stats,
      });

    } catch (error: any) {
      console.error('[/api/debug/world-projection] Error:', error);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
