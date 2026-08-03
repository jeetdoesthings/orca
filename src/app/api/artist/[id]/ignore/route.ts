import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { recordRecommendationMemory } from '@/lib/recommendation/memory';
import { resolveDemoUser } from '@/lib/auth/demo-user';
export const maxDuration = 300;

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

      // Set memoryState to 'DORMANT' as representation of ignore
      await prisma.userArtistMemory.upsert({
        where: { userId_artistId: { userId, artistId: id } },
        create: {
          userId,
          artistId: id,
          memoryState: 'DORMANT',
          memoryStrength: 0.0,
          familiarity: 0.0,
          agency: 0.0,
          explorationDepth: 0.0,
          persistence: 0.0
        },
        update: {
          memoryState: 'DORMANT',
          memoryStrength: 0.0
        }
      });
      await recordRecommendationMemory({
        userId,
        artistId: id,
        status: 'ignored',
        sourceSnapshot: { route: '/api/artist/[id]/ignore' },
      });

      // Update User globeData nodes to remove this ignored artist!
      const dbUserRecord = await prisma.user.findUnique({
        where: { spotifyId: userId },
        select: { globeData: true }
      });
      if (dbUserRecord?.globeData) {
        try {
          const globe = JSON.parse(dbUserRecord.globeData);
          globe.nodes = (globe.nodes || []).filter((n: any) => n.id !== id);
          await prisma.user.update({
            where: { spotifyId: userId },
            data: { globeData: JSON.stringify(globe) }
          });
        } catch (e) {
          console.error('Failed to update user globeData on ignore:', e);
        }
      }

      // Trigger world state regeneration
      const { materializeWorldDeduped } = await import('@/lib/frontier/materialize-lock');
      await materializeWorldDeduped(userId, { fullMaterialization: true });

      return NextResponse.json({
        status: 'success',
        artistId: id,
        ignored: true
      });

    } catch (error: any) {
      console.error('[POST /api/artist/[id]/ignore] Error:', error);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
