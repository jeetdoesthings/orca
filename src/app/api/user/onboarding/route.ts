/**
 * POST /api/user/onboarding — cold-start self-select (Part 10).
 * Body: { genres?: string[], artists?: { id?, name, genres? }[] }
 * Canonical write: seeds identity + profile coldStart flag; client should
 * POST /api/world/regenerate for first frontier.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { applyOnboardingPicks } from '@/lib/identity/cold-start';
import { isDemoEnabled, isDemoScopedUserId } from '@/lib/auth/demo-user';
import { materializeWorld } from '@/lib/frontier/pipeline-runner';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const body = await request.json().catch(() => ({}));
    const isDemo = body.demo === true || request.nextUrl.searchParams.get('demo') === 'true';

    let userKey: string;
    if (isDemo) {
      // Audit fix H1: demo onboarding is gated behind ENABLE_DEMO and accepts
      // only demo-scoped user ids (demo-user / onboard-*), never a real user's
      // spotifyId/cuid (which would overwrite their taste graph).
      if (!isDemoEnabled()) {
        return NextResponse.json({ error: 'Demo mode is disabled' }, { status: 403 });
      }
      const requested = body.userId || `onboard-demo-${Date.now()}`;
      if (!isDemoScopedUserId(requested)) {
        return NextResponse.json({ error: 'Invalid demo userId' }, { status: 400 });
      }
      userKey = requested;
    } else if (session?.user && (session as { user?: { spotifyId?: string; id?: string } }).user) {
      const u = (session as { user: { spotifyId?: string; id?: string } }).user;
      userKey = u.spotifyId || u.id || '';
      if (!userKey) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    } else {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const genres = Array.isArray(body.genres) ? body.genres.map(String) : [];
    const artists = Array.isArray(body.artists) ? body.artists : [];

    if (genres.length === 0 && artists.length === 0) {
      return NextResponse.json(
        { error: 'Pick a few genres or artists (short self-select, not a quiz).' },
        { status: 400 },
      );
    }

    // Resolve to User.id for profile writes
    let userId = userKey;
    const existing = await prisma.user.findFirst({
      where: { OR: [{ id: userKey }, { spotifyId: userKey }] },
      select: { id: true, spotifyId: true },
    });
    if (existing) userId = existing.id;

    const result = await applyOnboardingPicks({
      userId,
      picks: { genres, artists },
    });

    const materialize = body.materialize !== false;
    let materializeStatus: string | undefined;
    if (materialize) {
      const spotifyId =
        existing?.spotifyId ||
        (userKey.startsWith('onboard-') ? userKey : `onboard-${userKey}`);
      try {
        // materializeWorld keys users by spotifyId in many paths
        const u = await prisma.user.findFirst({
          where: { OR: [{ id: userId }, { spotifyId }] },
        });
        const mid = u?.spotifyId || u?.id || userId;
        await materializeWorld(mid, { fullMaterialization: true, sliderValue: 0.55 });
        materializeStatus = 'ok';
      } catch (err) {
        console.warn('[onboarding] materialize failed (identity still saved):', err);
        materializeStatus = 'failed';
      }
    }

    return NextResponse.json({
      ok: true,
      coldStart: true as const,
      message: 'still learning your taste',
      genres: result.genres,
      seedArtistCount: result.artistCount,
      materializeStatus,
    });
  } catch (err) {
    console.error('[onboarding]', err);
    return NextResponse.json({ error: 'Onboarding failed' }, { status: 500 });
  }
}
