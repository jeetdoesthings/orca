import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest) {
  try {
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

    const { destinationGenreId } = await request.json();
    if (!destinationGenreId) {
      return NextResponse.json({ error: 'Missing destinationGenreId' }, { status: 400 });
    }

    // De-slug the genre ID back to name or look up a matching territory
    const cleanGenre = destinationGenreId.replace(/-/g, ' ').toLowerCase();

    // Find a matching territory for the genre in memberships or template table
    const template = await prisma.globalPathwayTemplate.findFirst({
      where: {
        OR: [
          { targetTerritory: { contains: cleanGenre } },
          { targetTerritory: { contains: destinationGenreId } }
        ]
      }
    });

    const targetTerritoryId = template ? template.targetTerritory : 'Territory_v2_002'; // fallback

    // Archive any existing active journeys
    await prisma.longitudinalIntervention.updateMany({
      where: { userId, state: 'ACTIVE' },
      data: { state: 'ARCHIVED' }
    });

    // Create new active journey
    const maturationDate = new Date();
    maturationDate.setDate(maturationDate.getDate() + 30);

    const intervention = await prisma.longitudinalIntervention.create({
      data: {
        userId,
        targetTerritoryId,
        pathwayHash: Math.random().toString(36).substring(7),
        state: 'ACTIVE',
        maturationDate,
        baselineProbability: 0.15,
        expectedOutcome: 0.85
      }
    });

    return NextResponse.json({
      status: 'success',
      journeyId: intervention.id,
      targetTerritoryId
    });

  } catch (error: any) {
    console.error('[POST /api/journeys] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
