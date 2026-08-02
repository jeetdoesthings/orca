/**
 * Part 14 — resumable Tier 1 embedding backfill.
 *
 * Usage:
 *   ORCA_EMBEDDING_URL=http://127.0.0.1:8080 npx tsx scripts/backfill-embeddings.ts
 *
 * Skips tracks that already have real_audio for the model. Safe to stop/restart.
 * Checkpoint: .cache/embedding-backfill-checkpoint.json
 */
import fs from 'fs';
import path from 'path';
import { prisma } from '../src/lib/prisma';
import { resolveArtistPreview } from '../src/lib/audio/deezer';
import { getOrComputeTrackEmbedding } from '../src/lib/audio/embedding-cache';
import { DEFAULT_EMBEDDING_MODEL_ID } from '../src/lib/audio/embedder';

const CHECKPOINT = path.join(process.cwd(), '.cache', 'embedding-backfill-checkpoint.json');
const modelId = process.env.ORCA_EMBEDDING_MODEL_ID || DEFAULT_EMBEDDING_MODEL_ID;
const limit = parseInt(process.env.BACKFILL_LIMIT || '50', 10);
const batchSleepMs = parseInt(process.env.BACKFILL_SLEEP_MS || '200', 10);

type Checkpoint = { lastArtistId: string | null; processed: number; skipped: number; failed: number };

function loadCheckpoint(): Checkpoint {
  try {
    return JSON.parse(fs.readFileSync(CHECKPOINT, 'utf8')) as Checkpoint;
  } catch {
    return { lastArtistId: null, processed: 0, skipped: 0, failed: 0 };
  }
}

function saveCheckpoint(cp: Checkpoint) {
  fs.mkdirSync(path.dirname(CHECKPOINT), { recursive: true });
  fs.writeFileSync(CHECKPOINT, JSON.stringify(cp, null, 2));
}

async function main() {
  if (!process.env.ORCA_EMBEDDING_URL && process.env.ORCA_EMBEDDING_ALLOW_MOCK !== '1') {
    console.error('Set ORCA_EMBEDDING_URL (or ORCA_EMBEDDING_ALLOW_MOCK=1 for tests).');
    process.exit(1);
  }

  const cp = loadCheckpoint();
  console.log('[backfill] start', { modelId, limit, checkpoint: cp });

  const artists = await prisma.artist.findMany({
    orderBy: { id: 'asc' },
    take: limit,
    ...(cp.lastArtistId
      ? { where: { id: { gt: cp.lastArtistId } } }
      : {}),
    select: { id: true, displayName: true },
  });

  for (const art of artists) {
    try {
      const preview = await resolveArtistPreview(art.displayName);
      if (!preview?.previewUrl) {
        cp.skipped++;
        cp.lastArtistId = art.id;
        saveCheckpoint(cp);
        continue;
      }

      // Skip if real_audio already cached
      const existing = await prisma.trackEmbedding.findUnique({
        where: {
          trackKey_modelId: { trackKey: preview.trackKey, modelId },
        },
      });
      if (existing?.confidenceTag === 'real_audio') {
        cp.skipped++;
        cp.lastArtistId = art.id;
        saveCheckpoint(cp);
        continue;
      }

      const emb = await getOrComputeTrackEmbedding({
        trackKey: preview.trackKey,
        previewUrl: preview.previewUrl,
        deezerTrackId: preview.deezerTrackId,
        modelId,
      });

      if (emb?.confidenceTag === 'real_audio') {
        cp.processed++;
        console.log(`[backfill] real_audio ${art.displayName} (${preview.trackKey}) cacheHit=${emb.cacheHit}`);
      } else {
        cp.failed++;
        console.warn(`[backfill] no embedding for ${art.displayName}`);
      }
    } catch (err) {
      cp.failed++;
      console.warn(`[backfill] error ${art.displayName}:`, err);
    }
    cp.lastArtistId = art.id;
    saveCheckpoint(cp);
    await new Promise((r) => setTimeout(r, batchSleepMs));
  }

  console.log('[backfill] batch done', cp);
  console.log('[backfill] re-run to continue; delete checkpoint file to restart from beginning');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
