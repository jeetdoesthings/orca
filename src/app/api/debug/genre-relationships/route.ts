export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { computeGenreRelationships } from '@/lib/gre/gre';
import { persistGenreRelationships } from '@/lib/gre/relationship-persistence';
import { resolveDemoUser } from '@/lib/auth/demo-user';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const isDemo = url.searchParams.get('demo') === 'true';

    let userId: string;

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

    // 1. Compute current genre relationships via pure GRE (Analysis)
    const relationships = await computeGenreRelationships(userId);

    // 2. Persist relationships into the database via Persistence Layer (Writes)
    await persistGenreRelationships(userId, relationships);

    // Calculate confidence distribution
    const confidenceDistribution = {
      '0.0 - 0.2': 0,
      '0.2 - 0.4': 0,
      '0.4 - 0.6': 0,
      '0.6 - 0.8': 0,
      '0.8 - 1.0': 0,
    };

    for (const r of relationships) {
      const conf = r.confidence;
      if (conf < 0.2) confidenceDistribution['0.0 - 0.2']++;
      else if (conf < 0.4) confidenceDistribution['0.2 - 0.4']++;
      else if (conf < 0.6) confidenceDistribution['0.4 - 0.6']++;
      else if (conf < 0.8) confidenceDistribution['0.6 - 0.8']++;
      else confidenceDistribution['0.8 - 1.0']++;
    }

    // Fetch database transitions log.
    // Phase 2 P0-2: GRE no longer writes RelationshipTransition (it writes its
    // own UserGenreRelationshipState table instead). This log now reflects only
    // Layer 6's 10-state transitions, keyed by Territory_v2_* ids — so the
    // `territoryId` field surfaced as `genre` below is a territory id, not a raw
    // genre. GRE's own state is surfaced separately in `genreStateRows`.
    const transitionsLog = await prisma.relationshipTransition.findMany({
      where: { userId },
      orderBy: { timestamp: 'desc' },
      take: 20,
      select: {
        territoryId: true,
        previousState: true,
        currentState: true,
        timestamp: true,
        reasonCodes: true,
      },
    });

    // GRE's own persisted 7-state rows (keyed by raw genre). This is what CUB
    // and GRE compute read after the P0-2 retarget.
    const genreStateRows = await prisma.userGenreRelationshipState.findMany({
      where: { userId },
      select: {
        genre: true,
        currentState: true,
        stateConfidence: true,
        previousStage: true,
        momentum: true,
        lastUpdatedAt: true,
      },
    });

    // Format output separating Internal Heuristic Metrics vs Semantic Outputs
    const formattedRels = relationships.map((r) => ({
      genre: r.genre,
      stage: r.stage,
      // Semantic Outputs (Consumed by frontend and OCSE)
      summary: {
        relationshipStrength: r.summary.relationshipStrength,
        relationshipMomentum: r.summary.relationshipMomentum,
        relationshipBreadth: r.summary.relationshipBreadth,
        relationshipConfidence: r.summary.relationshipConfidence,
      },
      // Internal Heuristic Metrics (Developer only)
      internalMetrics: {
        familiarity: r.metrics.familiarity,
        diversity: r.metrics.diversity,
        identity: r.metrics.identity,
        recency: r.metrics.recency,
        stability: r.metrics.stability,
      },
      confidence: r.confidence,
      history: r.history,
      reasoning: r.reasoning,
    }));

    return NextResponse.json({
      status: 'success',
      generatedAt: new Date().toISOString(),
      userSpotifyId: userId,
      relationshipsCount: formattedRels.length,
      relationships: formattedRels,
      debugStats: {
        confidenceDistribution,
        transitionsHistoryCount: transitionsLog.length,
        transitionsHistory: transitionsLog.map((t: any) => ({
          // Note: post-P0-2 this is a Layer 6 territory id, not a raw genre.
          genre: t.territoryId,
          from: t.previousState,
          to: t.currentState,
          timestamp: t.timestamp,
          reasoning: JSON.parse(t.reasonCodes || '[]'),
        })),
        // GRE's own persisted state (Phase 2 P0-2). Keyed by raw genre.
        genreStateRows,
      },
    });
  } catch (error: any) {
    console.error('[GET /api/debug/genre-relationships] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
