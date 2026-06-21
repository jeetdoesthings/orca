import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

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
        return new NextResponse('No demo data available', { status: 404 });
      }
      userId = demoUser.spotifyId!;
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
        homeRegion: true,
        tasteSummary: true,
        lastSyncAt: true,
        syncStatus: true,
      },
    });

    if (!user) {
      return NextResponse.json({ status: 'no_data' });
    }

    if (user.syncStatus === 'SYNCING') {
      return NextResponse.json({ status: 'syncing' });
    }

    if (user.syncStatus === 'FAILED') {
      return NextResponse.json({ status: 'error' });
    }

    if (!user.globeData) {
      return NextResponse.json({ status: 'no_data' });
    }

    const { nodes, edges } = JSON.parse(user.globeData);
    const homeRegion = user.homeRegion ? JSON.parse(user.homeRegion) : null;

    return NextResponse.json(
      {
        status: 'ready',
        nodes,
        edges,
        homeRegion,
        tasteSummary: user.tasteSummary,
        lastSyncAt: user.lastSyncAt,
      },
      {
        headers: {
          'Cache-Control': 'private, max-age=60',
        },
      }
    );
  } catch (error) {
    console.error('[API user/globe-data] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
