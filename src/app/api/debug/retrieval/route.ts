export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { extractIdentitySeeds } from '@/lib/candidate/cub';
import { ORCARetrievalEngine } from '@/lib/candidate/ore';
import { resolveDemoUser } from '@/lib/auth/demo-user';

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
      if (!session || !session.user) {
        return new NextResponse('Unauthorized', { status: 401 });
      }
      const spotifyId = (session as { user?: { spotifyId?: string } }).user?.spotifyId;
      if (!spotifyId) {
        return new NextResponse('User spotify account not found', { status: 404 });
      }
      userId = spotifyId;
    }

    // Extract Identity Seeds to query retrieval engine
    const seeds = await extractIdentitySeeds(userId);
    const engine = new ORCARetrievalEngine();
    const { metrics } = await engine.retrieveCandidates(
      seeds.map(s => ({ name: s.name, artistId: s.artistId }))
    );

    return NextResponse.json({
      status: 'success',
      metrics,
    });
  } catch (err: any) {
    console.error('[ORE DEBUG] Debug route execution failed:', err);
    return new NextResponse(err.message || 'Internal Server Error', { status: 500 });
  }
}
