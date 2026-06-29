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
