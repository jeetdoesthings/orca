import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { materializeWorld } from '@/lib/frontier/pipeline-runner';
import { verifyAdminRequest } from '@/lib/auth/admin-auth';

/**
 * Admin inspect via sole materializer (Ticket 4).
 * Does not call buildFrontierNodes directly.
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

  const token = account?.access_token || '';

  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(
      args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '),
    );
    originalLog(...args);
  };

  try {
    const result = await materializeWorld(userId, {
      exploredNodes,
      accessToken: token,
      fullMaterialization: true,
    });
    return NextResponse.json({
      frontierCount: result.frontierNodes.length,
      snapshotVersion: result.worldState.snapshotVersion,
      logs,
      frontier: result.frontierNodes.slice(0, 3),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message, logs }, { status: 500 });
  } finally {
    console.log = originalLog;
  }
}
