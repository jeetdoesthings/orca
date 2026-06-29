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

    // Upsert UserArtistMemory
    await prisma.userArtistMemory.upsert({
      where: { userId_artistId: { userId, artistId: id } },
      create: {
        userId,
        artistId: id,
        memoryState: 'INTERNALIZED',
        memoryStrength: 1.0,
        familiarity: 1.0,
        agency: 1.0,
        explorationDepth: 1.0,
        persistence: 1.0
      },
      update: {
        memoryState: 'INTERNALIZED',
        memoryStrength: 1.0,
        familiarity: 1.0
      }
    });

    // Create ExploredArtist record
    await prisma.exploredArtist.upsert({
      where: { userId_artistId: { userId, artistId: id } },
      create: {
        userId,
        artistId: id,
        source: 'mark-explored'
      },
      update: {}
    });

    return NextResponse.json({
      status: 'success',
      artistId: id,
      integrated: true
    });

  } catch (error: any) {
    console.error('[POST /api/artist/[id]/integrate] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
