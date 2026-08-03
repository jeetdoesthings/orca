export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { resolveDemoUser } from '@/lib/auth/demo-user';
import {
  dedupeArtistsByName,
  enrichAndPersistArtist,
  isWeakImageUrl,
  normalizeArtistName,
  splitCollabName,
  type ArtistRow,
} from '@/lib/artists/enrich-identity';

function parseGenres(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const g = JSON.parse(raw);
    return Array.isArray(g) ? g.filter((x: unknown) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  // Require auth (session or demo mode) — this endpoint triggers external API enrichment.
  const url = new URL(request.url);
  const isDemo = url.searchParams.get('demo') === 'true';
  if (isDemo) {
    const demoId = await resolveDemoUser();
    if (!demoId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  } else {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    // Paginate: cap at 500 per request to avoid unbounded memory.
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '500', 10), 500);

    const dbArtists = await prisma.artist.findMany({
      select: {
        id: true,
        spotifyId: true,
        displayName: true,
        rawGenres: true,
        popularity: true,
        imageUrl: true,
      },
      orderBy: { displayName: 'asc' },
      take: limit,
    });

    // Self-heal: enrich rows missing genres or weak images (cap per request for latency).
    type DbArtist = (typeof dbArtists)[number];
    const needsWork = dbArtists.filter((a: DbArtist) => {
      const genres = parseGenres(a.rawGenres);
      return genres.length === 0 || isWeakImageUrl(a.imageUrl);
    });

    const ENRICH_CAP = 40;
    if (needsWork.length > 0) {
      console.log(
        `[API artists] Enriching up to ${Math.min(ENRICH_CAP, needsWork.length)} / ${needsWork.length} incomplete artists…`,
      );
      const slice = needsWork.slice(0, ENRICH_CAP);
      // Sequential-ish batches of 5 to respect rate limits
      for (let i = 0; i < slice.length; i += 5) {
        const batch = slice.slice(i, i + 5);
        await Promise.all(
          batch.map((a: DbArtist) =>
            enrichAndPersistArtist(a as ArtistRow).catch((err: unknown) => {
              console.warn(`[API artists] enrich failed ${a.displayName}:`, err);
              return a;
            }),
          ),
        );
      }
    }

    const fresh = await prisma.artist.findMany({
      select: {
        id: true,
        spotifyId: true,
        displayName: true,
        rawGenres: true,
        popularity: true,
        imageUrl: true,
      },
      orderBy: { displayName: 'asc' },
      take: limit,
    });

    const withGenres = fresh.map((a: (typeof fresh)[number]) => ({
      id: a.id,
      name: a.displayName,
      displayName: a.displayName,
      spotifyId: a.spotifyId,
      genres: parseGenres(a.rawGenres),
      rawGenres: a.rawGenres,
      popularity: a.popularity,
      imageUrl: a.imageUrl || '',
    }));

    const deduped = dedupeArtistsByName(withGenres);

    // Filter collaboration rows ("21 Savage & Metro Boomin") whose parts
    // already exist as solo artists ("21 Savage") — the collab entry is a
    // feature/duet artifact, not a real artist. Real bands ("Chase & Status")
    // have no solo "Chase" row, so they survive.
    const knownKeys = new Set(deduped.map((a) => normalizeArtistName(a.name || a.displayName || '')));
    const withoutCollabs = deduped.filter((a) => {
      const parts = splitCollabName(a.name || a.displayName || '');
      if (parts.length < 2) return true;
      // Keep unless any part is a known solo artist row.
      return !parts.some((part) => knownKeys.has(normalizeArtistName(part)));
    });

    const formatted = withoutCollabs.map((a) => ({
      id: a.id,
      name: a.name || a.displayName,
      genres: a.genres || parseGenres(a.rawGenres),
      popularity: a.popularity || 50,
      imageUrl: a.imageUrl || '',
    }));

    return NextResponse.json(formatted);
  } catch (error) {
    console.error('[API artists] Error:', error);
    return NextResponse.json({ error: 'Failed to load artists' }, { status: 500 });
  }
}