/**
 * Deezer public API client (Tier 1 preview sourcing — Backend Fix Part 1).
 *
 * No auth required for search / track / artist lookups.
 * Used to obtain 30s preview URLs for embedding computation.
 * Rate-limited via deezerLimiter.
 */

import { deezerLimiter } from '@/lib/utils/rate-limiter';

const DEEZER_BASE = 'https://api.deezer.com';

export interface DeezerTrackHit {
  deezerTrackId: string;
  title: string;
  artistName: string;
  previewUrl: string | null;
  durationSec: number;
  /** Stable cache key for TrackEmbedding.trackKey */
  trackKey: string;
}

export interface DeezerArtistHit {
  deezerArtistId: string;
  name: string;
  imageUrl?: string;
  nbFan?: number;
}

async function deezerGet<T>(path: string): Promise<T | null> {
  await deezerLimiter.acquire();
  try {
    const res = await fetch(`${DEEZER_BASE}${path}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Search Deezer for a track by artist + title (or free-text query).
 * Returns the best match with a preview URL when available.
 */
export async function searchDeezerTrack(opts: {
  artistName: string;
  trackTitle?: string;
}): Promise<DeezerTrackHit | null> {
  const q = opts.trackTitle
    ? `artist:"${opts.artistName}" track:"${opts.trackTitle}"`
    : `artist:"${opts.artistName}"`;
  const data = await deezerGet<{
    data?: Array<{
      id: number;
      title: string;
      preview?: string;
      duration?: number;
      artist?: { name?: string };
    }>;
  }>(`/search/track?q=${encodeURIComponent(q)}&limit=5`);

  const items = data?.data ?? [];
  // Prefer a hit with a non-empty preview URL
  const withPreview = items.find((t) => t.preview && t.preview.length > 0);
  const pick = withPreview ?? items[0];
  if (!pick) return null;

  const id = String(pick.id);
  return {
    deezerTrackId: id,
    title: pick.title,
    artistName: pick.artist?.name ?? opts.artistName,
    previewUrl: pick.preview || null,
    durationSec: pick.duration ?? 0,
    trackKey: `deezer:${id}`,
  };
}

/**
 * Search Deezer artist (identity / image path). Prefer first name-matched hit.
 */
export async function searchDeezerArtist(name: string): Promise<DeezerArtistHit | null> {
  const data = await deezerGet<{
    data?: Array<{
      id: number;
      name: string;
      picture_medium?: string;
      picture_big?: string;
      nb_fan?: number;
    }>;
  }>(`/search/artist?q=${encodeURIComponent(name)}&limit=3`);

  const item = data?.data?.[0];
  if (!item?.name) return null;
  return {
    deezerArtistId: String(item.id),
    name: item.name,
    imageUrl: item.picture_medium || item.picture_big || undefined,
    nbFan: item.nb_fan,
  };
}

/**
 * Top tracks for a Deezer artist (used to pick a representative preview).
 */
export async function fetchDeezerArtistTopTracks(
  deezerArtistId: string,
  limit = 5,
): Promise<DeezerTrackHit[]> {
  const data = await deezerGet<{
    data?: Array<{
      id: number;
      title: string;
      preview?: string;
      duration?: number;
      artist?: { name?: string };
    }>;
  }>(`/artist/${deezerArtistId}/top?limit=${limit}`);

  const items = data?.data ?? [];
  return items.map((t) => {
    const id = String(t.id);
    return {
      deezerTrackId: id,
      title: t.title,
      artistName: t.artist?.name ?? '',
      previewUrl: t.preview || null,
      durationSec: t.duration ?? 0,
      trackKey: `deezer:${id}`,
    };
  });
}

/**
 * Resolve a representative preview for an artist (Tier 1 entry).
 * 1) Search artist → top tracks with preview
 * 2) Fallback: free-text track search on artist name
 */
export async function resolveArtistPreview(artistName: string): Promise<DeezerTrackHit | null> {
  const artist = await searchDeezerArtist(artistName);
  if (artist) {
    const tops = await fetchDeezerArtistTopTracks(artist.deezerArtistId, 8);
    const withPreview = tops.find((t) => t.previewUrl);
    if (withPreview) return withPreview;
  }
  return searchDeezerTrack({ artistName });
}
