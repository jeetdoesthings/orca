/**
 * POST /api/territory/[key]/reject — territory-wide "not for me" (Part 11).
 * Distinct from artist ignore / track skip.
 * Suppresses territory recommendations for cooldown; feeds OCSE Readiness + GRE.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { recordTerritoryReject } from '@/lib/feedback/territory-reject';
import { materializeWorldDeduped } from '@/lib/frontier/materialize-lock';
import { resolveDemoUser } from '@/lib/auth/demo-user';
export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  try {
    const { key } = await params;
    const url = new URL(request.url);
    const isDemo = url.searchParams.get('demo') === 'true';
    const body = await request.json().catch(() => ({}));

    let userId: string;
    if (isDemo) {
      const demoId = await resolveDemoUser();
      if (!demoId) {
        return NextResponse.json({ error: 'No demo data available' }, { status: 404 });
      }
      userId = demoId;
    } else {
      const session = await getServerSession(authOptions);
      if (!session?.user || !(session as { user?: { spotifyId?: string } }).user?.spotifyId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      userId = (session as { user: { spotifyId: string } }).user.spotifyId;
    }

    if (!key || key === 'undefined') {
      return NextResponse.json({ error: 'territory key required' }, { status: 400 });
    }

    const result = await recordTerritoryReject({
      userId,
      territoryKey: decodeURIComponent(key),
      sourceArtistId: body.artistId ?? null,
    });

    // Rebuild frontier so suppression applies immediately
    if (body.materialize !== false) {
      try {
        await materializeWorldDeduped(userId, { fullMaterialization: true });
      } catch (err) {
        console.warn('[territory reject] materialize failed:', err);
      }
    }

    return NextResponse.json({
      status: 'success',
      action: 'territory_reject',
      territoryKey: result.territoryKey,
      cooldownUntil: result.cooldownUntil.toISOString(),
      suppressed: true,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal error';
    console.error('[territory reject]', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
