import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { materializeWorldDeduped } from '@/lib/frontier/materialize-lock';
import { verifyAdminRequest } from '@/lib/auth/admin-auth';

/**
 * Admin force materialize via sole writer (Ticket 4).
 * Uses real Spotify token when available — never invalid_token.
 */
export async function GET(req: Request) {
  if (!verifyAdminRequest(req)) {
    return new Response('Unauthorized', { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');

  if (!userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { spotifyId: userId },
    select: { id: true, globeData: true },
  });

  if (!user || !user.globeData) {
    return NextResponse.json({ error: 'No user data' }, { status: 404 });
  }

  const exploredNodes = JSON.parse(user.globeData).nodes || [];

  const account = await prisma.account.findFirst({
    where: { userId: user.id, provider: 'spotify' },
    select: { access_token: true },
  });

  const accessToken = account?.access_token || '';

  console.log(`[Admin] Triggering frontier computation for ${userId}`);

  // Audit fix H2: await the materialization (deduped per user) so it survives
  // serverless; the admin UI polls frontier status.
  const result = await materializeWorldDeduped(userId, {
    exploredNodes,
    accessToken,
    fullMaterialization: true,
  });

  return NextResponse.json({
    status: 'computing_complete',
    snapshotVersion: result.worldState.snapshotVersion,
    frontierCount: result.frontierNodes.length,
  });
}
