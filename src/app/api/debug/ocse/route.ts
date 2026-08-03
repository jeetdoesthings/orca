export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { buildCandidateUniverse } from '@/lib/candidate/cub';
import { computeGenreRelationships } from '@/lib/gre/gre';
import { evaluateCandidateUniverse } from '@/lib/ocse/decision-engine';
import type { UserInteractionHistory, OCSEContext } from '@/lib/ocse/ocse-types';
import { readWorldState } from '@/lib/frontier/world-state-store';
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

    // 1. Fetch Candidate Universe from CUB
    const universe = await buildCandidateUniverse(userId, accessToken);

    // 2. Fetch Genre relationships from GRE
    const relationships = await computeGenreRelationships(userId);

    // 3. Query interaction histories from user's memory table to feed cooldown engine
    const memories = await prisma.userArtistMemory.findMany({
      where: { userId },
      select: { artistId: true, memoryState: true, memoryStrength: true, updatedAt: true },
    });

    const timesShown: Record<string, number> = {};
    const timesIgnored: Record<string, number> = {};
    const timesDismissed: Record<string, number> = {};
    const timesIntegrated: Record<string, number> = {};
    const lastShown: Record<string, string> = {};

    for (const mem of memories) {
      const id = mem.artistId;
      timesShown[id] = 1;
      timesIgnored[id] = mem.memoryState === 'DORMANT' ? 1 : 0;
      timesDismissed[id] = mem.memoryState === 'FORGOTTEN' ? 1 : 0;
      timesIntegrated[id] = mem.memoryState === 'INTERNALIZED' ? 1 : 0;
      lastShown[id] = mem.updatedAt ? new Date(mem.updatedAt).toISOString() : new Date().toISOString();
    }

    const history: UserInteractionHistory = {
      timesShown,
      timesIgnored,
      timesDismissed,
      timesIntegrated,
      lastShown,
    };

    // P1-6: real visible world for growthContribution (explored + prior frontier).
    const priorWorld = await readWorldState(userId);
    let exploredIds: string[] = [];
    const globeRow = await prisma.user.findUnique({
      where: { spotifyId: userId },
      select: { globeData: true },
    });
    if (globeRow?.globeData) {
      try {
        const nodes = JSON.parse(globeRow.globeData).nodes || [];
        exploredIds = nodes.map((n: { id: string }) => n.id);
      } catch {
        /* ignore */
      }
    }
    const currentVisibleWorldIds = Array.from(
      new Set([
        ...exploredIds,
        ...priorWorld.visibleNodeIds,
        ...priorWorld.lastNodes.map((n) => n.id),
      ]),
    );

    const sliderValue = 0.5; // balanced slider default
    const context: OCSEContext = {
      relationships,
      sliderValue,
      interactionHistory: history,
      currentVisibleWorldIds,
    };

    // 4. Run OCSE
    const profiles = evaluateCandidateUniverse(universe.candidates, context);

    // Calculate distributions
    const distribution = {
      '0.0 - 0.2': 0,
      '0.2 - 0.4': 0,
      '0.4 - 0.6': 0,
      '0.6 - 0.8': 0,
      '0.8 - 1.0': 0,
    };

    const expansionDistanceDistribution = {
      CORE: 0,
      FAMILIAR: 0,
      COMFORT_EDGE: 0,
      EXPANSION: 0,
      OUTER_EDGE: 0,
    };
    // Phase 2 P0-1: profiles whose Candidate had no threaded expansionDistance
    // (the debug route does not run the Expansion Intelligence pre-pass).
    let expansionDistanceSkipped = 0;

    const reasonsCount: Record<string, number> = {};

    for (const p of profiles) {
      const conf = p.decisionConfidence;
      if (conf < 0.2) distribution['0.0 - 0.2']++;
      else if (conf < 0.4) distribution['0.2 - 0.4']++;
      else if (conf < 0.6) distribution['0.4 - 0.6']++;
      else if (conf < 0.8) distribution['0.6 - 0.8']++;
      else distribution['0.8 - 1.0']++;

      // Phase 2 P0-1: expansionDistance is now optional on DecisionProfile.
      // This debug route invokes OCSE directly without the Expansion Intelligence
      // pre-pass, so candidates do not carry a real distance and the field is
      // undefined here. That is honest — the bucket distribution only counts
      // profiles where the real distance was threaded through (the canonical
      // buildFrontierNodes path). SKIPPED entries are reported separately below.
      const dist = p.expansionDistance;
      if (dist === undefined) {
        expansionDistanceSkipped++;
      } else if (dist < 0.20) expansionDistanceDistribution.CORE++;
      else if (dist < 0.40) expansionDistanceDistribution.FAMILIAR++;
      else if (dist < 0.60) expansionDistanceDistribution.COMFORT_EDGE++;
      else if (dist < 0.80) expansionDistanceDistribution.EXPANSION++;
      else expansionDistanceDistribution.OUTER_EDGE++;

      for (const reason of p.decisionReasons) {
        reasonsCount[reason] = (reasonsCount[reason] || 0) + 1;
      }
    }

    // Generate full RecommendationTrace payloads for details rendering
    const { generateRecommendationTrace } = await import('@/lib/ocse/explainability-chain');
    const traces = profiles.map(p => {
      const candidate = universe.candidates.find(c => c.artistId === p.candidateId);
      if (!candidate) return null;
      const rel = relationships.find(r => r.genre === (candidate.genres && candidate.genres.length > 0 ? candidate.genres[0] : 'pop'));
      return generateRecommendationTrace(p, candidate, rel);
    }).filter(Boolean);

    return NextResponse.json({
      status: 'success',
      generatedAt: new Date().toISOString(),
      userSpotifyId: userId,
      profilesCount: profiles.length,
      debugStats: {
        activeSliderValue: sliderValue,
        decisionConfidenceDistribution: distribution,
        expansionDistanceDistribution,
        expansionDistanceSkipped,
        reasonsDistribution: reasonsCount,
      },
      traces: traces.slice(0, 100), // return top 100 traces for developer readability
    });
  } catch (error: any) {
    console.error('[GET /api/debug/ocse] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
