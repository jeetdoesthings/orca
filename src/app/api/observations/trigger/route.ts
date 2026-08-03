import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { GET as getGlobe } from '../../globe/route';
import { evaluateFeedbackRules } from '@/lib/graph/feedback-service';
import { resolveDemoUser } from '@/lib/auth/demo-user';

export async function POST(request: NextRequest) {
  try {
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

    // Force rule evaluation using globe GIA snapshots
    const globeResponse = await getGlobe(request);
    if (!globeResponse.ok) {
      return NextResponse.json({ error: 'Failed to load globe data' }, { status: 500 });
    }
    const globeData = await globeResponse.json();
    if (globeData.status !== 'ready') {
      return NextResponse.json({ observations: [] });
    }

    const observations = evaluateFeedbackRules(
      userId,
      globeData.genres || [],
      globeData.nodes || []
    );

    return NextResponse.json({ observations });

  } catch (error: any) {
    console.error('[POST /api/observations/trigger] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
