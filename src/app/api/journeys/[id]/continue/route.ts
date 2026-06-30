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

    const intervention = await prisma.longitudinalIntervention.findFirst({
      where: { id, userId }
    });

    if (!intervention) {
      return NextResponse.json({ error: 'Journey not found' }, { status: 404 });
    }

    // Step logic: Increment step locally or simulate milestones.
    // In our simplified database model, step status is derived. We can return success.
    const { triggerWorldRegeneration } = await import('@/lib/frontier/world-regeneration');
    await triggerWorldRegeneration(userId);

    return NextResponse.json({
      status: 'success',
      journeyId: id,
      currentStep: 3
    });

  } catch (error: any) {
    console.error('[POST /api/journeys/[id]/continue] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
