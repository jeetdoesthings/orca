/**
 * Catalog hydrate + floor fill + identity centroid helpers.
 * Extracted from buildFrontierNodes for modularity.
 */

import { prisma } from '@/lib/prisma';
import type { OrcaNode, AudioSignature } from '@/lib/graph/types';
import {
  normaliseGenre,
  normaliseGenreOrUnknown,
  resolveArtistGenres,
} from '@/lib/graph/genre-normaliser';
import { GENRE_ADJACENCY } from '@/lib/config/genre-adjacency';
import { ExpansionConfig } from '@/lib/config/expansion';

export interface SpotifyArtistLike {
  id: string;
  name: string;
  genres?: string[];
  popularity: number;
  images: Array<{ url: string; width?: number }>;
}

export type CandidateMapEntry = {
  artist: SpotifyArtistLike;
  adjacentTo: string[];
  discoveryConfidence: number;
  classification: string;
};

// ─── Catalog hydrate + floor fill ─────────────────────────────────────

/**
 * Overlay ORE candidates with local Artist genres/images so empty→pop
 * and missing photos do not survive into the frontier.
 */
export async function hydrateCandidatesFromCatalog(
  candidateMap: Map<
    string,
    {
      artist: SpotifyArtistLike;
      adjacentTo: string[];
      discoveryConfidence: number;
      classification: string;
    }
  >,
  universe: { candidates: Array<{ artistId: string; genres: string[]; imageUrl?: string; popularity?: number }> },
): Promise<void> {
  if (candidateMap.size === 0) return;
  const ids = Array.from(candidateMap.keys());
  // Alphanumeric key so "Toby Keith" matches both "tobykeith" and "toby keith" rows
  const compact = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  const names = Array.from(
    new Set(
      candidateMap.values().flatMap((e) => [
        e.artist.name.toLowerCase().trim(),
        compact(e.artist.name),
      ]),
    ),
  );
  let rows: Array<{
    id: string;
    spotifyId: string | null;
    displayName: string;
    rawGenres: string;
    imageUrl: string | null;
    popularity: number;
    normalizedName: string;
  }> = [];
  try {
    // Broad pull then match in memory — catalog is small and normalizedName
    // variants (with/without spaces) otherwise miss.
    rows = await prisma.artist.findMany({
      where: {
        OR: [
          { id: { in: ids } },
          { spotifyId: { in: ids } },
          { normalizedName: { in: names } },
        ],
      },
      select: {
        id: true,
        spotifyId: true,
        displayName: true,
        rawGenres: true,
        imageUrl: true,
        popularity: true,
        normalizedName: true,
      },
      take: 800,
    });
    // Also fetch by compact name when OR missed spaced variants
    if (rows.length < ids.length) {
      const extra = await prisma.artist.findMany({
        select: {
          id: true,
          spotifyId: true,
          displayName: true,
          rawGenres: true,
          imageUrl: true,
          popularity: true,
          normalizedName: true,
        },
        take: 1200,
      });
      const want = new Set(names.map(compact));
      for (const r of extra) {
        if (want.has(compact(r.displayName)) || want.has(compact(r.normalizedName))) {
          if (!rows.some((x) => x.id === r.id)) rows.push(r);
        }
      }
    }
  } catch (err) {
    console.warn('[CUB Frontier Layout] Catalog hydrate query failed:', err);
    return;
  }

  const byId = new Map<string, (typeof rows)[0]>();
  const byName = new Map<string, (typeof rows)[0]>();
  const scoreRow = (r: (typeof rows)[0]) => {
    let genres: string[] = [];
    try {
      genres = JSON.parse(r.rawGenres || '[]');
    } catch {
      genres = [];
    }
    const onlyPop =
      genres.length > 0 &&
      genres.every((g) => String(g).toLowerCase().trim() === 'pop');
    return (
      (r.imageUrl ? 2 : 0) +
      (genres.length > 0 ? 3 : 0) +
      (onlyPop ? -4 : 0) +
      (r.spotifyId ? 1 : 0) +
      Math.min(2, genres.length / 3)
    );
  };
  for (const r of rows) {
    const prevId = byId.get(r.id);
    if (!prevId || scoreRow(r) > scoreRow(prevId)) byId.set(r.id, r);
    if (r.spotifyId) {
      const prevS = byId.get(r.spotifyId);
      if (!prevS || scoreRow(r) > scoreRow(prevS)) byId.set(r.spotifyId, r);
    }
    const key = compact(r.displayName);
    const prevN = byName.get(key);
    // Prefer higher-quality duplicate (real genres over default pop)
    if (!prevN || scoreRow(r) > scoreRow(prevN)) byName.set(key, r);
  }

  let hydrated = 0;
  for (const [id, entry] of candidateMap) {
    const bare = id.startsWith('spotify-') ? id.replace(/^spotify-/, '') : id;
    // Prefer best-quality match: id hits can be low-quality MB duplicates
    // (e.g. Toby Keith UUID with rawGenres ["pop"] vs Spotify id with country).
    const candidates = [
      byId.get(id),
      byId.get(bare),
      byName.get(compact(entry.artist.name)),
    ].filter(Boolean) as (typeof rows)[0][];
    if (candidates.length === 0) continue;
    let row = candidates[0];
    for (const c of candidates) {
      if (scoreRow(c) > scoreRow(row)) row = c;
    }

    let genres: string[] = [];
    try {
      genres = JSON.parse(row.rawGenres || '[]');
    } catch {
      genres = [];
    }
    if (!Array.isArray(genres)) genres = [];

    // Prefer catalog genres when candidate empty OR candidate is lazy default-pop
    // while catalog has a real primary (ORE used to stamp every neighbor as pop).
    const entryGenres = entry.artist.genres || [];
    const entryOnlyPop =
      entryGenres.length > 0 &&
      entryGenres.every((g) => String(g).toLowerCase().trim() === 'pop');
    const catalogPrimary = normaliseGenreOrUnknown(genres);
    const catalogOnlyPop =
      genres.length > 0 &&
      genres.every((g) => String(g).toLowerCase().trim() === 'pop') &&
      catalogPrimary === 'pop';
    const shouldOverlayGenres =
      genres.length > 0 &&
      (entryGenres.length === 0 ||
        (entryOnlyPop && catalogPrimary && catalogPrimary !== 'pop') ||
        (entryOnlyPop && !catalogOnlyPop && genres.length > 1));

    if (shouldOverlayGenres) {
      entry.artist.genres = resolveArtistGenres(genres, entry.artist.name);
      hydrated++;
    }
    if (!entry.artist.images?.[0]?.url && row.imageUrl) {
      entry.artist.images = [{ url: row.imageUrl }];
    }
    if ((!entry.artist.popularity || entry.artist.popularity <= 0) && row.popularity) {
      entry.artist.popularity = row.popularity;
    }

    // Mirror onto universe.candidates
    const uc = universe.candidates.find((c) => c.artistId === id);
    if (uc) {
      if (shouldOverlayGenres && entry.artist.genres?.length) {
        uc.genres = entry.artist.genres;
      }
      if (!uc.imageUrl && entry.artist.images?.[0]?.url) {
        uc.imageUrl = entry.artist.images[0].url;
      }
    }
  }
  // Strip invented-only-pop from candidates with no catalog row (ORE default).
  // Leaves empty genres → anti-hallucination drops unless enrich fills real tags.
  let stripped = 0;
  for (const [id, entry] of candidateMap) {
    const bare = id.startsWith('spotify-') ? id.replace(/^spotify-/, '') : id;
    const inCatalog =
      byId.has(id) ||
      byId.has(bare) ||
      byName.has(compact(entry.artist.name));
    const g = entry.artist.genres || [];
    const onlyPop =
      g.length > 0 && g.every((x) => String(x).toLowerCase().trim() === 'pop');
    if (onlyPop && !inCatalog) {
      entry.artist.genres = [];
      stripped++;
      const uc = universe.candidates.find((c) => c.artistId === id);
      if (uc) uc.genres = [];
    }
  }

  if (hydrated > 0 || stripped > 0) {
    console.log(
      `[CUB Frontier Layout] Catalog hydrate: genresFixed=${hydrated} strippedInventedPop=${stripped}`,
    );
  }
}

/**
 * When CUB/ORE returns fewer than minFrontier candidates, pull from local
 * Artist table matching seed genres + GENRE_ADJACENCY so demo/empty-token
 * paths still produce a usable unexplored surface.
 */
export async function fillCandidatesFromCatalog(args: {
  candidateMap: Map<
    string,
    {
      artist: SpotifyArtistLike;
      adjacentTo: string[];
      discoveryConfidence: number;
      classification: string;
    }
  >;
  nameToId: Map<string, string>;
  exploredIds: Set<string>;
  exploredNames: Set<string>;
  exploredArtists: OrcaNode[];
  targetCount: number;
}): Promise<void> {
  const {
    candidateMap,
    nameToId,
    exploredIds,
    exploredNames,
    exploredArtists,
    targetCount,
  } = args;

  const seedGenres = new Set<string>();
  for (const a of exploredArtists) {
    for (const g of a.genres || []) seedGenres.add(normaliseGenre([g]));
    if (a.genres?.length) seedGenres.add(normaliseGenre(a.genres));
  }
  const adjacentGenres = new Set<string>(seedGenres);
  for (const g of seedGenres) {
    for (const adj of GENRE_ADJACENCY[g] || []) adjacentGenres.add(adj);
  }

  const seedIds = exploredArtists.map((a) => a.id);
  const need = targetCount - candidateMap.size;
  if (need <= 0) return;

  const pool = await prisma.artist.findMany({
    take: Math.min(1200, need * 10),
    orderBy: { popularity: 'desc' },
    select: {
      id: true,
      displayName: true,
      rawGenres: true,
      popularity: true,
      imageUrl: true,
    },
  });

  // Bucket by primary genre for round-robin diversity (avoid all-pop collapse)
  const buckets = new Map<string, typeof pool>();
  for (const row of pool) {
    if (exploredIds.has(row.id)) continue;
    let genres: string[] = [];
    try {
      genres = JSON.parse(row.rawGenres || '[]');
    } catch {
      genres = [];
    }
    if (!Array.isArray(genres)) genres = [];
    const primary = normaliseGenre(genres.length ? genres : []);
    const genreOk =
      adjacentGenres.size === 0 ||
      adjacentGenres.has(primary) ||
      genres.some((g) => adjacentGenres.has(normaliseGenre([g])));
    if (!genreOk && adjacentGenres.size > 0) continue;
    if (!buckets.has(primary)) buckets.set(primary, []);
    buckets.get(primary)!.push(row);
  }

  const genreKeys = Array.from(buckets.keys());
  let gi = 0;
  let guard = 0;
  while (candidateMap.size < targetCount && genreKeys.length > 0 && guard < need * 20) {
    guard++;
    const gKey = genreKeys[gi % genreKeys.length];
    gi++;
    const bucket = buckets.get(gKey);
    if (!bucket || bucket.length === 0) {
      buckets.delete(gKey);
      const idx = genreKeys.indexOf(gKey);
      if (idx >= 0) genreKeys.splice(idx, 1);
      continue;
    }
    const row = bucket.shift()!;
    const normName = row.displayName.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (exploredNames.has(normName) || nameToId.has(normName)) continue;

    let genres: string[] = [];
    try {
      genres = JSON.parse(row.rawGenres || '[]');
    } catch {
      genres = [];
    }
    if (!Array.isArray(genres) || genres.length === 0) genres = [gKey];
    let genresPrimaryFirst = resolveArtistGenres(genres, row.displayName);
    // If resolve failed but bucket key is a real internal genre, keep it
    if (genresPrimaryFirst.length === 0 && gKey) {
      genresPrimaryFirst = [gKey];
    }

    // 3–7 seed links so edges/explainers have real "because you know" anchors
    const adjacentTo: string[] = [];
    if (seedIds.length > 0) {
      const start = candidateMap.size % seedIds.length;
      const want = Math.min(7, Math.max(3, Math.min(5, seedIds.length)));
      for (let k = 0; k < want; k++) {
        adjacentTo.push(seedIds[(start + k) % seedIds.length]);
      }
    }

    // Spread popularity slightly if DB left them flat
    const pop =
      row.popularity && row.popularity > 0
        ? row.popularity
        : 35 + (Math.abs(row.id.charCodeAt(0) + row.id.length) % 40);

    candidateMap.set(row.id, {
      artist: {
        id: row.id,
        name: row.displayName,
        genres: genresPrimaryFirst,
        popularity: pop,
        images: row.imageUrl ? [{ url: row.imageUrl }] : [],
      },
      adjacentTo,
      discoveryConfidence: 0.55,
      classification: 'EXPANSION',
    });
    nameToId.set(normName, row.id);
  }

  console.log(
    `[CUB Frontier Layout] Catalog fill → ${candidateMap.size} candidates (target ${targetCount})`,
  );
}

// ─── Helpers: user acoustic centroid + genre profile ──────────────────

/**
 * Computes the weighted-average AudioSignature across the user's explored artists.
 * Used as the acoustic anchor for Expansion Intelligence distance calculations.
 */
export function computeUserCentroid(exploredArtists: OrcaNode[]): AudioSignature {
  if (exploredArtists.length === 0) {
    return { energy: 0.5, valence: 0.5, danceability: 0.5, acousticness: 0.5, instrumentalness: 0.5, tempo: 120 };
  }

  let totalWeight = 0;
  const sums = { energy: 0, valence: 0, danceability: 0, acousticness: 0, instrumentalness: 0, tempo: 0 };

  for (const node of exploredArtists) {
    const w = node.weight || 0;
    const sig = node.audioSignature;
    if (!sig) continue;
    sums.energy += sig.energy * w;
    sums.valence += sig.valence * w;
    sums.danceability += sig.danceability * w;
    sums.acousticness += sig.acousticness * w;
    sums.instrumentalness += sig.instrumentalness * w;
    sums.tempo += sig.tempo * w;
    totalWeight += w;
  }

  if (totalWeight === 0) {
    return { energy: 0.5, valence: 0.5, danceability: 0.5, acousticness: 0.5, instrumentalness: 0.5, tempo: 120 };
  }

  return {
    energy: sums.energy / totalWeight,
    valence: sums.valence / totalWeight,
    danceability: sums.danceability / totalWeight,
    acousticness: sums.acousticness / totalWeight,
    instrumentalness: sums.instrumentalness / totalWeight,
    tempo: sums.tempo / totalWeight,
  };
}

/**
 * Builds a genre → normalized weight map from the user's explored artists.
 * Used as the cultural anchor for Expansion Intelligence distance calculations.
 */
export function computeUserGenreProfile(exploredArtists: OrcaNode[]): Map<string, number> {
  const genreWeights = new Map<string, number>();
  let total = 0;

  for (const node of exploredArtists) {
    const w = node.weight || 0;
    for (const genre of node.genres || []) {
      genreWeights.set(genre, (genreWeights.get(genre) ?? 0) + w);
      total += w;
    }
  }

  if (total === 0) return genreWeights;

  // Normalize to sum=1
  for (const [g, w] of genreWeights) {
    genreWeights.set(g, w / total);
  }
  return genreWeights;
}
