import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { processAndStoreUserData } from '@/lib/spotifySync';

// Audit fix H2: sync can take minutes of external calls; allow serverless
// platforms to keep the function alive until the awaited run completes.
export const maxDuration = 300;

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

    // Dedupe: if a sync is already in progress, don't start a second one.
    const existing = await prisma.user.findUnique({
      where: { spotifyId: userId },
      select: { syncStatus: true },
    });
    if (existing?.syncStatus === 'SYNCING') {
      console.log(`[API user/sync] ${userId} already SYNCING — skipping duplicate`);
      return NextResponse.json({ status: 'already-syncing' });
    }

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

    // Audit fix H2: await the sync so it survives serverless. The client polls
    // /api/user/globe-data for status; failures mark syncStatus=FAILED below.
    try {
      await processAndStoreUserData(accessToken, userId);
    } catch (err: any) {
      console.error(`[API user/sync] Sync failed for user ${userId}:`, err);
      await prisma.user
        .update({
          where: { spotifyId: userId },
          data: { syncStatus: 'FAILED' },
        })
        .catch((e: any) =>
          console.error('[API user/sync] Double-fault setting FAILED status:', e),
        );
      return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
    }

    return NextResponse.json({ status: 'complete' });
  } catch (error) {
    console.error('[API user/sync] Error triggering sync:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
