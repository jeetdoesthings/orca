import { lastfmLimiter, spotifyLimiter } from './utils/rate-limiter';

// Audit fix M2: read the API key from env only. The former hardcoded dev key
// ('607ad8…') was committed to the repo and is now rejected by Last.fm anyway.
const API_KEY = process.env.LASTFM_API_KEY;
if (!API_KEY && process.env.NODE_ENV === 'production') {
  throw new Error('LASTFM_API_KEY must be set in production!');
}
const BASE_URL = 'https://ws.audioscrobbler.com/2.0/';

export const ICONIC_SEEDS: Record<string, string[]> = {
  'hip-hop': ['Kendrick Lamar', 'Tyler, The Creator', 'Kanye West', 'J. Cole', 'Drake'],
  'trap': ['Travis Scott', 'Future', 'Playboi Carti', 'Lil Uzi Vert', 'Metro Boomin'],
  'drill': ['Central Cee', 'Pop Smoke', 'Chief Keef', 'Fivio Foreign'],
  'edm': ['Skrillex', 'Deadmau5', 'Porter Robinson', 'Swedish House Mafia', 'Martin Garrix'],
  'house': ['Fred again..', 'Disclosure', 'Bicep', 'Daft Punk', 'Peggy Gou'],
  'techno': ['Charlotte de Witte', 'Carl Cox', 'Richie Hawtin', 'Amelie Lens'],
  'trance': ['Armin van Buuren', 'Tiësto', 'Above & Beyond', 'Paul van Dyk'],
  'drum-and-bass': ['Chase & Status', 'Sub Focus', 'Pendulum', 'Andy C', 'Wilkinson'],
  'pop': ['Taylor Swift', 'Billie Eilish', 'The Weeknd', 'Dua Lipa', 'Harry Styles'],
  'dance-pop': ['Lady Gaga', 'Katy Perry', 'Britney Spears', 'Kylie Minogue', 'Charli XCX'],
  'rock': ['Coldplay', 'Queen', 'Radiohead', 'Foo Fighters', 'Arctic Monkeys'],
  'alternative-rock': ['Nirvana', 'Muse', 'The White Stripes', 'Linkin Park', 'Pixies'],
  'indie-rock': ['The Strokes', 'Tame Impala', 'Mac DeMarco', 'Phoebe Bridgers', 'Vampire Weekend'],
  'punk': ['Green Day', 'blink-182', 'Ramones', 'The Clash', 'Sex Pistols'],
  'metal': ['Metallica', 'Iron Maiden', 'Black Sabbath', 'Slipknot', 'System of a Down'],
  'rnb': ['SZA', 'Frank Ocean', 'Alicia Keys', 'Usher', 'Khalid'],
  'soul': ['Aretha Franklin', 'Marvin Gaye', 'Leon Bridges', 'Erykah Badu', 'Stevie Wonder'],
  'funk': ['Bruno Mars', 'Parliament', 'Jamiroquai', 'Earth, Wind & Fire', 'Funkadelic'],
  'folk': ['Bob Dylan', 'Bon Iver', 'Fleet Foxes', 'Mumford & Sons', 'Iron & Wine'],
  'country': ['Johnny Cash', 'Dolly Parton', 'Luke Combs', 'Kacey Musgraves', 'Chris Stapleton'],
  'ambient': ['Brian Eno', 'Aphex Twin', 'Boards of Canada', 'Stars of the Lid', 'Hammock'],
  'classical': ['Ludovico Einaudi', 'Max Richter', 'Hans Zimmer', 'Yann Tiersen', 'Yiruma'],
  'jazz': ['Miles Davis', 'John Coltrane', 'Ella Fitzgerald', 'Norah Jones', 'Kamasi Washington'],
  'latin': ['Bad Bunny', 'Rosalía', 'Shakira', 'J Balvin', 'Daddy Yankee'],
  'world-music': ['Fela Kuti', 'Burna Boy', 'Bob Marley', 'Ravi Shankar', 'Tinariwen'],
};

// Map internal genre keys to standard Last.fm genre tags
const GENRE_TAG_MAP: Record<string, string> = {
  'hip-hop': 'hip hop',
  'trap': 'trap',
  'drill': 'drill',
  'edm': 'edm',
  'house': 'house',
  'techno': 'techno',
  'trance': 'trance',
  'drum-and-bass': 'drum and bass',
  'pop': 'pop',
  'dance-pop': 'dance pop',
  'rock': 'rock',
  'alternative-rock': 'alternative rock',
  'indie-rock': 'indie rock',
  'punk': 'punk',
  'metal': 'metal',
  'rnb': 'rnb',
  'soul': 'soul',
  'funk': 'funk',
  'folk': 'folk',
  'country': 'country',
  'ambient': 'ambient',
  'classical': 'classical',
  'jazz': 'jazz',
  'latin': 'latin',
  'world-music': 'world music',
};


async function lastFmFetch<T>(params: Record<string, string>): Promise<T> {
  if (!API_KEY) throw new Error('LASTFM_API_KEY is not configured');
  await lastfmLimiter.acquire();
  const queryParams = new URLSearchParams({
    ...params,
    api_key: API_KEY,
    format: 'json',
  });

  const response = await fetch(`${BASE_URL}?${queryParams.toString()}`, {
    next: { revalidate: 60 * 60 * 24 }, // Cache API queries for 24 hours
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Last.fm API error ${response.status}: ${errorText}`);
  }

  return response.json() as Promise<T>;
}

export interface LastFmArtistApi {
  name: string;
  mbid?: string;
  url?: string;
  stats?: {
    listeners: string;
    playcount: string;
  };
  similar?: {
    artist: Array<{ name: string; mbid?: string }>;
  };
  tags?: {
    tag: Array<{ name: string }>;
  };
  image?: Array<{ size: string; '#text': string }>;
  bio?: {
    summary: string;
    content: string;
  };
}

export async function fetchLastFmArtistInfo(name: string): Promise<LastFmArtistApi | null> {
  try {
    const data = await lastFmFetch<{ artist?: LastFmArtistApi }>({
      method: 'artist.getInfo',
      artist: name,
    });
    return data.artist || null;
  } catch (e) {
    console.warn(`Failed to fetch Last.fm info for ${name}:`, e);
    return null;
  }
}

export async function fetchLastFmSimilarArtists(name: string, limit = 20): Promise<Array<{ name: string; mbid?: string; match?: number }> | null> {
  try {
    const data = await lastFmFetch<{ similarartists?: { artist: Array<{ name: string; mbid?: string; match?: number }> } }>({
      method: 'artist.getSimilar',
      artist: name,
      limit: String(limit),
    });
    return data.similarartists?.artist || null;
  } catch (e) {
    console.warn(`Failed to fetch similar artists for ${name}:`, e);
    return null;
  }
}

// ── Spotify client credentials helpers ──
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';

let cachedSpotifyToken = '';
let spotifyTokenExpiresAt = 0;

export async function getSpotifyToken(): Promise<string> {
  if (cachedSpotifyToken && Date.now() < spotifyTokenExpiresAt) return cachedSpotifyToken;
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    throw new Error('Spotify credentials missing in environment.');
  }
  const credentials = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Spotify token error: ${res.status}`);
  const data = await res.json();
  cachedSpotifyToken = data.access_token;
  spotifyTokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  return cachedSpotifyToken;
}

/**
 * REMOVED (ORCA Backend Fix Part 1 — 2026):
 * Spotify `/v1/artists/{id}/related-artists` is permanently restricted for new
 * developer apps (2024-11-27) and closed for existing apps (2026-03-09).
 * Do NOT re-enable this HTTP call. Candidate expansion uses Last.fm similar +
 * MusicBrainz relationships + local graph / genre adjacency instead.
 */
export async function fetchSpotifyRelatedArtists(_artistId: string): Promise<any[] | null> {
  return null;
}

export async function fetchSpotifyArtist(name: string): Promise<{ popularity: number; genres: string[]; imageUrl: string; id: string } | null> {
  try {
    const token = await getSpotifyToken();
    // Audit fix H3: share the Spotify token bucket (was unthrottled in the
    // ORE/enrichment expansion paths).
    await spotifyLimiter.acquire();
    const searchParams = new URLSearchParams({ q: name, type: 'artist', limit: '1' });
    const res = await fetch(`https://api.spotify.com/v1/search?${searchParams.toString()}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const artist = data?.artists?.items?.[0];
    if (!artist) return null;

    const images: Array<{ url: string; width: number }> = artist.images || [];
    const imageUrl =
      images.find((img) => img.width >= 150 && img.width <= 320)?.url ??
      images[images.length - 1]?.url ??
      '';

    return {
      id: artist.id,
      popularity: artist.popularity,
      genres: artist.genres,
      imageUrl,
    };
  } catch (err) {
    console.warn(`Spotify lookup failed in expansion for "${name}":`, err);
    return null;
  }
}
