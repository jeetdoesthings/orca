export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { buildCandidateUniverse } from '@/lib/candidate/cub';
import { resolveDemoUser } from '@/lib/auth/demo-user';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const isDemo = url.searchParams.get('demo') === 'true';

    let userId: string;
    let accessToken = '';

    if (isDemo) {
      const demoId = await resolveDemoUser();
      if (!demoId) {
        return new NextResponse('No demo data available', { status: 404 });
      }
      userId = demoId;
    } else {
      const session = await getServerSession(authOptions);
      if (!session || !session.user) {
        return new NextResponse('Unauthorized', { status: 401 });
      }
      const spotifyId = (session as { user?: { spotifyId?: string } }).user?.spotifyId;
      if (!spotifyId) {
        return new NextResponse('User spotify account not found', { status: 404 });
      }
      userId = spotifyId;
    }

    const account = await prisma.account.findFirst({
      where: { user: { spotifyId: userId }, provider: 'spotify' },
      select: { access_token: true },
    });
    accessToken = account?.access_token || '';

    // Build Candidate Universe via CUB (Explorer)
    const universe = await buildCandidateUniverse(userId, accessToken);

    // Calculate confidence distribution
    const distribution = {
      '0.0 - 0.2': 0,
      '0.2 - 0.4': 0,
      '0.4 - 0.6': 0,
      '0.6 - 0.8': 0,
      '0.8 - 1.0': 0,
    };

    for (const c of universe.candidates) {
      const conf = c.discoveryConfidence;
      if (conf < 0.2) distribution['0.0 - 0.2']++;
      else if (conf < 0.4) distribution['0.2 - 0.4']++;
      else if (conf < 0.6) distribution['0.4 - 0.6']++;
      else if (conf < 0.8) distribution['0.6 - 0.8']++;
      else distribution['0.8 - 1.0']++;
    }

    // Top discovery paths (candidates with highest number of discovery sources)
    const topPaths = universe.candidates
      .map((c) => ({
        artistId: c.artistId,
        name: c.name,
        opportunity: c.discoveryContext.growthOpportunity,
        stage: c.discoveryContext.relationshipStage,
        sourcesCount: c.discoveryContext.sources.length,
        sources: c.discoveryContext.sources.map((s) => s.type),
        confidence: c.discoveryConfidence,
      }))
      .sort((a, b) => b.sourcesCount - a.sourcesCount)
      .slice(0, 15);

    // Opportunity coverage details (number of candidates matching each opportunity)
    const coverage: Record<string, number> = {};
    for (const c of universe.candidates) {
      const opp = c.discoveryContext.growthOpportunity;
      coverage[opp] = (coverage[opp] || 0) + 1;
    }

    return NextResponse.json({
      status: 'success',
      generatedAt: universe.generatedAt,
      identitySeeds: universe.identitySeeds,
      genreGrowthOpportunities: universe.genreGrowthOpportunities,
      searchOrder: universe.genreGrowthOpportunities.map((o) => o.genre),
      candidateCount: universe.candidates.length,
      debugStats: {
        totalSeeds: universe.debugStats.totalSeeds,
        duplicateMerges: universe.debugStats.duplicateMerges,
        sourceBreakdown: universe.debugStats.sourceBreakdown,
        candidatesPerOpportunity: universe.debugStats.candidatesPerOpportunity,
        discoveryConfidenceDistribution: distribution,
        opportunityCoverage: coverage,
      },
      topDiscoveryPaths: topPaths,
    });
  } catch (error: any) {
    console.error('[GET /api/debug/candidate-universe] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
