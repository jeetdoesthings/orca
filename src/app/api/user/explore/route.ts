import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { materializeWorldDeduped } from '@/lib/frontier/materialize-lock';
import { recordRecommendationMemory } from '@/lib/recommendation/memory';
import type { OrcaNode, OrcaEdge } from '@/lib/graph/types';
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const isDemo = url.searchParams.get('demo') === 'true';

    if (isDemo) {
      return NextResponse.json({ status: 'ok' });
    }

    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.spotifyId) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const userId = session.user.spotifyId;
    const accessToken = session.spotifyAccessToken || '';

    const { artistId, action } = await request.json();
    if (!artistId) {
      return NextResponse.json({ error: 'Missing artistId' }, { status: 400 });
    }

    // 1. Record exploration in ExploredArtist database table & load globe/frontier data concurrently
    const [_, user] = await Promise.all([
      prisma.exploredArtist.upsert({
        where: {
          userId_artistId: { userId, artistId },
        },
        update: {
          lastExploredAt: new Date(),
          source: action,
        },
        create: {
          userId,
          artistId,
          source: action,
          exploredAt: new Date(),
          lastExploredAt: new Date(),
        },
      }),
      prisma.user.findUnique({
        where: { spotifyId: userId },
        select: {
          globeData: true,
          frontierData: true,
          frontierComputedAt: true,
        },
      })
    ]);

    if (!user) {
      return NextResponse.json({ error: 'User data not found' }, { status: 404 });
    }

    let nodes: OrcaNode[] = [];
    let edges: OrcaEdge[] = [];
    let frontierNodes: OrcaNode[] = [];

    try {
      if (user.globeData) {
        const parsed = JSON.parse(user.globeData);
        nodes = parsed.nodes || [];
        edges = parsed.edges || [];
      }
      if (user.frontierData) {
        frontierNodes = JSON.parse(user.frontierData) || [];
      }
    } catch (e) {
      console.error('[API explore] JSON parsing error:', e);
    }

    // Check if node is already explored in primary taste graph
    const alreadyExploredIdx = nodes.findIndex(n => n.id === artistId);
    let updatedNodes = [...nodes];

    if (alreadyExploredIdx === -1) {
      // Find the node details in the cached frontier list
      const frontierMatch = frontierNodes.find(n => n.id === artistId);

      if (frontierMatch) {
        const newlyExploredNode: OrcaNode = {
          ...frontierMatch,
          state: 'explored',
          weight: 0.5, // Default weight for manual explorations per specification
        };

        updatedNodes.push(newlyExploredNode);

        // Add a primary genre edge to connect it to an existing node of the same genre
        const matchGenre = newlyExploredNode.genres[0];
        if (matchGenre) {
          const sameGenreNode = nodes.find(n => n.genres[0] === matchGenre);
          if (sameGenreNode) {
            edges.push({
              source: newlyExploredNode.id,
              target: sameGenreNode.id,
              type: 'genre',
              weight: 0.6,
            });
          }
        }
      }
    } else {
      // Node is already explored, make sure its state is set correctly
      updatedNodes[alreadyExploredIdx] = {
        ...updatedNodes[alreadyExploredIdx],
        state: 'explored',
      };
    }

    // 3. Save the permanently updated taste graph back to globeData
    await prisma.user.update({
      where: { spotifyId: userId },
      data: {
        globeData: JSON.stringify({ nodes: updatedNodes, edges }),
      },
    });
    await recordRecommendationMemory({
      userId,
      artistId,
      status: 'opened',
      sourceSnapshot: { route: '/api/user/explore', action },
    });

    // 4. Trigger asynchronous background frontier recalculation with throttling
    let shouldRecompute = false;
    if (!user.frontierComputedAt) {
      shouldRecompute = true;
    } else {
      const timeSinceLastCompute = Date.now() - new Date(user.frontierComputedAt).getTime();
      const tenMinutes = 10 * 60 * 1000;
      if (timeSinceLastCompute > tenMinutes) {
        shouldRecompute = true;
      } else {
        // Count how many artists have been explored since the last computation
        const newExploredCount = await prisma.exploredArtist.count({
          where: {
            userId,
            exploredAt: {
              gt: user.frontierComputedAt,
            },
          },
        });
        if (newExploredCount >= 3) {
          shouldRecompute = true;
        }
      }
    }

    if (shouldRecompute) {
      // Audit fix H2: await the recompute (deduped per user) so it survives
      // serverless; per-artist errors are isolated below.
      await materializeWorldDeduped(userId, { exploredNodes: updatedNodes, accessToken }).catch(err => {
        console.error('[API explore] Background frontier recompute error:', err);
      });
    } else {
      console.log(`[API explore] Throttling frontier recompute for user ${userId}. Last compute was ${user.frontierComputedAt ? (Date.now() - new Date(user.frontierComputedAt).getTime()) / 1000 : 'never'}s ago.`);
    }

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('[API user/explore] POST Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
