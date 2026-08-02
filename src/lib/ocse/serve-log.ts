/**
 * RecommendationServeLog writer (Change H).
 * Full raw inputs per served surface candidate for later weight recalibration.
 *
 * CRITICAL: schema FK is User.id (cuid), not spotifyId.
 * Pipeline passes spotifyId as userId everywhere — resolve before write.
 *
 * SCHEMA NOTE (four-axis EI): Going forward, `audioDistance` is written as a
 * deprecated sentinel (0) with confidence `dropped_four_axis`. Composite and
 * territory/scene/era/language are live. Pre-change rows may still have real
 * audioDistance values — do not backfill; treat as historical record only.
 */

import { prisma, prismaBase } from '@/lib/prisma';
import type { RecommendationSurface } from './ocse-types';
import type { Candidate } from '@/lib/candidate/cub-types';
import type { ReadinessTier } from '@/lib/readiness/readiness-types';

type ServeLogDelegate = {
  createMany: (args: {
    data: unknown[];
    skipDuplicates?: boolean;
  }) => Promise<{ count: number }>;
  create: (args: { data: unknown }) => Promise<unknown>;
  findUnique: (args: { where: { id: string } }) => Promise<unknown>;
};

function getServeLogDelegate(): ServeLogDelegate | null {
  const fromBase = (prismaBase as unknown as { recommendationServeLog?: ServeLogDelegate })
    .recommendationServeLog;
  if (fromBase && typeof fromBase.create === 'function') return fromBase;

  const fromExt = (prisma as unknown as { recommendationServeLog?: ServeLogDelegate })
    .recommendationServeLog;
  if (fromExt && typeof fromExt.create === 'function') return fromExt;

  return null;
}

/**
 * Resolve pipeline userId (often spotifyId) → User.id for FK.
 */
export async function resolveUserPk(userIdOrSpotify: string): Promise<string | null> {
  if (!userIdOrSpotify) return null;
  // Fast path: already a cuid-shaped primary key
  const byId = await prismaBase.user.findUnique({
    where: { id: userIdOrSpotify },
    select: { id: true },
  });
  if (byId) return byId.id;

  const bySpotify = await prismaBase.user.findUnique({
    where: { spotifyId: userIdOrSpotify },
    select: { id: true },
  });
  if (bySpotify) return bySpotify.id;

  // Some routes pass demo-user / other keys
  const bySpotifyAlt = await prismaBase.user.findFirst({
    where: {
      OR: [{ spotifyId: userIdOrSpotify }, { id: userIdOrSpotify }],
    },
    select: { id: true },
  });
  return bySpotifyAlt?.id ?? null;
}

export async function writeRecommendationServeLogs(opts: {
  userId: string;
  surface: RecommendationSurface;
  candidates: Candidate[];
}): Promise<number> {
  const { surface, candidates } = opts;
  const userPk = await resolveUserPk(opts.userId);
  if (!userPk) {
    console.warn(
      `[serve-log] cannot resolve User PK for "${opts.userId}" — skip write`,
    );
    return 0;
  }

  const byId = new Map(candidates.map((c) => [c.artistId, c]));
  const readinessJson = JSON.stringify(surface.readiness);
  /**
   * Schema still has audioDistance column for historical rows (pre four-axis).
   * New writes store a sentinel + explicit deprecated tag — not a real axis.
   * Do not recompute/backfill old rows.
   */
  const AUDIO_COL_DEPRECATED = 0;
  const AUDIO_CONF_DEPRECATED = 'dropped_four_axis';

  const rows: Array<{
    userId: string;
    artistId: string;
    bucket: string;
    audioDistance: number;
    territoryDistance: number;
    sceneDistance: number;
    eraDistance: number;
    languageDistance: number;
    audioConfidence: string;
    territoryConfidence: string;
    sceneConfidence: string;
    eraConfidence: string;
    languageConfidence: string;
    compositeDistance: number | null;
    decisionScore: number | null;
    readinessStateJson: string;
    scoreComponentsJson: string | null;
  }> = [];

  const pushBucket = (bucket: ReadinessTier) => {
    for (const p of surface[bucket]) {
      const c = byId.get(p.candidateId);
      const d = p.distanceComponents ?? c?.distanceComponents;
      if (!d) {
        rows.push({
          userId: userPk,
          artistId: p.candidateId,
          bucket,
          audioDistance: AUDIO_COL_DEPRECATED,
          territoryDistance: p.expansionDistance ?? 0.5,
          sceneDistance: p.expansionDistance ?? 0.5,
          eraDistance: p.expansionDistance ?? 0.5,
          languageDistance: p.expansionDistance ?? 0.5,
          audioConfidence: AUDIO_CONF_DEPRECATED,
          territoryConfidence: p.confidenceTag ?? 'partial_confidence',
          sceneConfidence: p.confidenceTag ?? 'partial_confidence',
          eraConfidence: p.confidenceTag ?? 'partial_confidence',
          languageConfidence: p.confidenceTag ?? 'partial_confidence',
          compositeDistance: p.expansionDistance ?? null,
          decisionScore: p.decisionScore ?? p.decisionConfidence ?? null,
          readinessStateJson: readinessJson,
          scoreComponentsJson: JSON.stringify({
            tesProxy: p.tesProxy,
            readiness: p.readiness,
            batchDiversity: p.batchDiversity,
            dataConfidence: p.dataConfidence,
            bucketDistanceFit: p.bucketDistanceFit,
            retrievalPath: c?.retrievalPath ?? c?.retrieval_path,
            model: 'four_axis_v1',
          }),
        });
        continue;
      }
      rows.push({
        userId: userPk,
        artistId: p.candidateId,
        bucket,
        audioDistance: AUDIO_COL_DEPRECATED,
        territoryDistance: d.territory_distance.value,
        sceneDistance: d.scene_distance.value,
        eraDistance: d.era_distance.value,
        languageDistance: d.language_distance.value,
        audioConfidence: AUDIO_CONF_DEPRECATED,
        territoryConfidence: d.territory_distance.confidence,
        sceneConfidence: d.scene_distance.confidence,
        eraConfidence: d.era_distance.confidence,
        languageConfidence: d.language_distance.confidence,
        compositeDistance: d.composite,
        decisionScore: p.decisionScore ?? p.decisionConfidence ?? null,
        readinessStateJson: readinessJson,
        scoreComponentsJson: JSON.stringify({
          tesProxy: p.tesProxy,
          readiness: p.readiness,
          batchDiversity: p.batchDiversity,
          dataConfidence: p.dataConfidence,
          bucketDistanceFit: p.bucketDistanceFit,
          retrievalPath: c?.retrievalPath ?? c?.retrieval_path,
          model: 'four_axis_v1',
          compositeConfidence: d.compositeConfidence,
        }),
      });
    }
  };

  pushBucket('comfort');
  pushBucket('expansion');
  pushBucket('leap');

  if (rows.length === 0) return 0;

  const log = getServeLogDelegate();
  if (!log) {
    console.warn(
      '[serve-log] recommendationServeLog missing on Prisma client — run `npx prisma generate` and restart dev server',
    );
    return 0;
  }

  try {
    const result = await log.createMany({ data: rows });
    console.log(
      `[serve-log] wrote ${result.count} rows for userPk=${userPk.slice(0, 12)}… (from ${opts.userId})`,
    );
    return result.count;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[serve-log] createMany failed, trying sequential writes:', msg);
    let n = 0;
    let firstRowErr: unknown = null;
    for (const row of rows) {
      try {
        await log.create({ data: row });
        n++;
      } catch (e) {
        if (!firstRowErr) firstRowErr = e;
      }
    }
    if (n === 0 && firstRowErr) {
      console.warn(
        '[serve-log] sequential writes all failed:',
        firstRowErr instanceof Error ? firstRowErr.message : firstRowErr,
      );
    } else {
      console.log(`[serve-log] sequential wrote ${n}/${rows.length} rows`);
    }
    return n;
  }
}

/** Change H DoD helper: load full serve row by id. */
export async function getServeLogById(id: string) {
  const log = getServeLogDelegate();
  if (!log) return null;
  return log.findUnique({ where: { id } });
}
