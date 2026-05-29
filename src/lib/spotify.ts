/**
 * Spotify Web API client using Client Credentials flow.
 * This only uses public catalog endpoints (no user auth required).
 */

// ──────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────

export interface SpotifyArtist {
  id: string;
  name: string;
  genres: string[];
  popularity: number;
  images: { url: string; width: number; height: number }[];
  followers: { total: number };
  weight: number; // computed catalog weight 0-1
}

export interface SpotifyTrack {
  id: string;
  name: string;
  artists: { id: string; name: string }[];
  album: { id: string; name: string; images: { url: string }[] };
  duration_ms: number;
  preview_url: string | null;
}

export interface AudioFeatures {
  id: string;
  energy: number;
  valence: number;
  danceability: number;
  acousticness: number;
  instrumentalness: number;
  speechiness: number;
  tempo: number;
  loudness: number;
}

export interface SpotifyAlbum {
  id: string;
  name: string;
  popularity: number;
  release_date: string;
  images: { url: string; width?: number; height?: number }[];
}

interface SpotifyTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  error?: string;
}

interface SpotifySearchArtistsResponse {
  artists?: { items?: SpotifyArtistApi[] };
}

interface SpotifyArtistApi {
  id: string;
  name: string;
  genres?: string[];
  popularity?: number;
  images?: { url: string; width: number; height: number }[];
  followers?: { total: number };
}

interface SpotifyRelatedArtistsResponse {
  artists?: SpotifyArtistApi[];
}

interface SpotifyArtistAlbumsResponse {
  items?: { id: string }[];
}

interface SpotifyAlbumsBatchResponse {
  albums?: {
    id: string;
    name: string;
    popularity?: number;
    release_date?: string;
    images?: { url: string; width?: number; height?: number }[];
  }[];
}

interface SpotifyTopArtistsResponse {
  items?: SpotifyArtistApi[];
}

// ──────────────────────────────────────────────────
// Rate limiting
// ──────────────────────────────────────────────────

let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 80; // ms between requests
let appTokenCache: { token: string; expiresAt: number } | null = null;

async function rateLimitedFetch(url: string, options: RequestInit): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL) {
    await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - elapsed));
  }
  lastRequestTime = Date.now();

  let retries = 0;
  const maxRetries = 3;

  while (retries <= maxRetries) {
    const response = await fetch(url, options);

    if (response.status === 429) {
      // Rate limited — exponential backoff
      const retryAfter = parseInt(response.headers.get('Retry-After') || '1', 10);
      const backoff = Math.min(retryAfter * 1000, 5000) * Math.pow(2, retries);
      console.warn(`Spotify rate limited. Retrying in ${backoff}ms...`);
      await new Promise(resolve => setTimeout(resolve, backoff));
      retries++;
      continue;
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`Spotify API error ${response.status}: ${errorBody}`);
    }

    return response;
  }

  throw new Error('Spotify API: Max retries exceeded');
}

function spotifyHeaders(accessToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

// ──────────────────────────────────────────────────
// Auth + Public API Functions
// ──────────────────────────────────────────────────

async function getAppAccessToken(): Promise<string> {
  if (appTokenCache && Date.now() < appTokenCache.expiresAt) {
    return appTokenCache.token;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Missing Spotify app credentials');
  }

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
  });

  const body = await response.text();
  let data: SpotifyTokenResponse;
  try {
    data = JSON.parse(body) as SpotifyTokenResponse;
  } catch {
    data = { access_token: '', token_type: '', expires_in: 0, error: body };
  }

  if (!response.ok) {
    throw new Error(`Spotify token error: ${data?.error || response.status}`);
  }

  appTokenCache = {
    token: data.access_token,
    // Refresh slightly before actual expiry.
    expiresAt: Date.now() + Math.max((data.expires_in - 60) * 1000, 60_000),
  };
  return appTokenCache.token;
}

async function spotifyPublicFetch<T>(path: string): Promise<T> {
  const token = await getAppAccessToken();
  return spotifyFetchWithToken<T>(path, token);
}

async function spotifyFetchWithToken<T>(path: string, accessToken: string): Promise<T> {
  const response = await rateLimitedFetch(`https://api.spotify.com/v1${path}`, {
    headers: spotifyHeaders(accessToken),
  });
  return (await response.json()) as T;
}

function mapArtist(artist: SpotifyArtistApi, weight = 0): SpotifyArtist {
  return {
    id: artist.id,
    name: artist.name,
    genres: artist.genres || [],
    popularity: artist.popularity || 0,
    images: artist.images || [],
    followers: artist.followers || { total: 0 },
    weight,
  };
}

export async function getPopularArtistsByGenres(genres: string[]): Promise<SpotifyArtist[]> {
  const artistMap = new Map<string, SpotifyArtist>();

  for (const genre of genres) {
    try {
      const data = await spotifyPublicFetch<SpotifySearchArtistsResponse>(
        `/search?q=${encodeURIComponent(`genre:"${genre}"`)}&type=artist&limit=20`
      );
      for (const artist of data?.artists?.items || []) {
        const mapped = mapArtist(artist, (artist.popularity || 0) / 100);
        const existing = artistMap.get(mapped.id);
        if (!existing || existing.popularity < mapped.popularity) {
          artistMap.set(mapped.id, mapped);
        }
      }
    } catch (err) {
      console.error(`Failed genre search for ${genre}:`, err);
    }
  }

  const artists = Array.from(artistMap.values())
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, 60);

  return artists;
}

export async function getUserTopArtists(accessToken: string): Promise<SpotifyArtist[]> {
  const ranges = ['medium_term', 'long_term', 'short_term'];
  const artistMap = new Map<string, SpotifyArtist>();

  for (const timeRange of ranges) {
    const data = await spotifyFetchWithToken<SpotifyTopArtistsResponse>(
      `/me/top/artists?time_range=${timeRange}&limit=50`,
      accessToken
    );

    for (const [index, artist] of (data.items || []).entries()) {
      const rankWeight = Math.max(0.15, 1 - index / 50);
      const mapped = mapArtist(artist, rankWeight);
      const existing = artistMap.get(mapped.id);
      if (!existing || existing.weight < mapped.weight) {
        artistMap.set(mapped.id, mapped);
      }
    }

    if (artistMap.size >= 12) break;
  }

  return Array.from(artistMap.values())
    .sort((a, b) => b.weight - a.weight || b.popularity - a.popularity)
    .slice(0, 60);
}

export async function getRelatedArtists(artistId: string, accessToken?: string): Promise<SpotifyArtist[]> {
  try {
    const fetcher = accessToken
      ? <T>(path: string) => spotifyFetchWithToken<T>(path, accessToken)
      : spotifyPublicFetch;
    const data = await fetcher<SpotifyRelatedArtistsResponse>(
      `/artists/${artistId}/related-artists`
    );
    return (data.artists || []).map(artist => mapArtist(artist, 0));
  } catch (err) {
    console.error(`Failed to fetch related artists for ${artistId}:`, err);
    return [];
  }
}

export async function getPopularAlbumsForArtist(artistId: string, accessToken?: string): Promise<SpotifyAlbum[]> {
  try {
    const fetcher = accessToken
      ? <T>(path: string) => spotifyFetchWithToken<T>(path, accessToken)
      : spotifyPublicFetch;
    const discography = await fetcher<SpotifyArtistAlbumsResponse>(
      `/artists/${artistId}/albums?include_groups=album,single&market=from_token&limit=20`
    );
    const albumIds: string[] = Array.from(
      new Set((discography?.items || []).map(a => a.id).filter(Boolean))
    ).slice(0, 20);

    if (albumIds.length === 0) return [];

    const albumsData = await fetcher<SpotifyAlbumsBatchResponse>(
      `/albums?ids=${albumIds.join(',')}&market=from_token`
    );
    return (albumsData?.albums || [])
      .map(album => ({
        id: album.id,
        name: album.name,
        popularity: album.popularity || 0,
        release_date: album.release_date || '',
        images: album.images || [],
      }))
      .sort((a: SpotifyAlbum, b: SpotifyAlbum) => b.popularity - a.popularity)
      .slice(0, 5);
  } catch (err) {
    console.error(`Failed to fetch albums for ${artistId}:`, err);
    return [];
  }
}
