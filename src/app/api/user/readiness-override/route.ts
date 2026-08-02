/**
 * POST /api/user/readiness-override
 * Records an explicit Comfort/Expansion/Leap choice for this session.
 * Stored as AgencyInteractionEvent metadata so Readiness Model history can
 * treat it as a real signal (Change B input 2 / Change D).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

const TIERS = new Set(['comfort', 'expansion', 'leap']);

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const body = await req.json().catch(() => ({}));
    const tier = body?.tier as string | undefined;
    if (!tier || !TIERS.has(tier)) {
      return NextResponse.json(
        { error: 'tier must be comfort | expansion | leap' },
        { status: 400 },
      );
    }

    // Audit fix H1: require an authenticated session. The former body.userId
    // fallback let unauthenticated callers write tier overrides (and resolve to
    // demo-user) on arbitrary accounts.
    const spotifyId = (session?.user as { spotifyId?: string } | undefined)?.spotifyId;
    if (!spotifyId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findFirst({
      where: {
        OR: [{ spotifyId }, { id: spotifyId }],
      },
      select: { id: true, spotifyId: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'user not found' }, { status: 404 });
    }

    await prisma.agencyInteractionEvent.create({
      data: {
        userId: user.id,
        interactionType: 'tier_override',
        metadata: JSON.stringify({ tier, at: new Date().toISOString() }),
      },
    });

    return NextResponse.json({ ok: true, tier });
  } catch (err) {
    console.error('[readiness-override]', err);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
