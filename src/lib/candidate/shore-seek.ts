/**
 * Shore-seek retrieval — depth inside home territory.
 *
 * Explored seeds → same-scene / same-genre catalog peers that are
 * lesser-known / not already explored. Never outward CUB adjacency.
 *
 * @module candidate/shore-seek
 */

import { prisma } from '@/lib/prisma';
import { ShoreSeekConfig } from '@/lib/config/shore-seek';
import { normaliseGenre } from '@/lib/graph/genre-normaliser';
import type { OrcaNode } from '@/lib/graph/types';
import type { Candidate, DiscoverySourceType } from './cub-types';

export type ShoreRetrievalPath = 'shore_seek';

export interface ShoreSeekOptions {
  /** Artist ids already explored or already in candidate pool */
  excludeIds?: Set<string>;
  /** Normalized names already taken */
  excludeNames?: Set<string>;
  targetCount?: number;
  offlineOnly?: boolean;
}

export interface ShoreSeekResult {
  candidates: Candidate[];
  seedCount: number;
  catalogHits: number;
}

function nameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseGenres(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const g = JSON.parse(raw);
    return Array.isArray(g) ? g.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Retrieve deep cuts / secondary artists within the user's explored scenes.
 */
export async function retrieveShoreSeekCandidates(
  exploredArtists: OrcaNode[],
  opts: ShoreSeekOptions = {},
): Promise<ShoreSeekResult> {
  const target = opts.targetCount ?? ShoreSeekConfig.targetCount;
  const excludeIds = new Set(opts.excludeIds ?? []);
  const excludeNames = new Set(opts.excludeNames ?? []);

  for (const e of exploredArtists) {
    excludeIds.add(e.id);
    excludeNames.add(nameKey(e.name));
  }

  const seeds = [...exploredArtists]
    .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
    .slice(0, ShoreSeekConfig.maxSeeds);

  if (seeds.length === 0) {
    return { candidates: [], seedCount: 0, catalogHits: 0 };
  }

  // Primary genres from seeds (home territory)
  const homeGenres = new Map<string, number>();
  for (const s of seeds) {
    const g = normaliseGenre(s.genres?.length ? s.genres : ['pop']);
    homeGenres.set(g, (homeGenres.get(g) ?? 0) + (s.weight ?? 0.5));
  }
  const topHome = [...homeGenres.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([g]) => g)
    .slice(0, 8);

  // Catalog scan — same genre, lower popularity, not excluded
  const pool = await prisma.artist.findMany({
    where: {
      popularity: { lte: ShoreSeekConfig.maxPeerPopularity },
    },
    select: {
      id: true,
      displayName: true,
      popularity: true,
      rawGenres: true,
      imageUrl: true,
    },
    take: 2500,
  });

  type Hit = {
    id: string;
    name: string;
    genres: string[];
    popularity: number;
    imageUrl: string;
    seedName: string;
    homeGenre: string;
    score: number;
  };

  const hits: Hit[] = [];
  const used = new Set<string>();

  for (const seed of seeds) {
    const seedGenre = normaliseGenre(seed.genres?.length ? seed.genres : ['pop']);
    const seedPop = seed.popularity ?? 50;
    let perSeed = 0;

    for (const row of pool) {
      if (perSeed >= ShoreSeekConfig.maxPerSeed) break;
      if (excludeIds.has(row.id) || used.has(row.id)) continue;
      const nk = nameKey(row.displayName || '');
      if (!nk || excludeNames.has(nk)) continue;

      const genres = parseGenres(row.rawGenres);
      if (genres.length === 0) continue;
      const primary = normaliseGenre(genres);
      // Must sit in home genre cluster
      if (primary !== seedGenre && !topHome.includes(primary)) continue;

      const pop = row.popularity ?? 40;
      // Prefer deep cuts: at or below seed popularity (+ small margin)
      if (pop > seedPop + ShoreSeekConfig.popularityMargin) continue;
      if (pop > ShoreSeekConfig.maxPeerPopularity) continue;

      // Score: same genre as seed > home cluster; lower pop = deeper cut
      const sameAsSeed = primary === seedGenre ? 1 : 0.6;
      const depth = 1 - Math.min(100, pop) / 100;
      const score = sameAsSeed * 0.55 + depth * 0.45;

      hits.push({
        id: row.id,
        name: row.displayName,
        genres,
        popularity: pop,
        imageUrl: row.imageUrl || '',
        seedName: seed.name,
        homeGenre: seedGenre,
        score,
      });
      used.add(row.id);
      perSeed++;
    }
  }

  hits.sort((a, b) => b.score - a.score);
  const selected = hits.slice(0, target);

  const candidates: Candidate[] = selected.map((h) => {
    const sources = [
      {
        type: 'HIDDEN_POTENTIAL' as DiscoverySourceType,
        source: 'Shore-seek catalog depth',
        strength: h.score,
        confidence: ShoreSeekConfig.defaultDiscoveryConfidence,
        metadata: {
          seedArtistName: h.seedName,
          homeGenre: h.homeGenre,
          path: 'shore_seek',
        },
      },
    ];
    return {
      artistId: h.id,
      name: h.name,
      genres: h.genres,
      popularity: h.popularity,
      imageUrl: h.imageUrl,
      discoveryContext: {
        growthOpportunity: h.homeGenre,
        relationshipStage: 'Integrated',
        supportingArtists: [h.seedName],
        sources,
      },
      discoveryConfidence: ShoreSeekConfig.defaultDiscoveryConfidence,
      candidateClassification: 'IDENTITY' as const,
      audioSource: 'tag_inferred' as const,
      confidenceTag: 'tag_inferred' as const,
      retrievalPath: 'shore_seek',
      retrieval_path: 'shore_seek',
      sourceTerritory: h.homeGenre,
      source_territory: h.homeGenre,
    };
  });

  console.log(
    `[shore-seek] seeds=${seeds.length} catalogHits=${hits.length} selected=${candidates.length} home=[${topHome.join(',')}]`,
  );

  return {
    candidates,
    seedCount: seeds.length,
    catalogHits: hits.length,
  };
}

/** Count candidates already under Shore distance bar. */
export function countShoreRange(candidates: Candidate[], max = ShoreSeekConfig.shoreDistanceMax): number {
  return candidates.filter((c) => {
    const d = c.distanceComponents?.composite ?? c.expansionDistance;
    return d != null && Number.isFinite(d) && d < max;
  }).length;
}
