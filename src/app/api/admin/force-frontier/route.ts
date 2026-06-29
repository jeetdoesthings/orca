import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { computeAndStoreFrontier } from '@/lib/frontier/computeAndStoreFrontier';
import { verifyAdminRequest } from '@/lib/auth/admin-auth';

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
    select: { globeData: true }
  });

  if (!user || !user.globeData) {
    return NextResponse.json({ error: 'No user data' }, { status: 404 });
  }

  const exploredNodes = JSON.parse(user.globeData).nodes || [];

  console.log(`[Admin] Triggering frontier computation for ${userId}`);
  
  // Fire and forget, use invalid token to force fallback
  computeAndStoreFrontier(userId, exploredNodes, 'invalid_token').catch(console.error);

  return NextResponse.json({ status: 'computing_triggered' });
}
