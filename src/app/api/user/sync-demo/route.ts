/**
 * POST /api/user/sync-demo
 *
 * Dynamic demo globe from selected artist IDs only.
 * Always rebuilds globeData + materializeWorld (taste expansion).
 * No hardcoded demo graph.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  computeNodeCoords,
  buildSpotifyEdges,
  computeHomeRegion,
  generateTasteSummary,
} from '@/lib/spotifySync';
import { normaliseGenre } from '@/lib/graph/genre-normaliser';
import { computeUserProfile } from '@/lib/profile/profile-engine';
import { materializeWorldDeduped } from '@/lib/frontier/materialize-lock';
import type { OrcaNode } from '@/lib/graph/types';
import {
  dedupeArtistsByName,
  enrichAndPersistArtist,
  isWeakImageUrl,
  normalizeArtistName,
  type ArtistRow,
} from '@/lib/artists/enrich-identity';
import { resolveAudioSignature } from '@/lib/audio/resolve-signature';
import { isDemoEnabled } from '@/lib/auth/demo-user';
import { checkRateLimit } from '@/lib/utils/rate-limit-guard';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    // Audit fix H1: demo seeding is unauthenticated by design — gate it behind
    // ENABLE_DEMO (dev only) and it writes exclusively to the demo-user row.
    if (!isDemoEnabled()) {
      return NextResponse.json({ error: 'Demo mode is disabled' }, { status: 403 });
    }

    // Rate limit: full demo rebuild is a ~2min pipeline. 2/min per IP.
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      'unknown-demo-ip';
    const rl = checkRateLimit(`sync-demo:${ip}`, 2);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Demo rebuild in progress. Try again shortly.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      );
    }

    const { artistIds } = await request.json();

    if (!Array.isArray(artistIds) || artistIds.length < 5 || artistIds.length > 20) {
      return NextResponse.json(
        { error: 'You must select between 5 and 20 artists.' },
        { status: 400 },
      );
    }

    // 1. Load selected artists
    let artists = await prisma.artist.findMany({
      where: { id: { in: artistIds } },
    });

    if (artists.length < 5) {
      return NextResponse.json(
        { error: `Only found ${artists.length} valid artists. Minimum 5 required.` },
        { status: 400 },
      );
    }

    type DbArtist = (typeof artists)[number];

    // 2. Dedup by name (prefer higher quality row)
    artists = dedupeArtistsByName(
      artists.map((a: DbArtist) => ({
        ...a,
        displayName: a.displayName,
      })),
    ) as DbArtist[];

    if (artists.length < 5) {
      return NextResponse.json(
        {
          error:
            'After removing duplicate names, fewer than 5 unique artists remain. Select more distinct artists.',
        },
        { status: 400 },
      );
    }

    // 3. Multi-provider enrich each selection (genres + images)
    const enrichedRows: ArtistRow[] = [];
    for (const a of artists) {
      const row = await enrichAndPersistArtist({
        id: a.id,
        spotifyId: a.spotifyId,
        displayName: a.displayName,
        rawGenres: a.rawGenres,
        popularity: a.popularity,
        imageUrl: a.imageUrl,
      });
      enrichedRows.push(row);
    }

    // Reload after persist
    const finalArtists = await prisma.artist.findMany({
      where: { id: { in: enrichedRows.map((r) => r.id) } },
    });

    // 4. Build explored nodes from existing Artist primary keys only.
    // Never remaps id → spotifyId (that created unique constraint collisions
    // when a lastfm-* row and a spotify-id row both exist for the same artist).
    const nodes: OrcaNode[] = finalArtists.map((artist: (typeof finalArtists)[number]) => {
      let genres: string[] = [];
      try {
        genres = JSON.parse(artist.rawGenres || '[]');
      } catch {
        genres = [];
      }

      const nodeId = artist.id;
      const mainGenre = normaliseGenre(genres.length > 0 ? genres : ['pop']);
      const weight = 0.8;
      const [x, y, z] = computeNodeCoords(nodeId, mainGenre, weight);

      const { signature, source: audioSource } = resolveAudioSignature({
        artistId: nodeId,
        genres: genres.length > 0 ? genres : [mainGenre],
        real: null,
      });

      const nodeGenres = genres.length > 0 ? genres : [mainGenre];
      const imageUrl = isWeakImageUrl(artist.imageUrl) ? '' : artist.imageUrl || '';

      return {
        id: nodeId,
        name: artist.displayName,
        genres: nodeGenres,
        popularity: artist.popularity || 50,
        imageUrl,
        weight,
        state: 'explored' as const,
        audioSignature: signature,
        audioSource,
        x,
        y,
        z,
        weightShort: weight,
        weightMedium: weight,
        weightLong: weight,
        frequencyScore: 1.0,
        recencyScore: 1.0,
        persistenceScore: 1.0,
      };
    });

    // Final name dedup on nodes
    const seenNames = new Set<string>();
    const uniqueNodes = nodes.filter((n) => {
      const key = normalizeArtistName(n.name);
      if (seenNames.has(key)) return false;
      seenNames.add(key);
      return true;
    });

    if (uniqueNodes.length < 5) {
      return NextResponse.json(
        { error: 'Could not build 5 unique artists after enrichment.' },
        { status: 400 },
      );
    }

    const edges = buildSpotifyEdges(uniqueNodes);
    const homeRegion = computeHomeRegion(uniqueNodes);
    const tasteSummary = generateTasteSummary(uniqueNodes);
    const profile = computeUserProfile('demo-user', uniqueNodes, 0, null);

    // 5. Clear prior demo relationship state so rebuild is clean
    await prisma.$transaction([
      prisma.userTerritoryRelationship.deleteMany({ where: { userId: 'demo-user' } }),
      prisma.userTerritoryAffinity.deleteMany({ where: { userId: 'demo-user' } }),
      prisma.userArtistMemory.deleteMany({ where: { userId: 'demo-user' } }),
      prisma.exploredArtist.deleteMany({ where: { userId: 'demo-user' } }),
    ]);

    const memoriesData = uniqueNodes.map((node) => ({
      userId: 'demo-user',
      artistId: node.id,
      memoryState: 'INTERNALIZED',
      memoryStrength: 0.8,
      familiarity: 0.8,
      persistence: 0.8,
      agency: 0.8,
      explorationDepth: 0.5,
    }));

    const exploredArtistsData = uniqueNodes.map((node) => ({
      userId: 'demo-user',
      artistId: node.id,
      source: 'SELECT',
    }));

    // Artist rows already exist (selection + enrichAndPersistArtist).
    // Only patch fields on the same primary key — never create a second row
    // with a conflicting unique spotifyId.
    await Promise.all(
      uniqueNodes.map(async (node) => {
        try {
          await prisma.artist.update({
            where: { id: node.id },
            data: {
              displayName: node.name,
              normalizedName: normalizeArtistName(node.name),
              rawGenres: JSON.stringify(node.genres),
              popularity: node.popularity || 50,
              ...(node.imageUrl ? { imageUrl: node.imageUrl } : {}),
            },
          });
        } catch (err) {
          console.warn(`[API sync-demo] artist update skipped for ${node.id}:`, err);
        }
      }),
    );

    await prisma.user.upsert({
      where: { spotifyId: 'demo-user' },
      update: {
        globeData: JSON.stringify({ nodes: uniqueNodes, edges }),
        homeRegion: JSON.stringify(homeRegion),
        tasteSummary,
        lastSyncAt: new Date(),
        syncStatus: 'COMPLETE',
        displayName: 'Demo Explorer',
        avatarUrl: '',
        country: 'US',
        profileData: JSON.stringify(profile),
        profileVersion: profile.version,
        profileComputedAt: new Date(),
        frontierStatus: 'PENDING',
        frontierData: null,
        worldStateData: null,
      },
      create: {
        spotifyId: 'demo-user',
        displayName: 'Demo Explorer',
        syncStatus: 'COMPLETE',
        globeData: JSON.stringify({ nodes: uniqueNodes, edges }),
        homeRegion: JSON.stringify(homeRegion),
        tasteSummary,
        lastSyncAt: new Date(),
        avatarUrl: '',
        country: 'US',
        profileData: JSON.stringify(profile),
        profileVersion: profile.version,
        profileComputedAt: new Date(),
      },
    });

    await prisma.userArtistMemory.createMany({ data: memoriesData });
    await prisma.exploredArtist.createMany({ data: exploredArtistsData });

    // 6. Always recalculate taste expansion for this selection
    console.log(
      `[API sync-demo] Materializing world for demo-user (${uniqueNodes.length} selected artists)…`,
    );
    await materializeWorldDeduped('demo-user', {
      exploredNodes: uniqueNodes,
      accessToken: '',
      fullMaterialization: true,
      // Selection changed above — never accept a cached world from a prior run.
      forceFresh: true,
    });

    return NextResponse.json({
      success: true,
      artistCount: uniqueNodes.length,
      dynamic: true,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    console.error('[API sync-demo] Error building custom demo globe:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
