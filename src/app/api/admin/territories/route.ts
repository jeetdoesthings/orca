import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateTasteTerritories } from '@/lib/latent/territory-pipeline';
import { verifyAdminRequest } from '@/lib/auth/admin-auth';

/**
 * GET /api/admin/territories
 * Returns current active version of territories, their member artists, bridges, and similarities.
 */
export async function GET(req: Request) {
  if (!verifyAdminRequest(req)) {
    return new Response('Unauthorized', { status: 401 });
  }
  try {
    // 1. Get latest version of territories in DB
    const latestVersionRecord = await prisma.territory.findFirst({
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    if (!latestVersionRecord) {
      return NextResponse.json({
        message: 'No taste territories have been generated yet. Use POST /api/admin/territories to trigger the pipeline.',
        territories: [],
      });
    }

    const version = latestVersionRecord.version;

    // 2. Fetch all territories, similarities, and bridges of this version in parallel
    const [territories, similarities, bridges] = await Promise.all([
      prisma.territory.findMany({
        where: { version },
        include: {
          memberships: {
            include: {
              artist: {
                select: {
                  displayName: true,
                  popularity: true,
                  imageUrl: true,
                },
              },
            },
          },
        },
      }),
      prisma.territorySimilarity.findMany({
        where: {
          territoryA: { version },
        },
      }),
      prisma.territoryBridge.findMany({
        where: {
          territoryA: { version },
        },
        include: {
          artist: {
            select: {
              displayName: true,
            },
          },
        },
      })
    ]);

    // Format output
    const formattedTerritories = territories.map((t: any) => {
      let meta = {};
      try {
        if (t.metadata) meta = JSON.parse(t.metadata);
      } catch {}

      const members = t.memberships.map((m: any) => ({
        artistId: m.artistId,
        displayName: m.artist.displayName,
        popularity: m.artist.popularity,
        imageUrl: m.artist.imageUrl,
        strength: m.membershipStrength,
        role: m.role,
      })).sort((a: any, b: any) => b.strength - a.strength);

      return {
        id: t.id,
        size: t.size,
        density: t.density,
        cohesion: t.cohesion,
        stability: t.stability,
        metadata: meta,
        members,
      };
    });

    return NextResponse.json({
      version,
      territoriesCount: formattedTerritories.length,
      territories: formattedTerritories,
      similarities: similarities.map((s: any) => ({
        territoryA: s.territoryAId,
        territoryB: s.territoryBId,
        similarity: s.similarity,
        distance: s.distance,
      })),
      bridgesCount: bridges.length,
      bridges: bridges.map((b: any) => ({
        artistId: b.artistId,
        displayName: b.artist.displayName,
        territoryA: b.territoryAId,
        territoryB: b.territoryBId,
        bridgeStrength: b.bridgeStrength,
      })),
    });
  } catch (error: any) {
    console.error('[Territories GET] Failed to retrieve data:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/admin/territories
 * Triggers recomputation of taste territories.
 * Body options: { minConfidence, k, minSimilarity, fuzzyThreshold, coreThreshold }
 */
export async function POST(req: Request) {
  if (!verifyAdminRequest(req)) {
    return new Response('Unauthorized', { status: 401 });
  }
  try {
    const body = await req.json().catch(() => ({}));

    const result = await generateTasteTerritories({
      minConfidence: body.minConfidence,
      k: body.k,
      minSimilarity: body.minSimilarity,
      fuzzyThreshold: body.fuzzyThreshold,
      coreThreshold: body.coreThreshold,
    });

    if (result.version === 0) {
      return NextResponse.json({
        status: 'error',
        message: 'Pipeline aborted. See logs for details.',
        logs: result.logs,
      }, { status: 400 });
    }

    return NextResponse.json({
      status: 'success',
      version: result.version,
      territoryCount: result.territoryCount,
      artistCount: result.artistCount,
      bridgeCount: result.bridgeCount,
      logs: result.logs,
    });
  } catch (error: any) {
    console.error('[Territories POST] Recomputation error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
