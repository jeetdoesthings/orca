import { prisma } from '@/lib/prisma';
import type { OrcaNode } from '@/lib/graph/types';
import { normaliseGenreOrUnknown } from '@/lib/graph/genre-normaliser';

interface MemoryRow {
  artistId: string;
  memoryState: string;
  memoryStrength: number;
}

interface RecommendationMemoryRow {
  artistId: string;
  status: string;
}

interface ExploredRow {
  artistId: string;
  lastExploredAt: Date;
  source: string;
}

interface ListeningEventRow {
  artistId: string;
  eventType: string;
  timestamp: Date;
  trackId?: string | null;
}

interface TesSnapshotRow {
  artistId?: string | null;
  createdAt: Date;
}

interface ServeLogRow {
  artistId: string;
  decisionScore?: number | null;
}

export interface TasteIdentityArtist {
  id: string;
  name: string;
  genres: string[];
  weight: number;
  source: string;
}

export interface TasteIdentity {
  userId: string;
  homeTerritory: {
    genres: string[];
    primaryGenre?: string;
    country?: string | null;
  };
  exploredTerritory: {
    genres: string[];
    artistCount: number;
  };
  integratedArtists: TasteIdentityArtist[];
  rejectedArtists: TasteIdentityArtist[];
  ignoredArtists: TasteIdentityArtist[];
  expansionHistory: Array<{ artistId: string; at: string; source: string }>;
  listeningHistory: Array<{ artistId: string; eventType: string; at: string; trackId?: string | null }>;
  currentFrontier: TasteIdentityArtist[];
  tasteDrift: {
    recentGenres: string[];
    longTermGenres: string[];
    driftScore: number;
  };
  longTermPreferences: {
    genres: Array<{ genre: string; weight: number }>;
    artists: TasteIdentityArtist[];
  };
}

function parseNodes(raw: string | null | undefined): OrcaNode[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.nodes) ? parsed.nodes : Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function nodeArtist(node: OrcaNode, source: string): TasteIdentityArtist {
  return {
    id: node.id,
    name: node.name,
    genres: node.genres || [],
    weight: node.weight ?? 0,
    source,
  };
}

function rankGenres(nodes: Array<{ genres?: string[]; weight?: number }>): Array<{ genre: string; weight: number }> {
  const scores = new Map<string, number>();
  for (const node of nodes) {
    const w = Math.max(0.05, node.weight ?? 0.2);
    for (const raw of node.genres || []) {
      const genre = normaliseGenreOrUnknown([raw]) || raw.toLowerCase();
      scores.set(genre, (scores.get(genre) ?? 0) + w);
    }
  }
  return Array.from(scores.entries())
    .map(([genre, weight]) => ({ genre, weight: Math.round(weight * 1000) / 1000 }))
    .sort((a, b) => b.weight - a.weight);
}

function uniqueArtists(items: TasteIdentityArtist[]): TasteIdentityArtist[] {
  const byId = new Map<string, TasteIdentityArtist>();
  for (const item of items) {
    const prev = byId.get(item.id);
    if (!prev || item.weight > prev.weight) byId.set(item.id, item);
  }
  return Array.from(byId.values());
}

export async function buildTasteIdentity(
  userId: string,
  exploredArtists?: OrcaNode[],
): Promise<TasteIdentity> {
  const user = await prisma.user.findUnique({
    where: { spotifyId: userId },
    select: {
      id: true,
      spotifyId: true,
      country: true,
      globeData: true,
      profileData: true,
      frontierData: true,
    },
  });
  if (!user) throw new Error(`User not found: ${userId}`);

  const exploredNodes = exploredArtists ?? parseNodes(user.globeData);
  const frontierNodes = parseNodes(user.frontierData);

  const [
    memories,
    exploredRows,
    listeningEvents,
    tesSnapshots,
    serveLogs,
  ] = await Promise.all([
    prisma.userArtistMemory.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    }),
    prisma.exploredArtist.findMany({
      where: { userId },
      orderBy: { lastExploredAt: 'desc' },
      take: 500,
    }),
    prisma.userListeningEvent.findMany({
      where: { userId },
      orderBy: { timestamp: 'desc' },
      take: 300,
    }),
    prisma.tesSnapshot.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.recommendationServeLog.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 300,
    }),
  ]);

  let recommendationMemories: unknown[] = [];
  try {
    recommendationMemories = await prisma.recommendationMemory.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });
  } catch {
    // Table may not exist yet; identity still works without recommendation feedback.
  }

  const nodesById = new Map(exploredNodes.map((n) => [n.id, n]));
  const frontierById = new Map(frontierNodes.map((n) => [n.id, n]));

  const memoryArtist = (artistId: string, source: string, weight = 0.5): TasteIdentityArtist => {
    const node = nodesById.get(artistId) ?? frontierById.get(artistId);
    return node
      ? nodeArtist(node, source)
      : { id: artistId, name: artistId, genres: [], weight, source };
  };

  const integratedFromNodes = exploredNodes.map((n) => nodeArtist(n, 'globeData'));
  const typedMemories = memories as unknown as MemoryRow[];
  const typedRecMemories = recommendationMemories as unknown as RecommendationMemoryRow[];

  const integratedFromMemory = typedMemories
    .filter((m) => ['INTERNALIZED', 'RESIDENT', 'STABILIZED'].includes(m.memoryState))
    .map((m) => memoryArtist(m.artistId, 'UserArtistMemory', m.memoryStrength));
  const ignoredArtists = typedMemories
    .filter((m) => ['DORMANT', 'FORGOTTEN', 'HIDDEN'].includes(m.memoryState))
    .map((m) => memoryArtist(m.artistId, 'UserArtistMemory', 0));
  const rejectedArtists = typedMemories
    .filter((m) => ['REJECTED', 'RESISTANT'].includes(m.memoryState))
    .map((m) => memoryArtist(m.artistId, 'UserArtistMemory', 0));
  const acceptedRecommendationArtists = typedRecMemories
    .filter((m) => ['accepted', 'saved', 'played', 'replayed'].includes(m.status))
    .map((m) => memoryArtist(m.artistId, 'RecommendationMemory', 0.75));
  const ignoredRecommendationArtists = typedRecMemories
    .filter((m) => ['ignored', 'hidden'].includes(m.status))
    .map((m) => memoryArtist(m.artistId, 'RecommendationMemory', 0));
  const rejectedRecommendationArtists = typedRecMemories
    .filter((m) => m.status === 'rejected')
    .map((m) => memoryArtist(m.artistId, 'RecommendationMemory', 0));
  const shownRecommendationArtists = typedRecMemories
    .filter((m) => m.status === 'shown' || m.status === 'opened' || m.status === 'clicked')
    .map((m) => memoryArtist(m.artistId, 'RecommendationMemory', 0.35));

  const genreRanks = rankGenres(exploredNodes);
  const typedExploredRows = exploredRows as unknown as ExploredRow[];
  const typedTesSnapshots = tesSnapshots as unknown as TesSnapshotRow[];
  const typedServeLogs = serveLogs as unknown as ServeLogRow[];
  const typedListeningEvents = listeningEvents as unknown as ListeningEventRow[];
  const recentArtistIds = new Set(typedListeningEvents.slice(0, 80).map((e) => e.artistId));
  const recentGenreRanks = rankGenres(
    exploredNodes.filter((n) => recentArtistIds.has(n.id)),
  );
  const driftScore =
    genreRanks.length === 0
      ? 0
      : Math.min(
          1,
          recentGenreRanks.filter((g) => !genreRanks.slice(0, 5).some((lg) => lg.genre === g.genre)).length /
            Math.max(1, recentGenreRanks.length),
        );

  return {
    userId,
    homeTerritory: {
      genres: genreRanks.slice(0, 10).map((g) => g.genre),
      primaryGenre: genreRanks[0]?.genre,
      country: user.country,
    },
    exploredTerritory: {
      genres: genreRanks.map((g) => g.genre),
      artistCount: exploredNodes.length,
    },
    integratedArtists: uniqueArtists([
      ...integratedFromNodes,
      ...integratedFromMemory,
      ...acceptedRecommendationArtists,
    ]),
    rejectedArtists: uniqueArtists([...rejectedArtists, ...rejectedRecommendationArtists]),
    ignoredArtists: uniqueArtists([...ignoredArtists, ...ignoredRecommendationArtists]),
    expansionHistory: [
      ...typedExploredRows.map((r) => ({
        artistId: r.artistId,
        at: r.lastExploredAt.toISOString(),
        source: r.source,
      })),
      ...typedTesSnapshots.filter((t) => t.artistId).map((t) => ({
        artistId: t.artistId!,
        at: t.createdAt.toISOString(),
        source: 'TesSnapshot',
      })),
    ].slice(0, 400),
    listeningHistory: typedListeningEvents.map((e) => ({
      artistId: e.artistId,
      eventType: e.eventType,
      at: e.timestamp.toISOString(),
      trackId: e.trackId,
    })),
    // currentFrontier = what is ON THE MAP right now (the persisted frontier).
    // Historical shown/served artists are deliberately NOT included: the LLM
    // fallback blocks currentFrontierIds, and an unbounded history (serve logs
    // grow ~100+ rows per materialization) eventually covers the whole
    // candidate pool, starving every future rebuild to ~0 recommendations.
    // Re-surfacing previously-shown artists is desired for taste expansion —
    // grounding + memories still track their accept/ignore status.
    currentFrontier: uniqueArtists(frontierNodes.map((n) => nodeArtist(n, 'frontierData'))),
    tasteDrift: {
      recentGenres: recentGenreRanks.slice(0, 8).map((g) => g.genre),
      longTermGenres: genreRanks.slice(0, 8).map((g) => g.genre),
      driftScore: Math.round(driftScore * 1000) / 1000,
    },
    longTermPreferences: {
      genres: genreRanks.slice(0, 20),
      artists: uniqueArtists(integratedFromNodes)
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 60),
    },
  };
}
