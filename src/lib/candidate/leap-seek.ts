/**
 * Leap-seek retrieval — second CUB path.
 *
 * Home territory → Territory graph far nodes → representative anchors
 * (Last.fm tag tops / iconic seeds / catalog). Never seed-similarity.
 *
 * @module candidate/leap-seek
 */

import { prisma } from '@/lib/prisma';
import { LeapSeekConfig } from '@/lib/config/leap-seek';
import {
  getDefaultTerritoryGraph,
  minTerritorySceneDistance,
} from '@/lib/territory-graph';
import { GENRE_ERA_CENTER } from '@/lib/expansion/cultural-distance';
import { linguisticDistanceFromGenres } from '@/lib/expansion/language-families';
import { normaliseGenre, GENRE_LABELS } from '@/lib/graph/genre-normaliser';
import type { InternalGenre } from '@/lib/graph/genre-normaliser';
import { ICONIC_SEEDS } from '@/lib/lastfm';
import type { Candidate, DiscoverySourceType } from './cub-types';
import type { GenreRelationship } from '@/lib/gre/gre-types';

export type RetrievalPath = 'adjacency' | 'leap_seek' | 'shore_seek';

export interface LeapSeekOptions {
  /** Territory ids targeted in recent materializations (rotation) */
  recentTerritories?: string[];
  /** Extra pass: skip already-tried this session */
  excludeTerritories?: string[];
  /** Cap on territories this call */
  maxTerritories?: number;
  /** Active territory reject keys */
  suppressedTerritories?: string[];
  /** When true, skip Last.fm (tests / offline) */
  offlineOnly?: boolean;
}

export interface LeapSeekResult {
  candidates: Candidate[];
  targetedTerritories: string[];
  farRanking: Array<{ territory: string; farScore: number }>;
}

const ALL_TERRITORIES: string[] = Array.from(
  new Set([
    ...Object.keys(GENRE_ERA_CENTER),
    ...Object.keys(ICONIC_SEEDS),
    ...Object.keys(GENRE_LABELS),
  ]),
);

function safeNorm(g: string): string {
  try {
    return normaliseGenre([g]);
  } catch {
    return g.toLowerCase();
  }
}

/**
 * Infer home genres from GRE + optional seed genre weights.
 */
export function inferHomeTerritories(
  relationships: GenreRelationship[],
  seedGenreWeights?: Map<string, number>,
): string[] {
  const scored: Array<{ g: string; s: number }> = [];
  for (const r of relationships) {
    const g = safeNorm(r.genre);
    const homeish =
      r.stage === 'CORE_IDENTITY' ||
      r.stage === 'INTEGRATED' ||
      r.stage === 'GROWING' ||
      r.stage === 'EXPLORING';
    const s =
      (homeish ? 1 : 0.2) *
      (0.5 * (r.metrics?.identity ?? 0) +
        0.3 * (r.metrics?.familiarity ?? 0) +
        0.2 * (r.metrics?.recency ?? 0));
    scored.push({ g, s });
  }
  if (seedGenreWeights) {
    for (const [g, w] of seedGenreWeights) {
      scored.push({ g: safeNorm(g), s: w });
    }
  }
  scored.sort((a, b) => b.s - a.s);
  const out: string[] = [];
  for (const { g } of scored) {
    if (!out.includes(g)) out.push(g);
    if (out.length >= 5) break;
  }
  if (out.length === 0) out.push('pop');
  return out;
}

/**
 * Rank territory nodes by distance from home (higher = farther leap).
 */
export function rankFarTerritories(
  homeTerritories: string[],
  relationships: GenreRelationship[],
  opts?: {
    recentTerritories?: string[];
    excludeTerritories?: string[];
    suppressedTerritories?: string[];
  },
): Array<{ territory: string; farScore: number }> {
  const w = LeapSeekConfig.farScoreWeights;
  const home = homeTerritories.map(safeNorm);
  const excludeStages = new Set<string>(LeapSeekConfig.excludeGreStages);
  const greByGenre = new Map(relationships.map((r) => [safeNorm(r.genre), r]));
  const recent = new Set((opts?.recentTerritories ?? []).map(safeNorm));
  const excluded = new Set((opts?.excludeTerritories ?? []).map(safeNorm));
  const suppressed = new Set((opts?.suppressedTerritories ?? []).map(safeNorm));

  let graph;
  try {
    graph = getDefaultTerritoryGraph();
  } catch {
    graph = null;
  }

  const ranked: Array<{ territory: string; farScore: number }> = [];

  for (const raw of ALL_TERRITORIES) {
    const t = safeNorm(raw);
    if (home.includes(t)) continue;
    if (excluded.has(t) || suppressed.has(t)) continue;
    const gre = greByGenre.get(t);
    if (gre && excludeStages.has(gre.stage)) continue;

    let territoryDist = 1;
    let sceneDist = 1;
    if (graph) {
      try {
        territoryDist = minTerritorySceneDistance(graph, home, [t]);
        sceneDist = territoryDist;
      } catch {
        territoryDist = 0.8;
        sceneDist = 0.8;
      }
    } else {
      // Fallback: not in home list → mid-high distance
      territoryDist = 0.75;
      sceneDist = 0.75;
    }

    const homeEra =
      home
        .map((h) => GENRE_ERA_CENTER[h])
        .filter((y): y is number => y != null)
        .reduce((a, b, _, arr) => a + b / arr.length, 0) || 2010;
    const tEra = GENRE_ERA_CENTER[t] ?? 2000;
    const eraDist = Math.min(
      1,
      Math.abs(homeEra - tEra) / (LeapSeekConfig.farScoreWeights.era > 0 ? 40 : 40),
    );
    const langDist = linguisticDistanceFromGenres(home, [t]);

    let farScore =
      w.territory * territoryDist +
      w.scene * sceneDist +
      w.era * eraDist +
      w.language * langDist;

    if (recent.has(t)) {
      farScore = Math.max(0, farScore - LeapSeekConfig.recentTargetPenalty);
    }

    if (farScore < LeapSeekConfig.minFarScore) continue;
    ranked.push({ territory: t, farScore });
  }

  ranked.sort((a, b) => b.farScore - a.farScore);
  return ranked;
}

/**
 * Select K territories from far ranking with light diversification (not always top-1).
 */
export function selectTargetTerritories(
  ranking: Array<{ territory: string; farScore: number }>,
  k: number,
): string[] {
  if (ranking.length === 0) return [];
  // Take top 2*k pool, then pick with spacing by farScore rank + hash diversify
  const pool = ranking.slice(0, Math.max(k * 3, k));
  const selected: string[] = [];
  // Always take farthest
  selected.push(pool[0].territory);
  for (const row of pool.slice(1)) {
    if (selected.length >= k) break;
    // Prefer not adjacent-ish labels already chosen (simple string prefix diversify)
    const tooClose = selected.some(
      (s) =>
        s === row.territory ||
        s.split('-')[0] === row.territory.split('-')[0],
    );
    if (tooClose && selected.length < k - 1) continue;
    selected.push(row.territory);
  }
  // Fill if diversified too hard
  for (const row of pool) {
    if (selected.length >= k) break;
    if (!selected.includes(row.territory)) selected.push(row.territory);
  }
  return selected.slice(0, k);
}

/** Last.fm tag → internal key map (shared with seed script spirit) */
const TAG_FOR_TERRITORY: Record<string, string> = {
  'hip-hop': 'hip hop',
  trap: 'trap',
  drill: 'drill',
  edm: 'edm',
  house: 'house',
  techno: 'techno',
  trance: 'trance',
  'drum-and-bass': 'drum and bass',
  pop: 'pop',
  'dance-pop': 'dance pop',
  rock: 'rock',
  'alternative-rock': 'alternative rock',
  'indie-rock': 'indie rock',
  punk: 'punk',
  metal: 'metal',
  rnb: 'rnb',
  soul: 'soul',
  funk: 'funk',
  folk: 'folk',
  country: 'country',
  ambient: 'ambient',
  classical: 'classical',
  jazz: 'jazz',
  latin: 'latin',
  'world-music': 'world',
};

interface AnchorArtist {
  name: string;
  rank: number; // lower = better entry (tag list position)
  playcount?: number;
}

async function fetchLastFmTopForTag(tag: string, limit: number): Promise<AnchorArtist[]> {
  const key = process.env.LASTFM_API_KEY;
  if (!key) return [];
  try {
    const params = new URLSearchParams({
      method: 'tag.gettopartists',
      tag,
      limit: String(limit),
      api_key: key,
      format: 'json',
    });
    const res = await fetch(`https://ws.audioscrobbler.com/2.0/?${params}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const artists = data?.topartists?.artist || [];
    return artists
      .map((a: { name: string; playcount?: string }, i: number) => ({
        name: a.name,
        rank: i,
        playcount: a.playcount ? parseInt(a.playcount, 10) : undefined,
      }))
      .filter((a: AnchorArtist) => !!a.name);
  } catch {
    return [];
  }
}

/**
 * Representative anchors for a territory — never seed-similarity.
 * Quality bar: prefer list order (in-tag recognition) + grounded name.
 */
export async function getAnchorsForTerritory(
  territory: string,
  opts?: { offlineOnly?: boolean },
): Promise<AnchorArtist[]> {
  const t = safeNorm(territory);
  const max = LeapSeekConfig.maxAnchorsPerTerritory;
  const min = LeapSeekConfig.minAnchorsPerTerritory;

  // 1) Cached Artist rows for this primary genre
  let cached: AnchorArtist[] = [];
  try {
    const rows = await prisma.artist.findMany({
      where: {
        OR: [
          { rawGenres: { contains: t } },
          { rawGenres: { contains: `"${t}"` } },
        ],
      },
      take: 40,
      select: {
        displayName: true,
        popularity: true,
        rawGenres: true,
        sourceEvidence: true,
      },
      orderBy: { popularity: 'desc' },
    });
    cached = rows
      .filter((r: { rawGenres: string | null }) => {
        try {
          const g: string[] = JSON.parse(r.rawGenres || '[]');
          return g.some((x) => safeNorm(x) === t);
        } catch {
          return false;
        }
      })
      .map(
        (
          r: { displayName: string; popularity: number | null },
          i: number,
        ) => ({
          name: r.displayName,
          rank: i,
          playcount: r.popularity ?? 0,
        }),
      );
  } catch {
    cached = [];
  }

  // 2) Live Last.fm tag tops
  let live: AnchorArtist[] = [];
  if (!opts?.offlineOnly) {
    const tag = TAG_FOR_TERRITORY[t] || t.replace(/-/g, ' ');
    live = await fetchLastFmTopForTag(tag, max * 2);
  }

  // 3) Iconic seeds — stable representatives
  const iconic = (ICONIC_SEEDS[t] || []).map((name, i) => ({
    name,
    rank: i,
    playcount: 1000 - i * 10,
  }));

  // Merge: Last.fm first (best entry), then iconic, then catalog
  const seen = new Set<string>();
  const merged: AnchorArtist[] = [];
  const push = (list: AnchorArtist[]) => {
    for (const a of list) {
      const k = a.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!k || seen.has(k)) continue;
      seen.add(k);
      merged.push(a);
    }
  };
  push(live);
  push(iconic);
  push(cached);

  // Quality: keep min–max, prefer low rank
  merged.sort((a, b) => a.rank - b.rank || (b.playcount ?? 0) - (a.playcount ?? 0));
  const slice = merged.slice(0, Math.max(min, Math.min(max, merged.length)));
  return slice;
}

function leapSeekId(name: string, territory: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 40);
  return `leap-${safeNorm(territory)}-${slug || 'unknown'}`;
}

/**
 * Main entry: retrieve leap_seek candidates for a user.
 */
export async function retrieveLeapSeekCandidates(
  userId: string,
  relationships: GenreRelationship[],
  opts?: LeapSeekOptions,
): Promise<LeapSeekResult> {
  // Build seed genre weights from GRE + DB if needed
  const home = inferHomeTerritories(relationships);
  const ranking = rankFarTerritories(home, relationships, {
    recentTerritories: opts?.recentTerritories,
    excludeTerritories: opts?.excludeTerritories,
    suppressedTerritories: opts?.suppressedTerritories,
  });

  const k = opts?.maxTerritories ?? LeapSeekConfig.territoriesPerPass;
  const targets = selectTargetTerritories(ranking, k);
  const candidates: Candidate[] = [];
  const existingNames = new Set<string>();

  for (const territory of targets) {
    const anchors = await getAnchorsForTerritory(territory, {
      offlineOnly: opts?.offlineOnly,
    });
    for (const anchor of anchors) {
      const nameKey = anchor.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (existingNames.has(nameKey)) continue;
      existingNames.add(nameKey);

      // Prefer existing Artist id when name matches
      let artistId = leapSeekId(anchor.name, territory);
      let imageUrl = '';
      let popularity = Math.max(20, 70 - anchor.rank * 5);
      try {
        const row = await prisma.artist.findFirst({
          where: {
            OR: [
              { displayName: { equals: anchor.name } },
              {
                normalizedName: anchor.name.toLowerCase().trim(),
              },
            ],
          },
          select: { id: true, imageUrl: true, popularity: true, rawGenres: true },
        });
        if (row) {
          artistId = row.id;
          imageUrl = row.imageUrl || '';
          popularity = row.popularity || popularity;
        } else {
          // Upsert lightweight catalog row for grounding
          await prisma.artist.upsert({
            where: { id: artistId },
            update: {
              popularity,
              sourceEvidence: JSON.stringify({
                leapAnchor: true,
                territory,
                fetchedAt: new Date().toISOString(),
              }),
            },
            create: {
              id: artistId,
              displayName: anchor.name,
              normalizedName: anchor.name.toLowerCase().trim(),
              rawGenres: JSON.stringify([territory]),
              popularity,
              followers: 0,
              imageUrl: null,
              sourceEvidence: JSON.stringify({
                leapAnchor: true,
                territory,
                fetchedAt: new Date().toISOString(),
              }),
            },
          });
        }
      } catch {
        // continue without DB
      }

      candidates.push({
        artistId,
        name: anchor.name,
        genres: [territory],
        popularity,
        imageUrl,
        discoveryContext: {
          growthOpportunity: territory,
          relationshipStage: 'Untouched',
          supportingArtists: [],
          sources: [
            {
              type: 'LEAP_SEEK' as DiscoverySourceType,
              source: 'leap_seek_territory_anchor',
              strength: 0.75,
              confidence: LeapSeekConfig.defaultDiscoveryConfidence,
              metadata: {
                source_territory: territory,
                retrieval_path: 'leap_seek',
                anchorRank: anchor.rank,
              },
            },
          ],
        },
        discoveryConfidence: LeapSeekConfig.defaultDiscoveryConfidence,
        candidateClassification: 'DISCOVERY',
        audioSource: 'tag_inferred',
        confidenceTag: 'tag_inferred',
        retrievalPath: 'leap_seek',
        sourceTerritory: territory,
        retrieval_path: 'leap_seek',
        source_territory: territory,
      });
    }
  }

  console.log(
    `[leap-seek] user=${userId} home=${home.join(',')} targets=${targets.join(',')} candidates=${candidates.length}`,
  );

  return {
    candidates,
    targetedTerritories: targets,
    farRanking: ranking.slice(0, 20),
  };
}

/** Human territory label for narratives */
export function territoryDisplayName(territory: string): string {
  const t = safeNorm(territory) as InternalGenre;
  return (GENRE_LABELS as Record<string, string>)[t] || territory.replace(/-/g, ' ');
}
