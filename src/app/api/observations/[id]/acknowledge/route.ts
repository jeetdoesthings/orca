import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { readObservations, writeObservations } from '@/lib/graph/feedback-store';
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

    const currentObservations = readObservations(userId);
    const item = currentObservations.find(f => f.id === id);

    if (item) {
      item.status = 'acknowledged';
      writeObservations(userId, currentObservations);
    }

    return new NextResponse(null, { status: 204 });

  } catch (error: any) {
    console.error('[POST /api/observations/[id]/acknowledge] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
