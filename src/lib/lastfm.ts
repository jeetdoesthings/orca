import { getCanonicalArtistId, getCanonicalArtistName } from './identity';
import type { OrcaNode, OrcaEdge, OrcaGraph } from './graph/types';
import { normaliseGenre, getGenreColor } from './graph/genre-normaliser';
import * as fs from 'fs';
import * as path from 'path';

const API_KEY = process.env.LASTFM_API_KEY || (process.env.NODE_ENV === 'production'
  ? (() => { throw new Error('LASTFM_API_KEY must be set in production!'); })()
  : '***REDACTED-LASTFM-KEY***');
const BASE_URL = 'https://ws.audioscrobbler.com/2.0/';
const CACHE_FILE_PATH = path.join(process.cwd(), 'src/lib/graph/orca-cache.json');

// Hand-seeded culturally iconic artists to guarantee high quality initial charts
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

export async function fetchLastFmSimilarArtists(name: string, limit = 20): Promise<Array<{ name: string; mbid?: string }> | null> {
  try {
    const data = await lastFmFetch<{ similarartists?: { artist: Array<{ name: string; mbid?: string }> } }>({
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

export async function fetchLastFmTopArtistsByTag(tag: string, limit = 40): Promise<Array<{ name: string; mbid?: string }> | null> {
  try {
    const data = await lastFmFetch<{ topartists?: { artist: Array<{ name: string; mbid?: string }> } }>({
      method: 'tag.getTopArtists',
      tag: tag,
      limit: String(limit),
    });
    return data.topartists?.artist || null;
  } catch (e) {
    console.warn(`Failed to fetch top artists for tag ${tag}:`, e);
    return null;
  }
}

/**
 * Normalises raw listener count to a standardized 0-100 score.
 */
function calculatePopularity(listeners: number): number {
  if (listeners <= 0) return 10;
  // Logarithmic scaling targeting 5,000,000 listeners as 98 popularity
  const score = Math.round(15 * Math.log10(listeners) - 4);
  return Math.max(10, Math.min(100, score));
}

/**
 * Builds the initial rich sound globe using Last.fm data.
 * Leverages the server-side JSON cache if available.
 */
export async function getOrBuildLastFmGraph(): Promise<OrcaGraph> {
  // 1. Try reading from server-side cache first
  try {
    if (fs.existsSync(CACHE_FILE_PATH)) {
      const cacheRaw = fs.readFileSync(CACHE_FILE_PATH, 'utf-8');
      const cached = JSON.parse(cacheRaw);
      if (cached && cached.nodes && cached.nodes.length > 100) {
        console.log(`[ORCA] Loaded dense graph with ${cached.nodes.length} nodes from local cache file.`);
        return cached as OrcaGraph;
      }
    }
  } catch (e) {
    console.warn('[ORCA] Cache read failed, compiling real-time graph...', e);
  }

  // 2. Fetch and construct graph from Last.fm
  console.log('[ORCA] Cache missing. Constructing new dense graph from Last.fm API...');
  const artistNodesMap = new Map<string, OrcaNode>();
  const artistDetails = new Map<string, LastFmArtistApi>();
  const explicitEdges: OrcaEdge[] = [];

  // Phase A: Load all hand-seeded iconic artists first
  const allSeeds = new Set<string>();
  const seedGenreMap = new Map<string, string>(); // artistId -> genre

  for (const [genreKey, artists] of Object.entries(ICONIC_SEEDS)) {
    for (const name of artists) {
      const canonName = getCanonicalArtistName(name);
      const canonId = getCanonicalArtistId(canonName);
      allSeeds.add(canonName);
      seedGenreMap.set(canonId, genreKey);
    }
  }

  // Phase B: Fetch top artists per genre from Last.fm tags
  const genreKeys = Object.keys(ICONIC_SEEDS);
  
  for (const genreKey of genreKeys) {
    const lfmTag = GENRE_TAG_MAP[genreKey] || genreKey;
    const topArtists = await fetchLastFmTopArtistsByTag(lfmTag, 30);
    
    if (topArtists) {
      for (const rawArtist of topArtists) {
        const canonName = getCanonicalArtistName(rawArtist.name);
        const canonId = getCanonicalArtistId(canonName, rawArtist.mbid);
        
        // Build base node if not already present
        if (!artistNodesMap.has(canonId)) {
          artistNodesMap.set(canonId, {
            id: canonId,
            name: canonName,
            genres: [genreKey],
            popularity: 50, // default pop rank
            imageUrl: '',
            weight: 0.15,
            state: 'explored',
            audioSignature: generateMockAudioSignature(canonName, 50, [genreKey]),
          });
          
          if (!seedGenreMap.has(canonId)) {
            seedGenreMap.set(canonId, genreKey);
          }
        } else {
          // Add extra genres if they appear in multiple tags
          const node = artistNodesMap.get(canonId)!;
          if (!node.genres.includes(genreKey)) {
            node.genres.push(genreKey);
          }
        }
      }
    }
    // Throttle slightly to respect Last.fm public rate limits
    await new Promise(resolve => setTimeout(resolve, 150));
  }

  // Phase C: Fetch detailed metrics & similar artist relationships for top seed artists
  const fetchLimit = Array.from(allSeeds);
  console.log(`[ORCA] Querying detailed Last.fm data for ${fetchLimit.length} seed culture artists...`);
  
  for (const seedName of fetchLimit) {
    const info = await fetchLastFmArtistInfo(seedName);
    if (!info) continue;
    
    const canonId = getCanonicalArtistId(seedName, info.mbid);
    artistDetails.set(canonId, info);

    const listeners = parseInt(info.stats?.listeners || '100000', 10);
    const pop = calculatePopularity(listeners);
    const primaryGenre = seedGenreMap.get(canonId) || 'pop';
    
    // Extract tags
    const rawTags = (info.tags?.tag || []).map(t => t.name.toLowerCase());
    const normalisedKey = normaliseGenre(rawTags.length > 0 ? rawTags : [primaryGenre]);
    const genresList = Array.from(new Set([normalisedKey, primaryGenre, ...rawTags])).slice(0, 6);

    // Update node details with accurate Last.fm stats
    artistNodesMap.set(canonId, {
      id: canonId,
      name: seedName,
      genres: genresList,
      popularity: pop,
      imageUrl: '',
      weight: Math.max(0.2, pop / 100),
      state: 'explored',
      audioSignature: generateMockAudioSignature(seedName, pop, genresList),
    });

    // Handle similar artist edges
    const similars = info.similar?.artist || [];
    for (const sim of similars.slice(0, 10)) {
      const simName = getCanonicalArtistName(sim.name);
      const simId = getCanonicalArtistId(simName, sim.mbid);
      
      // Connect to seed or add as a frontier node
      if (artistNodesMap.has(simId)) {
        explicitEdges.push({
          source: canonId,
          target: simId,
          type: 'related',
          weight: 0.85,
        });
      } else {
        // Frontier node
        artistNodesMap.set(simId, {
          id: simId,
          name: simName,
          genres: [primaryGenre],
          popularity: Math.max(20, pop - 15),
          imageUrl: '',
          weight: 0.08,
          state: 'frontier',
          audioSignature: generateMockAudioSignature(simName, pop - 15, [primaryGenre]),
        });
        
        explicitEdges.push({
          source: canonId,
          target: simId,
          type: 'related',
          weight: 0.65,
        });
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, 150));
  }

  // Phase D: Clean up and build similarity edges between nodes in the same genre
  const nodes = Array.from(artistNodesMap.values());
  const edges: OrcaEdge[] = [...explicitEdges];
  const edgeSet = new Set<string>();

  // Helper to deduplicate edges
  const addEdge = (src: string, tgt: string, type: 'genre' | 'related' | 'audio-similar', w: number) => {
    const key = src < tgt ? `${src}:${tgt}` : `${tgt}:${src}`;
    if (edgeSet.has(key) || src === tgt) return;
    edgeSet.add(key);
    edges.push({ source: src, target: tgt, type, weight: w });
  };

  // Populate initial edgeSet with explicit similarity edges
  for (const e of explicitEdges) {
    const src = typeof e.source === 'string' ? e.source : e.source.id;
    const tgt = typeof e.target === 'string' ? e.target : e.target.id;
    edgeSet.add(src < tgt ? `${src}:${tgt}` : `${tgt}:${src}`);
  }

  // Build cluster links within genres
  const byGenre = new Map<string, OrcaNode[]>();
  for (const node of nodes) {
    const primary = node.genres[0] || 'pop';
    if (!byGenre.has(primary)) byGenre.set(primary, []);
    byGenre.get(primary)!.push(node);
  }

  for (const [, genreNodes] of byGenre) {
    for (let i = 0; i < genreNodes.length; i++) {
      // Connect each node to 2 other nodes in the same genre
      for (let j = 1; j <= 2; j++) {
        const targetNode = genreNodes[(i + j) % genreNodes.length];
        if (targetNode) {
          addEdge(genreNodes[i].id, targetNode.id, 'genre', 0.55);
        }
      }
    }
  }

  // Final graph compilation
  const graph: OrcaGraph = {
    nodes,
    edges,
    genres: buildGenreRegions(nodes),
  };

  // 3. Write constructed graph to server cache file
  try {
    const dir = path.dirname(CACHE_FILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(graph, null, 2), 'utf-8');
    console.log(`[ORCA] Compiled and successfully cached dense graph of ${nodes.length} nodes to ${CACHE_FILE_PATH}`);
  } catch (e) {
    console.warn('[ORCA] Cache write failed:', e);
  }

  return graph;
}

/**
 * Builds custom audio signatures deterministically based on tags/names.
 */
function generateMockAudioSignature(name: string, popularity: number, genres: string[]) {
  const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const factor = (hash % 100) / 100;
  const isPop = genres.some(g => g.includes('pop') || g.includes('dance'));
  const isRock = genres.some(g => g.includes('rock') || g.includes('metal') || g.includes('punk'));
  const isAcoustic = genres.some(g => g.includes('folk') || g.includes('country') || g.includes('classical') || g.includes('jazz'));
  
  return {
    energy: Math.max(0.1, Math.min(0.99, 0.45 + factor * 0.3 + (isRock ? 0.25 : 0) - (isAcoustic ? 0.2 : 0))),
    valence: Math.max(0.1, Math.min(0.99, 0.5 + factor * 0.25 + (isPop ? 0.2 : 0))),
    danceability: Math.max(0.1, Math.min(0.99, 0.4 + factor * 0.3 + (isPop ? 0.35 : 0))),
    acousticness: Math.max(0.01, Math.min(0.99, 0.2 + factor * 0.2 + (isAcoustic ? 0.55 : 0) - (isRock ? 0.15 : 0))),
    instrumentalness: Math.max(0.01, Math.min(0.99, 0.1 + factor * 0.2 + (genres.includes('ambient') ? 0.65 : 0))),
    tempo: Math.round(75 + factor * 80 + (isPop ? 25 : 0)),
  };
}

/**
 * Maps genre regions dynamically.
 */
function buildGenreRegions(nodes: OrcaNode[]) {
  const genreMap = new Map<string, { nodeIds: string[] }>();
  for (const node of nodes) {
    const primary = node.genres[0] || 'pop';
    if (!genreMap.has(primary)) genreMap.set(primary, { nodeIds: [] });
    genreMap.get(primary)!.nodeIds.push(node.id);
  }

  return Array.from(genreMap.entries())
    .filter(([, data]) => data.nodeIds.length >= 2)
    .map(([name, data]) => ({
      id: name.replace(/\s+/g, '-'),
      name: name,
      color: getGenreColor(name),
      centroid: [0, 0, 0] as [number, number, number],
      nodeCount: data.nodeIds.length,
      nodeIds: data.nodeIds,
    }))
    .sort((a, b) => b.nodeCount - a.nodeCount);
}

// ── Spotify Expansion Integration ──
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';

let cachedSpotifyToken = '';
let spotifyTokenExpiresAt = 0;

async function getSpotifyToken(): Promise<string> {
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

async function fetchSpotifyArtist(name: string): Promise<{ popularity: number; genres: string[]; imageUrl: string; id: string } | null> {
  try {
    const token = await getSpotifyToken();
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

/**
 * Dynamically expands the graph by fetching similar artists from Spotify's database.
 * Resolves artist relationships from Last.fm seed list, then populates them with Spotify's live stats and images.
 */
export async function expandLastFmGraph(artistIds: string[], maxSimilar = 5): Promise<{
  nodes: OrcaNode[];
  edges: OrcaEdge[];
}> {
  // Load the current graph to resolve canonical IDs to artist names
  const graph = await getOrBuildLastFmGraph();
  const newNodes: OrcaNode[] = [];
  const newEdges: OrcaEdge[] = [];
  const nodeSet = new Set<string>(graph.nodes.map(n => n.id));

  for (const id of artistIds) {
    const existing = graph.nodes.find(n => n.id === id);
    if (!existing) continue;

    // Fetch similar artists from Last.fm seed
    const similars = await fetchLastFmSimilarArtists(existing.name, maxSimilar);
    if (!similars) continue;

    for (const sim of similars) {
      const simName = getCanonicalArtistName(sim.name);
      
      // Query Spotify for live stats and image
      const spotifyData = await fetchSpotifyArtist(simName);
      
      // Use Spotify ID as canonical node ID
      const simId = spotifyData ? `spotify-${spotifyData.id}` : getCanonicalArtistId(simName, sim.mbid);

      if (!nodeSet.has(simId)) {
        nodeSet.add(simId);
        
        const primaryGenre = existing.genres[0] || 'pop';
        const pop = spotifyData ? spotifyData.popularity : Math.max(10, existing.popularity - 10);
        const genresList = spotifyData && spotifyData.genres.length > 0 ? spotifyData.genres : [primaryGenre];
        const imageUrl = spotifyData ? spotifyData.imageUrl : '';
        
        // Build new Spotify-populated frontier node
        const newNode: OrcaNode = {
          id: simId,
          name: simName,
          genres: genresList,
          popularity: pop,
          imageUrl: imageUrl, // Pre-cached downscaled Spotify image!
          weight: Math.max(0.2, pop / 100),
          state: 'frontier',
          audioSignature: generateMockAudioSignature(simName, pop, genresList),
        };
        newNodes.push(newNode);
      }

      // Add similarity edge
      newEdges.push({
        source: id,
        target: simId,
        type: 'related',
        weight: 0.75,
      });
    }
    
    // Tiny throttle to respect Spotify search limits
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return { nodes: newNodes, edges: newEdges };
}
