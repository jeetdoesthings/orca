import { prisma } from '@/lib/prisma';
import { normaliseGenre } from '@/lib/graph/genre-normaliser';
import { GreConfig } from '../config/gre';
import { SYSTEM_GENRES } from '../config/genre-adjacency';
import type {
  GenreRelationship,
  GenreRelationshipState,
  GenreRelationshipMetrics,
  GenreRelationshipSummary,
  GenreRelationshipHistory,
} from './gre-types';
import { applyGreTransition, normalizeGreState } from './transitions';
import { getTerritoryRejectFlags } from '@/lib/feedback/territory-reject';

/**
 * Computes the complete Genre Relationships snapshot for a user.
 * Performs zero database writes. Reads configuration from GreConfig.
 */
export async function computeGenreRelationships(userIdOrSpotifyId: string): Promise<GenreRelationship[]> {
  console.log(`[GRE] Computing genre relationships for user: ${userIdOrSpotifyId}`);

  const cfg = GreConfig;

  // Resolve user once: tables are split between User.id (cuid) and User.spotifyId keys.
  const user = await prisma.user.findFirst({
    where: { OR: [{ id: userIdOrSpotifyId }, { spotifyId: userIdOrSpotifyId }] },
    select: { id: true, spotifyId: true },
  });
  const userId = user?.id ?? userIdOrSpotifyId;
  const userSpotifyId = user?.spotifyId ?? userIdOrSpotifyId;

  // 1. Fetch Listening History, Memories, Affinities, and Momentum
  // Phase 2 P0-2: GRE reads its own persisted state from UserGenreRelationshipState
  // (keyed by raw genre) rather than userTerritoryRelationship (now Layer-6-only,
  // keyed by Territory_v2_*). See decisions/gre-vs-layer6.md.
  const [listens, memories, affinities, momentums, existingRels, territoryRejectFlags] =
    await Promise.all([
      prisma.userListeningEvent.findMany({ where: { userId } }),
      prisma.userArtistMemory.findMany({ where: { userId: userSpotifyId } }),
      prisma.userTerritoryAffinity.findMany({ where: { userId } }),
      prisma.territoryMomentum.findMany({ where: { userId } }),
      prisma.userGenreRelationshipState.findMany({ where: { userId: userSpotifyId } }),
      getTerritoryRejectFlags(userIdOrSpotifyId).catch(() => new Set<string>()),
    ]);

  // Load all artists to check genres
  const dbArtists = await prisma.artist.findMany({
    select: { id: true, rawGenres: true },
  });

  const artistGenreMap = new Map<string, string[]>();
  for (const art of dbArtists) {
    try {
      const genres: string[] = JSON.parse(art.rawGenres || '[]');
      artistGenreMap.set(art.id, genres.map((g) => normaliseGenre([g])));
    } catch {
      artistGenreMap.set(art.id, []);
    }
  }

  const results: GenreRelationship[] = [];

  for (const genre of SYSTEM_GENRES) {
    // Filter listens and memories for this genre
    const genreListens = listens.filter((l: any) => {
      const artGenres = artistGenreMap.get(l.artistId) || [];
      return artGenres.includes(genre);
    });

    const genreMemories = memories.filter((m: any) => {
      const artGenres = artistGenreMap.get(m.artistId) || [];
      return artGenres.includes(genre);
    });

    // ── Metrics Calculation ──

    // 1. Genre-level exposure (GRE stage calibration only).
    // NOT Part 2 priorFamiliarity (artist/track plays/(plays+k) pre-rec).
    // NOT Durability (post-rec return behavior — TEM / Part 6).
    const listenCount = genreListens.length;
    const memoryCount = genreMemories.length;
    const uniqueExploredCount = new Set(genreListens.map((l: any) => l.artistId)).size;
    const familiarity = Math.min(
      1.0,
      listenCount * cfg.familiarityListenWeight +
      memoryCount * cfg.familiarityMemoryWeight +
      uniqueExploredCount * cfg.familiarityUniqueWeight
    );

    // 2. Diversity: logarithmic stream concentration check
    const listensPerArtist: Record<string, number> = {};
    for (const l of genreListens) {
      listensPerArtist[(l as any).artistId] = (listensPerArtist[(l as any).artistId] || 0) + 1;
    }
    const uniqueArtistsCount = Object.keys(listensPerArtist).length;
    const diversity =
      listenCount > 0
        ? Math.min(1.0, uniqueArtistsCount / Math.max(1, Math.log2(listenCount + 1) * cfg.diversityBaseLogMultiplier))
        : 0.0;

    // 3. Identity Contribution
    const affinity = affinities.find((a: any) => a.territoryId === genre);
    const compatScore = affinity?.compatibilityScore || 0.45;
    const avgMemoryPersistence =
      genreMemories.length > 0
        ? genreMemories.reduce((acc: number, m: any) => acc + (m.persistence || 0.5), 0) / genreMemories.length
        : 0.0;
    const identity = Math.min(1.0, compatScore * cfg.identityCompatibilityWeight + avgMemoryPersistence * cfg.identityMemoryWeight);

    // 4. Recency: check last playback days since now
    let recency = 0.0;
    let daysSinceLast = 999;
    if (genreListens.length > 0) {
      const lastListen = Math.max(...genreListens.map((l: any) => new Date(l.timestamp).getTime()));
      daysSinceLast = (Date.now() - lastListen) / (1000 * 60 * 60 * 24);
      recency = Math.min(1.0, Math.exp(-daysSinceLast / cfg.recencyHalfLifeDays));
    }

    // 5. Stability: velocity and delta analysis
    const momentum = momentums.find((m: any) => m.territoryId === genre);
    const velocity = momentum?.velocity || 0.0;
    const delta = momentum?.delta || 0.0;
    const stability = Math.min(
      1.0,
      Math.max(0.0, cfg.stabilityBaseOffset + velocity * cfg.stabilityVelocityWeight + delta * cfg.stabilityDeltaWeight)
    );

    const metrics: GenreRelationshipMetrics = {
      familiarity: Math.round(familiarity * 100) / 100,
      diversity: Math.round(diversity * 100) / 100,
      identity: Math.round(identity * 100) / 100,
      recency: Math.round(recency * 100) / 100,
      stability: Math.round(stability * 100) / 100,
    };

    // ── Part 8: transition-gated stage assignment ──
    // Phase 2 P0-2: lookup keyed by `genre` (UserGenreRelationshipState) not `territoryId`.
    const existing = existingRels.find((r: any) => r.genre === genre);
    const prevDBState = existing?.currentState || 'UNTUCHED';
    const previousStage = normalizeGreState(prevDBState);

    const daysInStage = existing?.lastUpdatedAt
      ? (Date.now() - new Date(existing.lastUpdatedAt).getTime()) / (1000 * 60 * 60 * 24)
      : 0;

    const transition = applyGreTransition({
      previous: previousStage,
      metrics: {
        familiarity: Math.round(familiarity * 100) / 100,
        diversity: Math.round(diversity * 100) / 100,
        identity: Math.round(identity * 100) / 100,
        recency: Math.round(recency * 100) / 100,
        stability: Math.round(stability * 100) / 100,
      },
      context: {
        daysInCurrentStage: daysInStage,
        // Part 11: territory-wide reject pushes toward REDISCOVER
        territoryWideReject: territoryRejectFlags.has(genre),
      },
    });
    const stage: GenreRelationshipState = transition.stage;
    const reasoning: string[] = [transition.reason];

    // Confidence mapping — P1-3: configurable floor/ceiling.
    // The spec's theoretical range is [0.0, 1.0]; we apply the floor only
    // to regimes with zero signal, never compressing the upper-mid range.
    const cw = cfg.confidenceWeights;
    const confidence = Math.min(
      cfg.confidenceCeiling,
      Math.max(cfg.confidenceFloor, cw.identity * identity + cw.familiarity * familiarity + cw.stability * stability)
    );

    // ── Semantic Relationship Summary ──
    const summary: GenreRelationshipSummary = {
      relationshipStrength: Math.round(((familiarity + identity) / 2) * 100) / 100,
      relationshipMomentum: Math.round(((recency + stability) / 2) * 100) / 100,
      relationshipBreadth: Math.round(diversity * 100) / 100,
      relationshipConfidence: Math.round(confidence * 100) / 100,
    };

    // ── Historical Transition Mapping (GRE 7-state vocabulary) ──
    let history: GenreRelationshipHistory | undefined;

    if (existing) {
      // Phase 2 P0-2: UserGenreRelationshipState exposes lastUpdatedAt (no
      // enteredAt column). Use it as the stage-entry timestamp proxy.
      const enteredAt = new Date(existing.lastUpdatedAt).getTime();
      history = {
        previousStage: previousStage,
        currentStage: stage,
        enteredAt: new Date(existing.lastUpdatedAt).toISOString(),
        lastUpdated: new Date().toISOString(),
        stageDurationMs: Date.now() - enteredAt,
      };
    } else {
      history = {
        previousStage: null,
        currentStage: stage,
        enteredAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        stageDurationMs: 0,
      };
    }

    results.push({
      genre,
      stage,
      metrics,
      summary,
      confidence: Math.round(confidence * 100) / 100,
      history,
      reasoning,
    });
  }

  return results;
}
