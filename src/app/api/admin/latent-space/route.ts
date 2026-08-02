import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  processArtistLatentRepresentation,
  seedTraitDefinitions,
  FUSION_CONFIG,
} from '@/lib/latent/latent-space';
import { getCanonicalArtistName, getCanonicalArtistId } from '@/lib/identity';
import { verifyAdminRequest } from '@/lib/auth/admin-auth';

/**
 * GET /api/admin/latent-space
 * Retrieve database stats about the artist latent space.
 */
export async function GET(req: Request) {
  if (!verifyAdminRequest(req)) {
    return new Response('Unauthorized', { status: 401 });
  }
  try {
    const [
      artistCount,
      embeddingCount,
      traitCount,
      embeddings,
      traits
    ] = await Promise.all([
      prisma.artist.count(),
      prisma.artistEmbedding.count(),
      prisma.traitDefinition.count(),
      prisma.artistEmbedding.findMany({
        select: { confidence: true }
      }),
      prisma.traitDefinition.findMany({
        select: { id: true, family: true, activeFlag: true }
      })
    ]);

    const totalConfidence = embeddings.reduce((sum: number, e: any) => sum + e.confidence, 0);
    const avgConfidence = embeddingCount > 0 ? totalConfidence / embeddingCount : 1.0;

    // Calculate confidence band distribution
    let high = 0;   // >= 0.7
    let medium = 0; // 0.4 to 0.7
    let low = 0;    // < 0.4

    embeddings.forEach((e: any) => {
      if (e.confidence >= 0.7) high++;
      else if (e.confidence >= 0.4) medium++;
      else low++;
    });

    return NextResponse.json({
      artistCount,
      embeddingCount,
      traitCount,
      avgConfidence,
      confidenceDistribution: { high, medium, low },
      traits,
      fusionVersion: FUSION_CONFIG.version,
      normalizationVersion: FUSION_CONFIG.normalizationVersion
    });
  } catch (error: any) {
    console.error('[Latent Space GET] Stats retrieval error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/admin/latent-space
 * Triggers recomputation or seeding of the latent space models.
 * Body parameter: { type: "full" | "partial" | "incremental" }
 */
export async function POST(req: Request) {
  if (!verifyAdminRequest(req)) {
    return new Response('Unauthorized', { status: 401 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const type = body.type || 'incremental';

    const logs: string[] = [];
    logs.push(`[Latent Space Admin] Starting embedding recomputation. Type: ${type}`);

    // Step 1: Seed Trait Definitions in Database
    logs.push('[Latent Space Admin] Seeding trait definitions...');
    await seedTraitDefinitions();
    logs.push('[Latent Space Admin] Seeding finished successfully.');

    // Step 2: Retrieve artists from user globe data (avoiding external network dependencies)
    logs.push('[Latent Space Admin] Gathering artists from users\' globe graphs...');
    const users = await prisma.user.findMany({
      select: { globeData: true }
    });

    const uniqueArtists = new Map<string, any>();

    for (const user of users) {
      if (!user.globeData) continue;
      try {
        const globe = JSON.parse(user.globeData);
        const nodes = globe.nodes || [];
        for (const node of nodes) {
          if (node.id && node.name && node.audioSignature) {
            uniqueArtists.set(node.id, node);
          }
        }
      } catch (e: any) {
        logs.push(`[Latent Space Admin] Failed to parse globeData for a user: ${e.message}`);
      }
    }

    logs.push(`[Latent Space Admin] Found ${uniqueArtists.size} unique artist nodes to process.`);

    // Step 3: Embed artists
    let successCount = 0;
    let failCount = 0;
    let skippedCount = 0;

    for (const [spotifyId, artistNode] of uniqueArtists.entries()) {
      if (type === 'incremental') {
        const canonicalName = getCanonicalArtistName(artistNode.name);
        const canonicalId = getCanonicalArtistId(canonicalName, spotifyId);
        
        const existing = await prisma.artistEmbedding.findUnique({
          where: {
            artistId_embeddingVersion: {
              artistId: canonicalId,
              embeddingVersion: FUSION_CONFIG.version
            }
          }
        });
        if (existing) {
          skippedCount++;
          continue;
        }
      }

      try {
        await processArtistLatentRepresentation({
          spotifyId: artistNode.id,
          name: artistNode.name,
          genres: artistNode.genres || [],
          popularity: artistNode.popularity || 50,
          followers: 0, // Default baseline follower count placeholder
          imageUrl: artistNode.imageUrl || '',
          audioSignature: artistNode.audioSignature,
          bio: undefined // Triggers default text embedding
        });
        successCount++;
      } catch (err: any) {
        failCount++;
        logs.push(`[Latent Space Admin] Failed to embed ${artistNode.name}: ${err.message}`);
      }
    }

    logs.push(`[Latent Space Admin] Recomputation complete. Success: ${successCount}, Failed: ${failCount}, Skipped: ${skippedCount}`);

    return NextResponse.json({
      status: 'success',
      type,
      successCount,
      failCount,
      skippedCount,
      logs
    });
  } catch (error: any) {
    console.error('[Latent Space POST] Recomputation error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
