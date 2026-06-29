import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { buildFrontierNodes } from '@/lib/frontier/buildFrontierNodes';
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
    select: { id: true, globeData: true }
  });

  if (!user || !user.globeData) {
    return NextResponse.json({ error: 'No user data' }, { status: 404 });
  }

  const exploredNodes = JSON.parse(user.globeData).nodes || [];

  // Fetch access token
  const account = await prisma.account.findFirst({
    where: { userId: user.id, provider: 'spotify' },
    select: { access_token: true }
  });

  const token = account?.access_token || 'invalid_token';

  // Override console.log to capture logs
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: any[]) => {
    logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
    originalLog(...args);
  };

  try {
    const frontier = await buildFrontierNodes(exploredNodes, token, userId);
    return NextResponse.json({ 
      frontierCount: frontier.length, 
      logs,
      frontier: frontier.slice(0, 3) 
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message, logs }, { status: 500 });
  } finally {
    console.log = originalLog;
  }
}
