import type { RetrievedArtist } from './types';
import { spotifyLimiter } from '@/lib/utils/rate-limiter';

interface SpotifyArtistResult {
  id: string;
  name: string;
  genres?: string[];
  popularity?: number;
  images?: Array<{ url: string }>;
}

function nameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Audit fix H3: per-artist Spotify search with rate limiting + 429/401
 * retry/backoff (mirrors spotifyFetch in spotifySync.ts). Returns null on
 * failure so enrichment degrades gracefully.
 */
async function searchSpotifyArtist(
  name: string,
  accessToken: string,
): Promise<{ items: SpotifyArtistResult[] } | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await spotifyLimiter.acquire();
    try {
      const res = await fetch(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(name)}&type=artist&limit=3`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('Retry-After') || '2', 10);
        console.warn(`[SpotifyMetadata] 429 rate limited (attempt ${attempt + 1}) — backing off ${retryAfter}s`);
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        continue;
      }
      if (!res.ok) return null;
      return (await res.json()) as { items: SpotifyArtistResult[] };
    } catch {
      return null;
    }
  }
  return null;
}

const BATCH_SIZE = 10;

export async function enrichRetrievedArtistsWithSpotify(
  artists: RetrievedArtist[],
  accessToken: string,
): Promise<RetrievedArtist[]> {
  if (!accessToken || artists.length === 0) return artists;

  const out: RetrievedArtist[] = new Array(artists.length);

  // Audit fix H3: batch the per-artist searches (was one sequential fetch per
  // artist, up to ~220 calls with no 429 handling).
  for (let i = 0; i < artists.length; i += BATCH_SIZE) {
    const batch = artists.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (artist, j) => {
        const idx = i + j;
        try {
          const data = await searchSpotifyArtist(artist.canonicalName, accessToken);
          const items: SpotifyArtistResult[] = data?.items ?? [];
          const target = nameKey(artist.canonicalName);
          const match =
            items.find((it) => nameKey(it.name) === target) ??
            items.find((it) => artist.aliases.some((a) => nameKey(a) === nameKey(it.name))) ??
            items[0];
          if (!match) {
            out[idx] = artist;
            return;
          }
          out[idx] = {
            ...artist,
            spotifyId: match.id,
            genres: Array.from(new Set([...(artist.genres || []), ...(match.genres || [])])),
            tags: Array.from(new Set([...(artist.tags || []), ...(match.genres || [])])),
            popularity: match.popularity ?? artist.popularity,
            availability: { ...artist.availability, spotify: true },
            evidence: [
              ...artist.evidence,
              {
                source: 'spotify_metadata',
                id: match.id,
                confidence: nameKey(match.name) === target ? 0.95 : 0.72,
                note: 'metadata and availability enrichment',
              },
            ],
          };
        } catch {
          out[idx] = artist;
        }
      }),
    );
  }

  return out;
}
