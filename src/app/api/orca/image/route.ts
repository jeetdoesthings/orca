/**
 * GET /api/orca/image?artist=ArtistName
 *
 * Fetches artist profile image and metadata from various engines: Spotify, Wikipedia, Wikidata, Deezer.
 * Dynamically prioritizes the lookup pipeline based on artist popularity.
 * Gracefully bypasses rate limits by falling back to alternative engines.
 * Downscales all images to 150px - 320px for rapid loading and instant GPU uploads.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../auth/[...nextauth]/route';
import fs from 'fs';
import path from 'path';

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID ?? '';
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET ?? '';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SEARCH_URL = 'https://api.spotify.com/v1/search';

// ── Server-side token cache ──
let cachedToken: string | null = null;
let tokenExpiresAt = 0;

async function getSpotifyToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  const credentials = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) throw new Error(`Spotify token error: ${res.status}`);
  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken!;
}

// ── In-memory result cache ──
const imageCache = new Map<string, { imageUrl: string }>();

// ── Cached popularity lookup ──
const CACHE_FILE_PATH = path.join(process.cwd(), 'src/lib/graph/orca-cache.json');
let cachedGraph: { nodes: Array<{ name: string; popularity?: number }> } | null = null;

function getCachedPopularity(artistName: string): number {
  try {
    if (!cachedGraph && fs.existsSync(CACHE_FILE_PATH)) {
      const raw = fs.readFileSync(CACHE_FILE_PATH, 'utf-8');
      cachedGraph = JSON.parse(raw);
    }
    if (cachedGraph && cachedGraph.nodes) {
      const lower = artistName.toLowerCase().trim();
      const node = cachedGraph.nodes.find(n => n.name.toLowerCase().trim() === lower);
      if (node && node.popularity != null) return node.popularity;
    }
  } catch (err) {
    console.error('Failed to load cache in API route:', err);
  }
  return 50; // default medium popularity fallback
}

// ── Deezer Image Downscaled ──
async function fetchFromDeezer(artist: string): Promise<{ imageUrl: string } | null> {
  try {
    const url = `https://api.deezer.com/search/artist?q=${encodeURIComponent(artist)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Deezer HTTP error: ${res.status}`);
    const data = await res.json();
    
    if (data.error) {
      throw new Error(`Deezer API error: ${JSON.stringify(data.error)}`);
    }
    
    const item = data?.data?.[0];
    if (!item) return null;

    // Strict name check
    const normalize = (name: string) => name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
    const requestedLower = normalize(artist);
    const resultLower = normalize(item.name);
    if (resultLower !== requestedLower && !resultLower.includes(requestedLower) && !requestedLower.includes(resultLower)) {
      return null;
    }

    // Downscale: Prefer picture_medium (120px) or picture_big (250px) over huge sizes
    const imageUrl = item.picture_medium || item.picture_big || '';
    return { imageUrl };
  } catch (err) {
    console.warn(`Deezer fetch failed for "${artist}":`, err);
    return null;
  }
}

// ── MusicBrainz Image Downscaled ──
async function fetchFromMusicBrainzPipeline(artistName: string): Promise<string | null> {
  try {
    // 1. Search MusicBrainz for artist
    const searchUrl = `https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(artistName)}&fmt=json`;
    const searchRes = await fetch(searchUrl, {
      headers: { 'User-Agent': 'MusicOrca/1.0.0 ( jeetdoesthings@example.com )' },
      next: { revalidate: 86400 * 30 }
    });
    
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    const artist = searchData?.artists?.[0];
    if (!artist) return null;
    
    // Strict match verification
    const normalize = (name: string) => name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
    const requestedLower = normalize(artistName);
    const resultLower = normalize(artist.name);
    if (resultLower !== requestedLower && !resultLower.includes(requestedLower) && !requestedLower.includes(resultLower)) {
      return null;
    }

    // 2. Fetch artist details for url-rels
    const detailsUrl = `https://musicbrainz.org/ws/2/artist/${artist.id}?inc=url-rels&fmt=json`;
    const detailsRes = await fetch(detailsUrl, {
      headers: { 'User-Agent': 'MusicOrca/1.0.0 ( jeetdoesthings@example.com )' },
      next: { revalidate: 86400 * 30 }
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

    // 3. Resolve via English Wikipedia pageimages first (Downscaled to 200px)
    if (wikipediaUrl) {
      const parts = wikipediaUrl.split('/wiki/');
      if (parts.length > 1) {
        const title = decodeURIComponent(parts[1]);
        const wikiApiUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=pageimages&format=json&pithumbsize=200&origin=*`;
        const wikiRes = await fetch(wikiApiUrl, { next: { revalidate: 86400 * 30 } });
        if (wikiRes.ok) {
          const wikiData = await wikiRes.json();
          const pages = wikiData?.query?.pages || {};
          const pageId = Object.keys(pages)[0];
          if (pageId && pageId !== '-1') {
            const thumbnail = pages[pageId]?.thumbnail?.source;
            if (thumbnail) return thumbnail;
          }
        }
      }
    }

    // 4. Fallback to Wikidata P18 image claim (Downscaled to 200px)
    if (wikidataUrl) {
      const qid = wikidataUrl.split('/wiki/')[1] || wikidataUrl.split('/entity/')[1];
      if (qid) {
        const wikidataApiUrl = `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${qid}&property=P18&format=json&origin=*`;
        const wdRes = await fetch(wikidataApiUrl, { next: { revalidate: 86400 * 30 } });
        if (wdRes.ok) {
          const wdData = await wdRes.json();
          const imageClaim = wdData?.claims?.P18?.[0];
          const fileName = imageClaim?.mainsnak?.datavalue?.value;
          if (fileName) {
            return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fileName)}?width=200`;
          }
        }
      }
    }

    return null;
  } catch (err) {
    console.warn(`MusicBrainz pipeline failed for "${artistName}":`, err);
    return null;
  }
}

// ── Wikipedia Direct Search Downscaled ──
async function fetchFromWikipediaDirectSearch(artistName: string): Promise<string | null> {
  try {
    const wikiSearchUrl = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(artistName)}&gsrlimit=1&prop=pageimages&format=json&pithumbsize=200&origin=*`;
    const res = await fetch(wikiSearchUrl, {
      next: { revalidate: 86400 * 30 }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const pages = data?.query?.pages || {};
    const pageId = Object.keys(pages)[0];
    if (pageId && pageId !== '-1') {
      const page = pages[pageId];
      const imageUrl = page?.thumbnail?.source;
      if (!imageUrl) return null;
      
      const normalize = (name: string) => name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
      const requestedLower = normalize(artistName);
      const cleanTitle = page.title.replace(/\s*\(.*?\)\s*/g, '');
      const resultLower = normalize(cleanTitle);
      
      if (resultLower !== requestedLower && !resultLower.includes(requestedLower) && !requestedLower.includes(resultLower)) {
        return null;
      }
      
      return imageUrl;
    }
    return null;
  } catch (err) {
    console.warn(`Wikipedia direct search failed for "${artistName}":`, err);
    return null;
  }
}

// ── Multi-Engine Resolution Wrapper ──
async function resolveImageByEngine(
  engine: 'spotify' | 'musicbrainz' | 'wikipedia' | 'deezer',
  artist: string
): Promise<string | null> {
  switch (engine) {
    case 'spotify':
      try {
        const token = await getSpotifyToken();
        const searchParams = new URLSearchParams({
          q: artist,
          type: 'artist',
          limit: '1',
        });

        const res = await fetch(`${SEARCH_URL}?${searchParams}`, {
          headers: { Authorization: `Bearer ${token}` },
          next: { revalidate: 86400 },
        });

        if (res.ok) {
          const data = await res.json();
          const items = data?.artists?.items;
          if (items && items.length > 0) {
            const spotifyArtist = items[0];
            const images = spotifyArtist.images || [];
            
            // Downscale: Find the smallest image above 150px, or the absolute smallest
            const imageUrl =
              images.find((img: { width: number; url: string }) => img.width >= 150 && img.width <= 320)?.url ??
              images[images.length - 1]?.url ??
              '';
            if (imageUrl) return imageUrl;
          }
        }
      } catch (err) {
        console.warn(`Spotify search engine failed/rate-limited for "${artist}":`, err);
      }
      return null;

    case 'musicbrainz':
      return await fetchFromMusicBrainzPipeline(artist);

    case 'wikipedia':
      return await fetchFromWikipediaDirectSearch(artist);

    case 'deezer':
      const deezerRes = await fetchFromDeezer(artist);
      return deezerRes ? deezerRes.imageUrl : null;
  }
}

const inFlight = new Map<string, Promise<{ imageUrl: string; source: string } | null>>();

async function resolveWithCoalescing(
  artistName: string,
  popularity: number
): Promise<{ imageUrl: string; source: string } | null> {
  const key = artistName.toLowerCase().trim();
  if (inFlight.has(key)) return inFlight.get(key)!;

  const promise = (async () => {
    // 0. Local Artist catalog (fast path after backfill / materialize)
    try {
      const { prisma } = await import('@/lib/prisma');
      const { normalizeArtistName, isWeakImageUrl } = await import(
        '@/lib/artists/enrich-identity'
      );
      const row = await prisma.artist.findFirst({
        where: { normalizedName: normalizeArtistName(artistName) },
        select: { imageUrl: true },
      });
      if (row?.imageUrl && !isWeakImageUrl(row.imageUrl)) {
        const proxiedUrl = `/api/orca/image-proxy?url=${encodeURIComponent(row.imageUrl)}`;
        return { imageUrl: proxiedUrl, source: 'catalog' };
      }
    } catch {
      /* fall through */
    }

    // 1. Canonical enrich (Spotify → Deezer-first → Last.fm → MB/Wiki)
    try {
      const { enrichArtistIdentity, isWeakImageUrl, persistArtistImageAndGenres } =
        await import('@/lib/artists/enrich-identity');
      const enr = await enrichArtistIdentity({ name: artistName, popularity });
      if (enr.imageUrl && !isWeakImageUrl(enr.imageUrl)) {
        void persistArtistImageAndGenres({
          id: enr.spotifyId || `name-${key}`,
          name: artistName,
          imageUrl: enr.imageUrl,
          genres: enr.genres,
          popularity: enr.popularity,
          spotifyId: enr.spotifyId,
        });
        const proxiedUrl = `/api/orca/image-proxy?url=${encodeURIComponent(enr.imageUrl)}`;
        return {
          imageUrl: proxiedUrl,
          source: enr.sources[0] || 'enrich',
        };
      }
    } catch {
      /* fall through to legacy engines */
    }

    // 2. Legacy engine cascade (Deezer before Wikipedia to avoid false hits)
    const engines: Array<'spotify' | 'deezer' | 'wikipedia' | 'musicbrainz'> = [
      'spotify',
      'deezer',
      'wikipedia',
      'musicbrainz',
    ];
    for (const engine of engines) {
      const resolvedUrl = await resolveImageByEngine(engine, artistName);
      if (resolvedUrl) {
        const proxiedUrl = `/api/orca/image-proxy?url=${encodeURIComponent(resolvedUrl)}`;
        return { imageUrl: proxiedUrl, source: engine };
      }
    }
    return null;
  })().finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, promise);
  return promise;
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const url = new URL(request.url);
  const isDemo = url.searchParams.get('demo') === 'true';

  if (!isDemo && (!session || !session.user)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  // Demo image lookups are public, read-only metadata (Spotify/Deezer/Wiki
  // thumbnails) with no per-user data — allow them without a seeded demo-user.
  void isDemo;

  const artist = request.nextUrl.searchParams.get('artist');
  if (!artist) {
    return NextResponse.json({ error: 'Missing ?artist= parameter' }, { status: 400 });
  }

  const cacheKey = artist.toLowerCase().trim();
  const cached = imageCache.get(cacheKey);
  
  if (cached && cached.imageUrl) {
    return NextResponse.json(
      { url: cached.imageUrl, imageUrl: cached.imageUrl, source: (cached as any).source || 'cache' },
      {
        headers: {
          'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600',
        },
      }
    );
  }

  const popularity = getCachedPopularity(artist);

  const resolved = await resolveWithCoalescing(artist, popularity);

  if (resolved) {
    const result = {
      url: resolved.imageUrl,
      imageUrl: resolved.imageUrl,
      source: resolved.source,
    };
    imageCache.set(cacheKey, result);
    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600',
      },
    });
  }

  // Cache empty results to avoid server hammering
  const fallback = { url: '', imageUrl: '', source: 'none' };
  imageCache.set(cacheKey, fallback as any);
  return NextResponse.json(fallback);
}
