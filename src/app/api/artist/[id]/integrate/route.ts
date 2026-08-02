import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { recordRecommendationMemory } from '@/lib/recommendation/memory';
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

      // Upsert UserArtistMemory
      await prisma.userArtistMemory.upsert({
        where: { userId_artistId: { userId, artistId: id } },
        create: {
          userId,
          artistId: id,
          memoryState: 'INTERNALIZED',
          memoryStrength: 1.0,
          familiarity: 1.0,
          agency: 1.0,
          explorationDepth: 1.0,
          persistence: 1.0
        },
        update: {
          memoryState: 'INTERNALIZED',
          memoryStrength: 1.0,
          familiarity: 1.0
        }
      });
      await recordRecommendationMemory({
        userId,
        artistId: id,
        status: 'accepted',
        sourceSnapshot: { route: '/api/artist/[id]/integrate' },
      });

      // Create ExploredArtist record
      await prisma.exploredArtist.upsert({
        where: { userId_artistId: { userId, artistId: id } },
        create: {
          userId,
          artistId: id,
          source: 'mark-explored'
        },
        update: {}
      });

      // Update User globeData nodes to include this newly integrated artist!
      const dbUserRecord = await prisma.user.findUnique({
        where: { spotifyId: userId },
        select: { globeData: true }
      });
      if (dbUserRecord?.globeData) {
        try {
          const globe = JSON.parse(dbUserRecord.globeData);
          const nodes = globe.nodes || [];
          if (!nodes.some((n: any) => n.id === id)) {
            const dbArtist = await prisma.artist.findUnique({ where: { id } });
            nodes.push({
              id,
              name: dbArtist?.displayName || id,
              genres: dbArtist?.rawGenres ? JSON.parse(dbArtist.rawGenres) : ['pop'],
              weight: 1.0,
              x: 0.5, y: 0.5, z: 0.5
            });
            globe.nodes = nodes;
            await prisma.user.update({
              where: { spotifyId: userId },
              data: { globeData: JSON.stringify(globe) }
            });
          }
        } catch (e) {
          console.error('Failed to update user globeData on integration:', e);
        }
      }

      // Trigger world state regeneration
      const { materializeWorld } = await import('@/lib/frontier/pipeline-runner');
      await materializeWorld(userId, { fullMaterialization: true });

      return NextResponse.json({
        status: 'success',
        artistId: id,
        integrated: true
      });

    } catch (error: any) {
      console.error('[POST /api/artist/[id]/integrate] Error:', error);
      return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
