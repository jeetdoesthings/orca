import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { resolveDemoUser } from '@/lib/auth/demo-user';

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

    await prisma.userArtistMemory.upsert({
      where: { userId_artistId: { userId, artistId: id } },
      create: {
        userId,
        artistId: id,
        memoryState: 'FOLLOWED',
        memoryStrength: 0.8,
      },
      update: {
        memoryState: 'FOLLOWED',
      },
    });

    return NextResponse.json({
      status: 'success',
      artistId: id,
      followed: true
    });

  } catch (error: any) {
    console.error('[POST /api/artist/[id]/follow] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}