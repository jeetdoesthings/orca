/**
 * Multi-provider artist identity enrichment.
 * Fills imageUrl + genres + popularity for popular and long-tail artists.
 *
 * Pipeline (merge best fields; never wipe good data with empty):
 *   1. Spotify (batch-by-id or search) — genres + high-quality images
 *   2. Deezer (primary free bulk images — no API key)
 *   3. Last.fm tags + larger image
 *   4. MusicBrainz → Wikipedia / Wikidata image
 *   5. Wikipedia direct search image
 */

import { prisma } from '@/lib/prisma';
import {
  fetchLastFmArtistInfo,
  fetchSpotifyArtist,
  getSpotifyToken,
} from '@/lib/lastfm';
import { musicbrainzLimiter, wikipediaLimiter } from '@/lib/utils/rate-limiter';
import {
  cleanGenreTags,
  resolveArtistGenres,
} from '@/lib/graph/genre-normaliser';

export type ArtistRow = {
  id: string;
  spotifyId?: string | null;
  displayName: string;
  rawGenres?: string | null;
  popularity?: number | null;
  imageUrl?: string | null;
  normalizedName?: string | null;
};

export type EnrichedIdentity = {
  spotifyId?: string;
  imageUrl: string;
  genres: string[];
  popularity: number;
  sources: string[];
};

export function normalizeArtistName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** True if URL is missing or a useless Last.fm 30px thumb. */
export function isWeakImageUrl(url: string | null | undefined): boolean {
  if (!url || !url.trim()) return true;
  if (url.includes('/i/u/30/')) return true;
  if (url.includes('/i/u/34s/')) return true;
  return false;
}

function parseGenres(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const g = JSON.parse(raw);
    return Array.isArray(g) ? g.filter((x) => typeof x === 'string' && x.length > 0) : [];
  } catch {
    return [];
  }
}

function namesLooselyMatch(a: string, b: string): boolean {
  const na = normalizeArtistName(a);
  const nb = normalizeArtistName(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

function pickBestImage(
  current: string | undefined,
  candidate: string | undefined,
): string {
  if (!candidate) return current || '';
  if (isWeakImageUrl(current)) return candidate;
  if (isWeakImageUrl(candidate)) return current || '';
  // Prefer non-lastfm / larger providers when both ok
  if (current?.includes('lastfm') && !candidate.includes('lastfm')) return candidate;
  return current || candidate;
}

function mergeGenres(
  a: string[],
  b: string[],
  artistName?: string,
): string[] {
  // Prefer first list order (Spotify before Last.fm), drop junk, rank primary.
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const g of [...a, ...b]) {
    const key = g.toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(g);
  }
  const cleaned = cleanGenreTags(merged, artistName);
  const ranked = resolveArtistGenres(cleaned.length ? cleaned : merged, artistName);
  return ranked.length > 0 ? ranked : cleaned;
}

// ── Providers ────────────────────────────────────────────────────────

async function fromSpotifyById(
  spotifyId: string,
): Promise<Partial<EnrichedIdentity> | null> {
  try {
    const token = await getSpotifyToken();
    const res = await fetch(`https://api.spotify.com/v1/artists/${spotifyId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const art = await res.json();
    if (!art?.id) return null;
    const images = art.images || [];
    const imageUrl =
      images.find((img: { width: number }) => img.width >= 150 && img.width <= 640)?.url ??
      images[0]?.url ??
      '';
    return {
      spotifyId: art.id,
      genres: art.genres || [],
      popularity: art.popularity ?? 50,
      imageUrl,
      sources: ['spotify'],
    };
  } catch {
    return null;
  }
}

async function fromSpotifySearch(name: string): Promise<Partial<EnrichedIdentity> | null> {
  try {
    const art = await fetchSpotifyArtist(name);
    if (!art) return null;
    if (!namesLooselyMatch(name, name)) return null; // name is query; trust Spotify top hit loosely
    return {
      spotifyId: art.id,
      genres: art.genres || [],
      popularity: art.popularity ?? 50,
      imageUrl: art.imageUrl || '',
      sources: ['spotify'],
    };
  } catch {
    return null;
  }
}

/** Batch Spotify artist ids (max 50). */
export async function batchSpotifyArtists(
  ids: string[],
): Promise<Map<string, Partial<EnrichedIdentity>>> {
  const map = new Map<string, Partial<EnrichedIdentity>>();
  if (ids.length === 0) return map;
  try {
    const token = await getSpotifyToken();
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      const res = await fetch(
        `https://api.spotify.com/v1/artists?ids=${batch.join(',')}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) continue;
      const data = await res.json();
      for (const art of data.artists || []) {
        if (!art) continue;
        const images = art.images || [];
        const imageUrl =
          images.find((img: { width: number }) => img.width >= 150 && img.width <= 640)
            ?.url ??
          images[0]?.url ??
          '';
        map.set(art.id, {
          spotifyId: art.id,
          genres: art.genres || [],
          popularity: art.popularity ?? 50,
          imageUrl,
          sources: ['spotify'],
        });
      }
    }
  } catch (err) {
    console.warn('[enrich] batchSpotifyArtists failed:', err);
  }
  return map;
}

async function fromLastFm(name: string): Promise<Partial<EnrichedIdentity> | null> {
  try {
    const info = await fetchLastFmArtistInfo(name);
    if (!info) return null;
    const tags = (info.tags?.tag || [])
      .map((t) => t.name?.toLowerCase().trim())
      .filter(Boolean) as string[];
    let popularity = 50;
    if (info.stats?.listeners) {
      const listeners = parseInt(info.stats.listeners, 10);
      if (listeners > 0) {
        popularity = Math.max(10, Math.min(100, Math.round(15 * Math.log10(listeners) - 4)));
      }
    }
    // Prefer largest Last.fm image that is not the 30px thumb
    const images = info.image || [];
    let imageUrl = '';
    for (const size of ['extralarge', 'large', 'medium']) {
      const hit = images.find((im) => im.size === size && im['#text']);
      if (hit?.['#text'] && !isWeakImageUrl(hit['#text'])) {
        imageUrl = hit['#text'];
        break;
      }
    }
    return {
      genres: tags,
      popularity,
      imageUrl,
      sources: ['lastfm'],
    };
  } catch {
    return null;
  }
}

async function fromDeezer(name: string): Promise<Partial<EnrichedIdentity> | null> {
  try {
    const url = `https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const item = data?.data?.[0];
    if (!item?.name || !namesLooselyMatch(name, item.name)) return null;
    // Prefer ~250px big over medium for node textures; xl is large but fine via proxy
    const imageUrl =
      item.picture_big || item.picture_medium || item.picture_xl || item.picture || '';
    if (!imageUrl || imageUrl.includes('artist//')) return null; // empty placeholder
    return {
      imageUrl,
      popularity: item.nb_fan
        ? Math.max(10, Math.min(100, Math.round(12 * Math.log10(item.nb_fan + 1))))
        : undefined,
      sources: ['deezer'],
    };
  } catch {
    return null;
  }
}

/**
 * Best-effort write-back of image/genres onto Artist row by id or name.
 * Used after materialize enrich so the next run is free.
 */
export async function persistArtistImageAndGenres(input: {
  id: string;
  name: string;
  imageUrl?: string | null;
  genres?: string[];
  popularity?: number;
  spotifyId?: string;
}): Promise<void> {
  if (!input.imageUrl && (!input.genres || input.genres.length === 0)) return;
  const norm = normalizeArtistName(input.name);
  try {
    const existing = await prisma.artist.findFirst({
      where: {
        OR: [
          { id: input.id },
          { spotifyId: input.id.startsWith('spotify-') ? input.id.replace(/^spotify-/, '') : input.id },
          { normalizedName: norm },
        ],
      },
      select: { id: true, imageUrl: true, rawGenres: true },
    });
    if (!existing) return;

    const data: {
      imageUrl?: string | null;
      rawGenres?: string;
      popularity?: number;
    } = {};
    if (input.imageUrl && !isWeakImageUrl(input.imageUrl)) {
      if (isWeakImageUrl(existing.imageUrl)) {
        data.imageUrl = input.imageUrl;
      }
    }
    if (input.genres && input.genres.length > 0) {
      let prev: string[] = [];
      try {
        prev = JSON.parse(existing.rawGenres || '[]');
      } catch {
        prev = [];
      }
      if (!Array.isArray(prev) || prev.length === 0) {
        data.rawGenres = JSON.stringify(input.genres);
      }
    }
    if (input.popularity != null && input.popularity > 0) {
      data.popularity = input.popularity;
    }
    if (Object.keys(data).length === 0) return;
    await prisma.artist.update({ where: { id: existing.id }, data });
  } catch {
    /* ignore persist races */
  }
}

async function fromMusicBrainzWiki(name: string): Promise<Partial<EnrichedIdentity> | null> {
  try {
    await musicbrainzLimiter.acquire();
    const searchUrl = `https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(name)}&fmt=json`;
    const searchRes = await fetch(searchUrl, {
      headers: { 'User-Agent': 'MusicOrca/1.0.0 ( local-dev@musicorca.app )' },
    });
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    const artist = searchData?.artists?.[0];
    if (!artist?.name || !namesLooselyMatch(name, artist.name)) return null;

    await musicbrainzLimiter.acquire();
    const detailsUrl = `https://musicbrainz.org/ws/2/artist/${artist.id}?inc=url-rels&fmt=json`;
    const detailsRes = await fetch(detailsUrl, {
      headers: { 'User-Agent': 'MusicOrca/1.0.0 ( local-dev@musicorca.app )' },
    });
    if (!detailsRes.ok) return null;
    const detailsData = await detailsRes.json();
    const relations = detailsData?.relations || [];

    let wikipediaUrl = '';
    let wikidataUrl = '';
    for (const rel of relations) {
      if (rel.type === 'wikipedia' || rel.url?.resource?.includes('wikipedia.org')) {
        wikipediaUrl = rel.url.resource;
      }
      if (rel.type === 'wikidata' || rel.url?.resource?.includes('wikidata.org')) {
        wikidataUrl = rel.url.resource;
      }
    }

    if (wikipediaUrl) {
      const parts = wikipediaUrl.split('/wiki/');
      if (parts.length > 1) {
        const title = decodeURIComponent(parts[1]);
        const wikiApiUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=pageimages&format=json&pithumbsize=320&origin=*`;
        // Audit fix H3: keep Wikipedia/Wikidata calls polite (shared bucket).
        await wikipediaLimiter.acquire();
        const wikiRes = await fetch(wikiApiUrl);
        if (wikiRes.ok) {
          const wikiData = await wikiRes.json();
          const pages = wikiData?.query?.pages || {};
          const pageId = Object.keys(pages)[0];
          const thumbnail = pageId && pages[pageId]?.thumbnail?.source;
          if (thumbnail) {
            return { imageUrl: thumbnail, sources: ['musicbrainz-wikipedia'] };
          }
        }
      }
    }

    if (wikidataUrl) {
      const qid = wikidataUrl.split('/wiki/')[1] || wikidataUrl.split('/entity/')[1];
      if (qid) {
        const wikidataApiUrl = `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${qid}&property=P18&format=json&origin=*`;
        await wikipediaLimiter.acquire();
        const wdRes = await fetch(wikidataApiUrl);
        if (wdRes.ok) {
          const wdData = await wdRes.json();
          const fileName = wdData?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
          if (fileName) {
            return {
              imageUrl: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fileName)}?width=320`,
              sources: ['musicbrainz-wikidata'],
            };
          }
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function fromWikipediaDirect(name: string): Promise<Partial<EnrichedIdentity> | null> {
  try {
    const wikiSearchUrl = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(name + ' musician')}&gsrlimit=1&prop=pageimages&format=json&pithumbsize=320&origin=*`;
    // Audit fix H3: keep Wikipedia/Wikidata calls polite (shared bucket).
    await wikipediaLimiter.acquire();
    const res = await fetch(wikiSearchUrl);
    if (!res.ok) return null;
    const data = await res.json();
    const pages = data?.query?.pages || {};
    const pageId = Object.keys(pages)[0];
    if (!pageId || pageId === '-1') return null;
    const page = pages[pageId];
    const imageUrl = page?.thumbnail?.source;
    if (!imageUrl) return null;
    const cleanTitle = String(page.title || '').replace(/\s*\(.*?\)\s*/g, '');
    if (!namesLooselyMatch(name, cleanTitle) && !namesLooselyMatch(name, page.title || '')) {
      return null;
    }
    return { imageUrl, sources: ['wikipedia'] };
  } catch {
    return null;
  }
}

// ── Core enrich ──────────────────────────────────────────────────────

/**
 * Enrich a single artist identity. Merges providers until genres + image
 * quality bar is met (or all providers exhausted).
 */
export async function enrichArtistIdentity(input: {
  name: string;
  spotifyId?: string | null;
  genres?: string[];
  imageUrl?: string | null;
  popularity?: number | null;
}): Promise<EnrichedIdentity> {
  let genres = [...(input.genres || [])];
  let imageUrl = input.imageUrl || '';
  let popularity = input.popularity ?? 50;
  let spotifyId = input.spotifyId || undefined;
  const sources: string[] = [];

  /** Empty OR lazy default-only pop — re-fetch from Spotify/Last.fm. */
  const isWeakGenreList = (g: string[]) => {
    if (!g || g.length === 0) return true;
    const cleaned = cleanGenreTags(g, input.name);
    if (cleaned.length === 0) return true;
    return cleaned.every((t) => t === 'pop' || t === 'dance pop' || t === 'dance-pop');
  };
  const needsGenres = () => isWeakGenreList(genres);
  const needsImage = () => isWeakImageUrl(imageUrl);

  // 1. Spotify (cleanest genre tags — preferred over Last.fm)
  if (spotifyId) {
    const s = await fromSpotifyById(spotifyId);
    if (s) {
      if (s.genres?.length) genres = mergeGenres(s.genres, genres, input.name);
      imageUrl = pickBestImage(imageUrl, s.imageUrl);
      if (s.popularity != null) popularity = s.popularity;
      if (s.spotifyId) spotifyId = s.spotifyId;
      sources.push(...(s.sources || []));
    }
  }
  if ((needsGenres() || needsImage() || !spotifyId) && input.name) {
    const s = await fromSpotifySearch(input.name);
    if (s) {
      if (s.genres?.length) genres = mergeGenres(s.genres, genres, input.name);
      imageUrl = pickBestImage(imageUrl, s.imageUrl);
      if (s.popularity != null) popularity = Math.max(popularity, s.popularity);
      if (s.spotifyId) spotifyId = s.spotifyId;
      sources.push(...(s.sources || []));
    }
  }

  // 2. Deezer first for bulk images (free, no key, high coverage)
  if (needsImage()) {
    const dz = await fromDeezer(input.name);
    if (dz) {
      imageUrl = pickBestImage(imageUrl, dz.imageUrl);
      if (dz.popularity != null && popularity <= 50) popularity = dz.popularity;
      sources.push(...(dz.sources || []));
    }
  }

  // 3. Last.fm (genres only if still empty/weak; always try image)
  if (needsGenres() || needsImage()) {
    const lf = await fromLastFm(input.name);
    if (lf) {
      if (lf.genres?.length && needsGenres()) {
        genres = mergeGenres(genres, lf.genres, input.name);
      }
      imageUrl = pickBestImage(imageUrl, lf.imageUrl);
      if (lf.popularity != null && popularity <= 50) popularity = lf.popularity;
      sources.push(...(lf.sources || []));
    }
  }

  // 4. MusicBrainz → wiki
  if (needsImage()) {
    const mb = await fromMusicBrainzWiki(input.name);
    if (mb) {
      imageUrl = pickBestImage(imageUrl, mb.imageUrl);
      sources.push(...(mb.sources || []));
    }
  }

  // 5. Wikipedia direct
  if (needsImage()) {
    const wiki = await fromWikipediaDirect(input.name);
    if (wiki) {
      imageUrl = pickBestImage(imageUrl, wiki.imageUrl);
      sources.push(...(wiki.sources || []));
    }
  }

  // Final pass: clean + ranked primary for all consumers
  const resolved = resolveArtistGenres(genres, input.name);

  return {
    spotifyId,
    imageUrl: imageUrl || '',
    genres: resolved.length > 0 ? resolved : genres,
    popularity,
    sources: Array.from(new Set(sources)),
  };
}

/**
 * Persist enrichment onto Artist row. Returns updated fields.
 */
export async function enrichAndPersistArtist(row: ArtistRow): Promise<ArtistRow> {
  const genres = parseGenres(row.rawGenres);
  if (!isWeakImageUrl(row.imageUrl) && genres.length > 0 && row.spotifyId) {
    return row; // already good
  }

  const enriched = await enrichArtistIdentity({
    name: row.displayName,
    spotifyId: row.spotifyId,
    genres,
    imageUrl: row.imageUrl,
    popularity: row.popularity,
  });

  const nextGenres = enriched.genres.length > 0 ? enriched.genres : genres;
  const nextImage = pickBestImage(row.imageUrl || '', enriched.imageUrl);
  const nextSpotify = enriched.spotifyId || row.spotifyId || null;
  const nextPop = enriched.popularity ?? row.popularity ?? 50;

  let safeSpotifyId = nextSpotify;
  if (nextSpotify && nextSpotify !== row.spotifyId) {
    const existing = await prisma.artist.findFirst({
      where: { spotifyId: nextSpotify, id: { not: row.id } },
      select: { id: true },
    });
    if (existing) safeSpotifyId = row.spotifyId ?? null;
  }

  try {
    await prisma.artist.update({
      where: { id: row.id },
      data: {
        spotifyId: safeSpotifyId,
        rawGenres: JSON.stringify(nextGenres),
        imageUrl: nextImage || null,
        popularity: nextPop,
        normalizedName: normalizeArtistName(row.displayName),
      },
    });
  } catch (err) {
    console.warn(`[enrich] persist failed for ${row.displayName}:`, err);
    try {
      await prisma.artist.update({
        where: { id: row.id },
        data: {
          rawGenres: JSON.stringify(nextGenres),
          imageUrl: nextImage || null,
          popularity: nextPop,
        },
      });
    } catch {
      /* ignore */
    }
  }

  return {
    ...row,
    spotifyId: nextSpotify,
    rawGenres: JSON.stringify(nextGenres),
    imageUrl: nextImage || null,
    popularity: nextPop,
  };
}

/** Score for dedup winner selection. */
export function artistQualityScore(row: {
  spotifyId?: string | null;
  rawGenres?: string | null;
  genres?: string[];
  imageUrl?: string | null;
  popularity?: number | null;
}): number {
  const genres = row.genres ?? parseGenres(row.rawGenres);
  let score = 0;
  if (row.spotifyId) score += 100;
  score += Math.min(genres.length, 10) * 5;
  if (!isWeakImageUrl(row.imageUrl)) score += 40;
  score += (row.popularity ?? 0) * 0.1;
  return score;
}

/**
 * Keep one row per normalized display name (highest quality score).
 */
export function dedupeArtistsByName<
  T extends {
    id: string;
    displayName?: string;
    name?: string;
    spotifyId?: string | null;
    rawGenres?: string | null;
    genres?: string[];
    imageUrl?: string | null;
    popularity?: number | null;
  },
>(rows: T[]): T[] {
  const best = new Map<string, T>();
  for (const row of rows) {
    const name = row.displayName || row.name || '';
    const key = normalizeArtistName(name);
    if (!key) continue;
    const existing = best.get(key);
    if (!existing || artistQualityScore(row) > artistQualityScore(existing)) {
      best.set(key, row);
    }
  }
  return Array.from(best.values()).sort((a, b) => {
    const an = (a.displayName || a.name || '').toLowerCase();
    const bn = (b.displayName || b.name || '').toLowerCase();
    return an.localeCompare(bn);
  });
}

/**
 * Strip provider prefixes; return bare Spotify-shaped id or null.
 */
export function bareSpotifyId(raw?: string | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const id = raw.startsWith('spotify-') ? raw.slice('spotify-'.length) : raw;
  if (id.startsWith('lastfm-') || id.startsWith('deezer-') || id.startsWith('musicbrainz-')) {
    return null;
  }
  // Spotify catalog ids are typically 22 base62 chars
  if (/^[0-9A-Za-z]{15,30}$/.test(id)) return id;
  return null;
}

/**
 * Find the best existing Artist row for a name / spotifyId pair.
 * Handles duplicates (lastfm-kanyewest + Spotify PK for the same person).
 */
export async function findBestArtistRow(input: {
  name: string;
  spotifyId?: string | null;
}): Promise<{
  id: string;
  spotifyId: string | null;
  displayName: string;
  normalizedName: string;
  rawGenres: string;
  popularity: number;
  followers: number;
  imageUrl: string | null;
} | null> {
  const sp = bareSpotifyId(input.spotifyId);
  const compact = normalizeArtistName(input.name);
  const spaced = input.name.toLowerCase().trim();
  const lastfmId = `lastfm-${compact}`;

  const or: Array<Record<string, unknown>> = [
    { id: lastfmId },
    { normalizedName: compact },
    { normalizedName: spaced },
  ];
  if (sp) {
    or.push({ id: sp }, { spotifyId: sp });
  }

  const rows = await prisma.artist.findMany({
    where: { OR: or },
    take: 20,
  });

  if (rows.length === 0) return null;

  // Prefer: has this spotifyId as PK/field, then Spotify-shaped id, then most data
  const score = (r: (typeof rows)[0]) => {
    let s = 0;
    if (sp && (r.id === sp || r.spotifyId === sp)) s += 100;
    if (/^[0-9A-Za-z]{15,30}$/.test(r.id) && !r.id.includes('-')) s += 40;
    if (r.spotifyId) s += 20;
    if (r.imageUrl && r.imageUrl.length > 8) s += 10;
    try {
      const g = JSON.parse(r.rawGenres || '[]');
      if (Array.isArray(g) && g.length > 0) s += Math.min(15, g.length * 3);
    } catch {
      /* ignore */
    }
    s += Math.min(10, (r.popularity || 0) / 10);
    return s;
  };

  rows.sort((a: (typeof rows)[0], b: (typeof rows)[0]) => score(b) - score(a));
  return rows[0] ?? null;
}

/**
 * Safe Artist upsert used by Spotify sync latent writes and enrich.
 * Never creates a second row when lastfm-* and Spotify ids already coexist.
 * Primary key stays stable; spotifyId is attached when free.
 */
export async function upsertArtistIdentity(input: {
  name: string;
  spotifyId?: string | null;
  genres?: string[];
  imageUrl?: string | null;
  popularity?: number;
  followers?: number;
}): Promise<{ id: string; spotifyId: string | null }> {
  const sp = bareSpotifyId(input.spotifyId);
  const compact = normalizeArtistName(input.name);
  const lastfmId = `lastfm-${compact}`;
  const genres = input.genres || [];
  const popularity = input.popularity ?? 50;
  const followers = input.followers ?? 0;
  const imageUrl = input.imageUrl || null;

  const existing = await findBestArtistRow({ name: input.name, spotifyId: sp });

  if (existing) {
    // Attach spotifyId only if this row doesn't have one and no other row owns it
    let nextSpotify = existing.spotifyId;
    if (sp && !existing.spotifyId) {
      const taken = await prisma.artist.findFirst({
        where: { OR: [{ spotifyId: sp }, { id: sp }], NOT: { id: existing.id } },
        select: { id: true },
      });
      if (!taken) nextSpotify = sp;
    } else if (sp && existing.spotifyId && existing.spotifyId !== sp) {
      // Keep existing spotifyId; caller may have alias collision
      nextSpotify = existing.spotifyId;
    } else if (sp) {
      nextSpotify = existing.spotifyId || sp;
    }

    const nextGenres =
      genres.length > 0 ? JSON.stringify(genres) : existing.rawGenres || '[]';

    try {
      await prisma.artist.update({
        where: { id: existing.id },
        data: {
          displayName: input.name,
          normalizedName: compact,
          rawGenres: nextGenres,
          popularity: Math.max(existing.popularity || 0, popularity),
          followers: Math.max(existing.followers || 0, followers),
          imageUrl:
            pickBestImage(existing.imageUrl ?? undefined, imageUrl ?? undefined) ||
            null,
          spotifyId: nextSpotify,
        },
      });
    } catch (err) {
      // Unique on spotifyId: update without changing it
      console.warn(`[upsertArtistIdentity] update fallback for ${input.name}:`, err);
      await prisma.artist.update({
        where: { id: existing.id },
        data: {
          displayName: input.name,
          normalizedName: compact,
          rawGenres: nextGenres,
          popularity: Math.max(existing.popularity || 0, popularity),
          imageUrl:
            pickBestImage(existing.imageUrl ?? undefined, imageUrl ?? undefined) ||
            null,
        },
      });
    }
    return { id: existing.id, spotifyId: nextSpotify };
  }

  // Create: prefer Spotify id as PK when available (stable for product graph)
  const newId = sp || lastfmId;
  try {
    await prisma.artist.create({
      data: {
        id: newId,
        spotifyId: sp,
        displayName: input.name,
        normalizedName: compact,
        rawGenres: JSON.stringify(genres),
        popularity,
        followers,
        imageUrl,
      },
    });
    return { id: newId, spotifyId: sp };
  } catch (err) {
    // Race / unique on id or spotifyId — re-find and update
    const again = await findBestArtistRow({ name: input.name, spotifyId: sp });
    if (again) {
      await prisma.artist.update({
        where: { id: again.id },
        data: {
          displayName: input.name,
          normalizedName: compact,
          rawGenres: genres.length > 0 ? JSON.stringify(genres) : again.rawGenres,
          popularity: Math.max(again.popularity || 0, popularity),
          imageUrl:
            pickBestImage(again.imageUrl ?? undefined, imageUrl ?? undefined) ||
            null,
          spotifyId: again.spotifyId || sp,
        },
      });
      return { id: again.id, spotifyId: again.spotifyId || sp };
    }
    throw err;
  }
}

/**
 * Upsert artist by Spotify id or lastfm-normalized id.
 * Handles existing rows keyed differently (lastfm-* vs spotify id) that already
 * hold the same spotifyId unique value.
 */
export async function upsertEnrichedArtist(input: {
  name: string;
  spotifyId?: string;
  genres?: string[];
  imageUrl?: string;
  popularity?: number;
}): Promise<string> {
  const enriched = await enrichArtistIdentity({
    name: input.name,
    spotifyId: input.spotifyId,
    genres: input.genres,
    imageUrl: input.imageUrl,
    popularity: input.popularity,
  });

  const result = await upsertArtistIdentity({
    name: input.name,
    spotifyId: enriched.spotifyId || input.spotifyId,
    genres: enriched.genres.length > 0 ? enriched.genres : input.genres || [],
    imageUrl: pickBestImage(input.imageUrl, enriched.imageUrl),
    popularity: enriched.popularity ?? input.popularity ?? 50,
  });
  return result.id;
}
