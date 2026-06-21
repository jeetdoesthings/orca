import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { processAndStoreUserData } from '@/lib/spotifySync';

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const isDemo = url.searchParams.get('demo') === 'true';

    if (isDemo) {
      return NextResponse.json({ status: 'syncing' });
    }

    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.spotifyId || !session.spotifyAccessToken) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const userId = session.user.spotifyId;
    const accessToken = session.spotifyAccessToken;

    // Check if user exists, upsert with SYNCING status
    await prisma.user.upsert({
      where: { spotifyId: userId },
      update: { syncStatus: 'SYNCING' },
      create: {
        spotifyId: userId,
        displayName: session.user.name || '',
        avatarUrl: session.user.image || '',
        syncStatus: 'SYNCING',
      },
    });

    // Run the sync process asynchronously - fire and forget
    processAndStoreUserData(accessToken, userId).catch(err => {
      console.error(`[API user/sync] Background sync failed for user ${userId}:`, err);
      prisma.user.update({
        where: { spotifyId: userId },
        data: { syncStatus: 'FAILED' },
      }).catch(e => console.error('[API user/sync] Double-fault setting FAILED status:', e));
    });

    return NextResponse.json({ status: 'syncing' });
  } catch (error) {
    console.error('[API user/sync] Error triggering sync:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
