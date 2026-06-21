import { prisma } from '@/lib/prisma';
import { normaliseGenre, GENRE_ANCHORS, latLngToXYZ, InternalGenre } from '@/lib/graph/genre-normaliser';
import type { OrcaNode, OrcaEdge, AudioSignature } from '@/lib/graph/types';
import { fetchLastFmArtistInfo, ICONIC_SEEDS } from './lastfm';

const R = 1.65;

interface SpotifyArtist {
  id: string;
  name: string;
  genres?: string[];
  popularity: number;
  images: Array<{ url: string; width?: number }>;
}

interface SpotifyTrack {
  id: string;
  name: string;
  artists: Array<{ id: string; name: string }>;
  album: {
    images: Array<{ url: string; width?: number }>;
  };
}

interface AudioFeatures {
  id: string;
  valence: number;
  energy: number;
  acousticness: number;
  danceability: number;
  instrumentalness: number;
  tempo: number;
}

interface SpotifyProfile {
  display_name: string;
  country: string;
  images: Array<{ url: string }>;
}

interface SpotifySyncResult {
  topArtistsShort: SpotifyArtist[];
  topArtistsMedium: SpotifyArtist[];
  topArtistsLong: SpotifyArtist[];
  recentTracks: SpotifyTrack[];
  savedTracks: SpotifyTrack[];
  audioFeatures: AudioFeatures[];
  userProfile: SpotifyProfile;
}

// Seeded PRNG for deterministic coordinate scatter
function seededRandom(seed: string): () => number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  let state = Math.abs(hash);
  return () => {
    state = (state * 1664525 + 1013904223) & 0xffffffff;
    return (state >>> 0) / 0xffffffff;
  };
}

// Compute organic coordinate scatter deterministic positions constrained to globe surface (R = 1.65)
export function computeNodeCoords(
  artistId: string,
  genre: InternalGenre,
  weight: number
): [number, number, number] {
  const rand = seededRandom(artistId);
  const anchor = GENRE_ANCHORS[genre] || GENRE_ANCHORS['pop'];

  // Power scatter: tight cluster core, sparse outer halo
  const maxRadius = 22; // degrees
  const r = maxRadius * Math.pow(rand(), 1.8);
  const theta = rand() * 2 * Math.PI;

  // Closer positioning for higher listened weights
  const tightness = 0.3 + weight * 0.55;
  const finalR = r * (1 - tightness * 0.5);

  const lat = anchor.lat + finalR * Math.cos(theta);
  const lng = anchor.lng + finalR * Math.sin(theta);

  // Map to Cartesian XYZ coordinates on sphere surface (R = 1.65)
  return latLngToXYZ(lat, lng, R * 1.008);
}

// Expose rate-limited fetching from Spotify API
async function spotifyFetch(endpoint: string, token: string): Promise<any> {
  const url = `https://api.spotify.com/v1${endpoint}`;
  
  const makeRequest = async (retries = 2): Promise<any> => {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') || '2', 10);
      console.warn(`[Spotify Sync] 429 Rate Limited. Sleeping for ${retryAfter}s...`);
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      return makeRequest(retries);
    }

    if (!res.ok) {
      if (res.status === 401 && retries > 0) {
        console.warn(`[Spotify Sync] 401 Unauthorized fetching ${endpoint}. Retrying...`);
        return makeRequest(retries - 1);
      }
      throw new Error(`Spotify API error: ${res.status} ${endpoint}`);
    }

    return res.json();
  };

  return makeRequest();
}

async function fetchTopArtists(token: string, range: string, limit = 50): Promise<SpotifyArtist[]> {
  try {
    const data = await spotifyFetch(`/me/top/artists?time_range=${range}&limit=${limit}`, token);
    return data.items || [];
  } catch (err) {
    console.error(`[Spotify Sync] Error fetching top artists (${range}):`, err);
    return [];
  }
}

async function fetchRecentlyPlayed(token: string, limit = 50): Promise<SpotifyTrack[]> {
  try {
    const data = await spotifyFetch(`/me/player/recently-played?limit=${limit}`, token);
    return (data.items || []).map((item: any) => item.track);
  } catch (err) {
    console.error(`[Spotify Sync] Error fetching recently played:`, err);
    return [];
  }
}

async function fetchSavedTracks(token: string, limit = 200): Promise<SpotifyTrack[]> {
  const tracks: SpotifyTrack[] = [];
  try {
    let nextUrl: string | null = `/me/tracks?limit=50`;
    while (nextUrl && tracks.length < limit) {
      const data = await spotifyFetch(nextUrl, token);
      const items = (data.items || []).map((item: any) => item.track);
      tracks.push(...items);
      nextUrl = data.next ? data.next.replace('https://api.spotify.com/v1', '') : null;
    }
  } catch (err) {
    console.error(`[Spotify Sync] Error fetching saved tracks:`, err);
  }
  return tracks.slice(0, limit);
}

async function fetchAudioFeaturesBatch(token: string, trackIds: string[]): Promise<AudioFeatures[]> {
  const features: AudioFeatures[] = [];
  const batchSize = 100;

  for (let i = 0; i < trackIds.length; i += batchSize) {
    const batch = trackIds.slice(i, i + batchSize);
    try {
      const data = await spotifyFetch(`/audio-features?ids=${batch.join(',')}`, token);
      features.push(...(data.audio_features || []).filter(Boolean));
    } catch (err) {
      console.error(`[Spotify Sync] Error fetching audio features batch ${i}:`, err);
    }
    if (i + batchSize < trackIds.length) {
      await new Promise(resolve => setTimeout(resolve, 100)); // sleep 100ms
    }
  }

  return features;
}

// Compute user's artist listening weight (0.0 - 1.0)
function computeArtistWeight(input: {
  topRankShort: number | null;
  topRankMedium: number | null;
  topRankLong: number | null;
  recentPlayCount: number;
  savedTrackCount: number;
}): number {
  let score = 0;

  if (input.topRankShort !== null) {
    score += ((51 - input.topRankShort) / 50) * 40; // 0-40 pts
  }
  if (input.topRankMedium !== null) {
    score += ((51 - input.topRankMedium) / 50) * 30; // 0-30 pts
  }
  if (input.topRankLong !== null) {
    score += ((51 - input.topRankLong) / 50) * 15; // 0-15 pts
  }
  score += Math.min(input.recentPlayCount / 10, 1) * 10; // 0-10 pts
  score += Math.min(input.savedTrackCount / 5, 1) * 5; // 0-5 pts

  return Math.max(0.05, Math.min(score / 100, 1.0));
}

// Compute average audio features for an artist across their tracks
function computeArtistAudioFeatures(
  features: AudioFeatures[],
  recent: SpotifyTrack[],
  saved: SpotifyTrack[]
): Map<string, AudioSignature> {
  const trackToArtist = new Map<string, string>();
  [...recent, ...saved].forEach(track => {
    const artistId = track.artists[0]?.id;
    if (artistId) trackToArtist.set(track.id, artistId);
  });

  const artistFeatures = new Map<string, AudioFeatures[]>();
  features.forEach(feat => {
    if (!feat) return;
    const artistId = trackToArtist.get(feat.id);
    if (!artistId) return;
    const existing = artistFeatures.get(artistId) || [];
    artistFeatures.set(artistId, [...existing, feat]);
  });

  const averages = new Map<string, AudioSignature>();
  artistFeatures.forEach((feats, artistId) => {
    const count = feats.length;
    averages.set(artistId, {
      valence: feats.reduce((s, f) => s + f.valence, 0) / count,
      energy: feats.reduce((s, f) => s + f.energy, 0) / count,
      acousticness: feats.reduce((s, f) => s + f.acousticness, 0) / count,
      danceability: feats.reduce((s, f) => s + f.danceability, 0) / count,
      instrumentalness: feats.reduce((s, f) => s + f.instrumentalness, 0) / count,
      tempo: feats.reduce((s, f) => s + f.tempo, 0) / count,
    });
  });

  return averages;
}

const MOOD_DEFINITIONS = [
  {
    label: 'late-night melancholy',
    condition: (f: AudioSignature) => f.valence < 0.35 && f.energy < 0.50 && f.acousticness > 0.25,
  },
  {
    label: 'euphoric rush',
    condition: (f: AudioSignature) => f.valence > 0.70 && f.energy > 0.75,
  },
  {
    label: 'morning clarity',
    condition: (f: AudioSignature) => f.valence > 0.55 && f.energy > 0.40 && f.energy < 0.75 && f.acousticness > 0.35,
  },
  {
    label: 'restless energy',
    condition: (f: AudioSignature) => f.energy > 0.75 && f.valence > 0.35 && f.valence < 0.70,
  },
  {
    label: 'tender introspection',
    condition: (f: AudioSignature) => f.valence > 0.30 && f.valence < 0.65 && f.energy < 0.45 && f.acousticness > 0.45,
  },
  {
    label: 'triumphant arrival',
    condition: (f: AudioSignature) => f.valence > 0.70 && f.energy > 0.55 && f.energy < 0.80,
  },
  {
    label: 'floating dissociation',
    condition: (f: AudioSignature) => f.instrumentalness > 0.50 && f.energy < 0.35,
  },
  {
    label: 'defiant noise',
    condition: (f: AudioSignature) => f.energy > 0.80 && f.valence < 0.45,
  },
  {
    label: 'sun-drenched warmth',
    condition: (f: AudioSignature) => f.valence > 0.70 && f.acousticness > 0.35 && f.energy < 0.70,
  },
  {
    label: 'underground pulse',
    condition: (f: AudioSignature) => f.danceability > 0.70 && f.energy > 0.60 && f.valence < 0.60,
  },
  {
    label: 'nostalgic ache',
    condition: (f: AudioSignature) => f.valence < 0.50 && f.tempo < 95,
  },
  {
    label: 'sacred stillness',
    condition: (f: AudioSignature) => f.instrumentalness > 0.40 && f.energy < 0.25,
  },
];

function getMoodLabel(f: AudioSignature): string {
  const match = MOOD_DEFINITIONS.find(def => def.condition(f));
  return match?.label ?? 'varied energy';
}

function getMostCommonMood(nodes: OrcaNode[]): string {
  const counts = new Map<string, number>();
  nodes.forEach(n => {
    const label = getMoodLabel(n.audioSignature);
    counts.set(label, (counts.get(label) || 0) + 1);
  });
  let maxCount = -1;
  let bestMood = 'varied energy';
  counts.forEach((count, mood) => {
    if (count > maxCount) {
      maxCount = count;
      bestMood = mood;
    }
  });
  return bestMood;
}

// Compute the user's primary taste centroid (HomeRegion)
function computeHomeRegion(nodes: OrcaNode[]): { lat: number; lng: number; label: string; spread: number } {
  if (nodes.length === 0) return { lat: 0, lng: 0, label: 'Pop', spread: 0 };

  let totalWeight = 0;
  let weightedLat = 0;
  let weightedLng = 0;

  // Retrieve lat/lng vectors from XYZ coords
  nodes.forEach(node => {
    const w = node.weight * node.weight;
    totalWeight += w;
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const z = node.z ?? 0;
    const r = Math.sqrt(x * x + y * y + z * z);
    if (r > 0) {
      const lat = 90 - Math.acos(y / r) * 180 / Math.PI;
      const lng = Math.atan2(x, z) * 180 / Math.PI;
      weightedLat += lat * w;
      weightedLng += lng * w;
    }
  });

  const centroidLat = weightedLat / totalWeight;
  const centroidLng = weightedLng / totalWeight;

  // Identify dominant genre key
  const genreWeights = new Map<string, number>();
  nodes.forEach(node => {
    const primary = node.genres[0] || 'pop';
    genreWeights.set(primary, (genreWeights.get(primary) || 0) + node.weight);
  });

  let maxWeight = -1;
  let dominantGenre = 'pop';
  genreWeights.forEach((w, g) => {
    if (w > maxWeight) {
      maxWeight = w;
      dominantGenre = g;
    }
  });

  // Calculate spread distance
  let totalDist = 0;
  nodes.forEach(node => {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const z = node.z ?? 0;
    const r = Math.sqrt(x * x + y * y + z * z);
    if (r > 0) {
      const lat = 90 - Math.acos(y / r) * 180 / Math.PI;
      const lng = Math.atan2(x, z) * 180 / Math.PI;
      const dist = Math.sqrt(Math.pow(lat - centroidLat, 2) + Math.pow(lng - centroidLng, 2));
      totalDist += dist;
    }
  });
  const avgDistance = totalDist / nodes.length;
  const spread = Math.min(avgDistance / 60, 1.0);

  // Map normalized genre to capitalize label
  const label = dominantGenre.charAt(0).toUpperCase() + dominantGenre.slice(1);

  return {
    lat: centroidLat,
    lng: centroidLng,
    label,
    spread,
  };
}

// Generate the beautiful narrative taste summary sentence
function generateTasteSummary(nodes: OrcaNode[], homeRegion: { label: string; spread: number }): string {
  const dominantGenreLabel = homeRegion.label;
  const spread = homeRegion.spread;
  const nodeCount = nodes.length;

  const genres = new Set(nodes.map(n => n.genres[0] || 'pop'));
  const uniqueGenresCount = genres.size;

  const topNodes = [...nodes].sort((a, b) => b.weight - a.weight).slice(0, 10);
  const topMood = getMostCommonMood(topNodes);

  if (spread < 0.25) {
    return `Deeply rooted in ${dominantGenreLabel} — a focused, specific taste`;
  }
  if (spread > 0.70 && uniqueGenresCount >= 6) {
    return `${nodeCount} artists across ${uniqueGenresCount} genres — a restless, wide-ranging curiosity`;
  }
  if (spread > 0.50) {
    return `A ${dominantGenreLabel}-centred universe with strong connections reaching outward`;
  }
  return `${dominantGenreLabel} at the core, defined by ${topMood}`;
}

// Build edges between user artists based on genre overlap and audio similarity
function buildSpotifyEdges(nodes: OrcaNode[]): OrcaEdge[] {
  const edges: OrcaEdge[] = [];
  const edgeSet = new Set<string>();

  const addEdge = (src: string, tgt: string, type: 'genre' | 'audio-similar', w: number) => {
    const key = src < tgt ? `${src}:${tgt}` : `${tgt}:${src}`;
    if (edgeSet.has(key) || src === tgt) return;
    edgeSet.add(key);
    edges.push({ source: src, target: tgt, type, weight: w });
  };

  // 1. Genre-based connection
  const byGenre = new Map<string, OrcaNode[]>();
  nodes.forEach(node => {
    const primary = node.genres[0] || 'pop';
    if (!byGenre.has(primary)) byGenre.set(primary, []);
    byGenre.get(primary)!.push(node);
  });

  byGenre.forEach(genreNodes => {
    for (let i = 0; i < genreNodes.length; i++) {
      // Connect each node to up to 2 other nodes in the same genre
      for (let j = 1; j <= 2; j++) {
        const targetNode = genreNodes[(i + j) % genreNodes.length];
        if (targetNode) {
          addEdge(genreNodes[i].id, targetNode.id, 'genre', 0.6);
        }
      }
    }
  });

  // 2. Audio similarity-based connection
  // Connect each artist to their absolute top audio similar artist
  for (let i = 0; i < nodes.length; i++) {
    let bestSim = -1;
    let bestIdx = -1;

    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      const sim = audioCosineSimilarity(nodes[i].audioSignature, nodes[j].audioSignature);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = j;
      }
    }

    if (bestIdx !== -1 && bestSim > 0.8) {
      addEdge(nodes[i].id, nodes[bestIdx].id, 'audio-similar', bestSim);
    }
  }

  return edges;
}

function audioCosineSimilarity(a: AudioSignature, b: AudioSignature): number {
  const normTempo = (t: number) => Math.max(0, Math.min(1, (t - 40) / 160));
  const v1 = [a.energy, a.valence, a.danceability, a.acousticness, a.instrumentalness, normTempo(a.tempo)];
  const v2 = [b.energy, b.valence, b.danceability, b.acousticness, b.instrumentalness, normTempo(b.tempo)];

  let dot = 0, mag1 = 0, mag2 = 0;
  for (let i = 0; i < v1.length; i++) {
    dot += v1[i] * v2[i];
    mag1 += v1[i] * v1[i];
    mag2 += v2[i] * v2[i];
  }
  const denom = Math.sqrt(mag1) * Math.sqrt(mag2);
  return denom === 0 ? 0 : dot / denom;
}

// Fallback seed artists if user has < 5 artists
const FALLBACK_POPULAR_SEEDS = [
  { id: 'spotify-1', name: 'Kendrick Lamar', genres: ['hip-hop', 'rap'], popularity: 92 },
  { id: 'spotify-2', name: 'Taylor Swift', genres: ['pop'], popularity: 98 },
  { id: 'spotify-3', name: 'Tame Impala', genres: ['indie-rock', 'alternative'], popularity: 82 },
  { id: 'spotify-4', name: 'Fred again..', genres: ['house', 'electronic'], popularity: 84 },
  { id: 'spotify-5', name: 'Billie Eilish', genres: ['pop', 'alternative'], popularity: 94 },
];

function calculatePopularity(listeners: number): number {
  if (listeners <= 0) return 50;
  const score = Math.round(15 * Math.log10(listeners) - 4);
  return Math.max(10, Math.min(100, score));
}

async function populateArtistGenres(artists: SpotifyArtist[], token: string): Promise<void> {
  // 1. Identify artists that need genres and have Spotify IDs
  const targetArtists = artists.filter(a => !a.genres || a.genres.length === 0);
  const spotifyIds = targetArtists.map(a => a.id).filter(id => id && !id.startsWith('lastfm-'));

  // 2. Fetch from Spotify in batches of 50
  const batchSize = 50;
  const spotifyDetailsMap = new Map<string, { genres: string[], popularity: number, images: Array<{ url: string; width?: number }> }>();

  for (let i = 0; i < spotifyIds.length; i += batchSize) {
    const batch = spotifyIds.slice(i, i + batchSize);
    try {
      const data = await spotifyFetch(`/artists?ids=${batch.join(',')}`, token);
      if (data && typeof data === 'object' && 'artists' in data) {
        const artistsList = (data as { artists: SpotifyArtist[] }).artists;
        if (Array.isArray(artistsList)) {
          artistsList.filter(Boolean).forEach((art) => {
            spotifyDetailsMap.set(art.id, {
              genres: art.genres || [],
              popularity: art.popularity || 50,
              images: art.images || [],
            });
          });
        }
      }
    } catch (err) {
      console.error(`[Spotify Sync] Failed to batch fetch artists ${i}:`, err);
    }
  }

  // 3. Map retrieved info back or use Last.fm lookup as fallback
  const localMap: Record<string, string[]> = {};
  for (const [genre, names] of Object.entries(ICONIC_SEEDS)) {
    names.forEach(n => {
      localMap[n.toLowerCase().trim()] = [genre];
    });
  }

  const fetchPromises = artists.map(async (artist) => {
    // If Spotify already returned genres, keep them
    if (artist.genres && artist.genres.length > 0) {
      if (!artist.popularity) artist.popularity = 75;
      return;
    }

    // Check if we resolved it from the Spotify batch fetch
    const spotifyDetail = spotifyDetailsMap.get(artist.id);
    if (spotifyDetail && spotifyDetail.genres && spotifyDetail.genres.length > 0) {
      artist.genres = spotifyDetail.genres;
      artist.popularity = spotifyDetail.popularity;
      if (spotifyDetail.images && spotifyDetail.images.length > 0) {
        artist.images = spotifyDetail.images;
      }
      return;
    }

    const lowerName = artist.name.toLowerCase().trim();
    
    // Check local lookup
    if (localMap[lowerName]) {
      artist.genres = localMap[lowerName];
      artist.popularity = 85;
      return;
    }

    // Otherwise, fetch from Last.fm
    try {
      const info = await fetchLastFmArtistInfo(artist.name);
      if (info) {
        if (info.stats && info.stats.listeners) {
          const listeners = parseInt(info.stats.listeners, 10);
          artist.popularity = calculatePopularity(listeners);
        } else {
          artist.popularity = 50;
        }

        if (info.tags && info.tags.tag) {
          const tags = info.tags.tag.map(t => t.name.toLowerCase().trim()).filter(Boolean);
          if (tags.length > 0) {
            artist.genres = tags;
            return;
          }
        }
      }
    } catch (e) {
      console.warn(`[Spotify Sync] Failed to fetch Last.fm genres for ${artist.name}:`, e);
    }

    // Default fallbacks
    artist.genres = [];
    if (!artist.popularity) artist.popularity = 50;
  });

  await Promise.all(fetchPromises);
}

export async function processAndStoreUserData(accessToken: string, userId: string): Promise<void> {
  try {
    console.log(`[Spotify Sync] Starting user sync for spotifyId: ${userId}`);

    // Fetch profile info
    const profileData = await spotifyFetch('/me', accessToken);
    const userProfile: SpotifyProfile = {
      display_name: profileData.display_name || profileData.id,
      country: profileData.country || '',
      images: profileData.images || [],
    };

    // Parallel fetch endpoints
    const [
      topArtistsShort,
      topArtistsMedium,
      topArtistsLong,
      recentTracks,
    ] = await Promise.all([
      fetchTopArtists(accessToken, 'short_term', 50),
      fetchTopArtists(accessToken, 'medium_term', 50),
      fetchTopArtists(accessToken, 'long_term', 50),
      fetchRecentlyPlayed(accessToken, 50),
    ]);

    const savedTracks = await fetchSavedTracks(accessToken, 200);

    // Deduplicate unique artists from top ranges, and enrich using recently played and saved tracks
    const artistMap = new Map<string, SpotifyArtist>();
    [...topArtistsShort, ...topArtistsMedium, ...topArtistsLong].forEach(a => {
      artistMap.set(a.id, a);
    });

    [...recentTracks, ...savedTracks].forEach(track => {
      if (!track || !track.artists) return;
      track.artists.forEach(art => {
        if (!art || !art.id) return;
        if (!artistMap.has(art.id)) {
          artistMap.set(art.id, {
            id: art.id,
            name: art.name,
            popularity: 50,
            images: [],
          });
        }
      });
    });

    let rawArtists = Array.from(artistMap.values());

    // Populate missing Spotify genres and popularity using local caches and Last.fm
    await populateArtistGenres(rawArtists, accessToken);

    // If user has zero or extremely few artists, push fallbacks
    if (rawArtists.length < 5) {
      console.warn(`[Spotify Sync] User has fewer than 5 artists. Loading fallback seeds.`);
      rawArtists = FALLBACK_POPULAR_SEEDS.map((s, idx) => ({
        id: s.id,
        name: s.name,
        genres: s.genres,
        popularity: s.popularity,
        images: [],
      }));
    }

    // Build unique track IDs list to query audio features
    const allTrackIds = Array.from(
      new Set([...recentTracks.map(t => t.id), ...savedTracks.map(t => t.id)])
    ).slice(0, 500);

    const audioFeatures = await fetchAudioFeaturesBatch(accessToken, allTrackIds);

    // Prepare helper maps for computing weights
    const shortRanks = new Map(topArtistsShort.map((a, i) => [a.id, i + 1]));
    const mediumRanks = new Map(topArtistsMedium.map((a, i) => [a.id, i + 1]));
    const longRanks = new Map(topArtistsLong.map((a, i) => [a.id, i + 1]));

    const recentPlayCounts = new Map<string, number>();
    recentTracks.forEach(t => {
      const aId = t.artists[0]?.id;
      if (aId) recentPlayCounts.set(aId, (recentPlayCounts.get(aId) || 0) + 1);
    });

    const savedTrackCounts = new Map<string, number>();
    savedTracks.forEach(t => {
      const aId = t.artists[0]?.id;
      if (aId) savedTrackCounts.set(aId, (savedTrackCounts.get(aId) || 0) + 1);
    });

    const artistAverages = computeArtistAudioFeatures(audioFeatures, recentTracks, savedTracks);

    // Build the processed nodes list
    const nodes: OrcaNode[] = rawArtists.map(artist => {
      const weight = computeArtistWeight({
        topRankShort: shortRanks.get(artist.id) ?? null,
        topRankMedium: mediumRanks.get(artist.id) ?? null,
        topRankLong: longRanks.get(artist.id) ?? null,
        recentPlayCount: recentPlayCounts.get(artist.id) ?? 0,
        savedTrackCount: savedTrackCounts.get(artist.id) ?? 0,
      });

      const normalisedGenre = normaliseGenre(artist.genres);
      
      const imageUrl = artist.images?.[1]?.url ?? artist.images?.[0]?.url ?? '';

      // Set average audio features or construct a seeded mock signature
      const avgFeat = artistAverages.get(artist.id);
      let signature: AudioSignature;
      if (avgFeat) {
        signature = avgFeat;
      } else {
        const hash = artist.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const factor = (hash % 100) / 100;
        const normGenre = normalisedGenre.toLowerCase();
        const isPop = normGenre.includes('pop') || normGenre.includes('dance');
        const isRock = normGenre.includes('rock') || normGenre.includes('metal') || normGenre.includes('punk');
        const isAcoustic = normGenre.includes('folk') || normGenre.includes('country') || normGenre.includes('classical') || normGenre.includes('jazz');
        
        signature = {
          energy: Math.max(0.1, Math.min(0.99, 0.45 + factor * 0.3 + (isRock ? 0.25 : 0) - (isAcoustic ? 0.2 : 0))),
          valence: Math.max(0.1, Math.min(0.99, 0.5 + factor * 0.25 + (isPop ? 0.2 : 0))),
          danceability: Math.max(0.1, Math.min(0.99, 0.4 + factor * 0.3 + (isPop ? 0.35 : 0))),
          acousticness: Math.max(0.01, Math.min(0.99, 0.2 + factor * 0.2 + (isAcoustic ? 0.55 : 0) - (isRock ? 0.15 : 0))),
          instrumentalness: Math.max(0.01, Math.min(0.99, 0.1 + factor * 0.2 + (normGenre.includes('ambient') ? 0.65 : 0))),
          tempo: Math.round(75 + factor * 80 + (isPop ? 25 : 0)),
        };
      }

      // Coordinate seeding: place deterministic points using GENRE_ANCHORS
      const [x, y, z] = computeNodeCoords(artist.id, normalisedGenre, weight);

      return {
        id: artist.id,
        name: artist.name,
        genres: (artist.genres && artist.genres.length > 0) ? artist.genres : [normalisedGenre],
        popularity: artist.popularity || 50,
        imageUrl,
        weight,
        state: 'explored',
        audioSignature: signature,
        x,
        y,
        z,
      };
    });

    // Build edges
    const edges = buildSpotifyEdges(nodes);

    // Compute Centroid (HomeRegion) & Summary Narrative
    const homeRegion = computeHomeRegion(nodes);
    const summary = generateTasteSummary(nodes, homeRegion);

    // Store in sqlite database!
    await prisma.user.update({
      where: { spotifyId: userId },
      data: {
        globeData: JSON.stringify({ nodes, edges }), // Serialize complete user taste graph
        homeRegion: JSON.stringify(homeRegion),
        tasteSummary: summary,
        lastSyncAt: new Date(),
        syncStatus: 'COMPLETE',
        displayName: userProfile.display_name,
        avatarUrl: userProfile.images?.[0]?.url ?? '',
        country: userProfile.country,
      },
    });

    console.log(`[Spotify Sync] User sync finished successfully for spotifyId: ${userId}`);
  } catch (err) {
    console.error('[Spotify Sync] Severe error running sync pipeline:', err);
    await prisma.user.update({
      where: { spotifyId: userId },
      data: { syncStatus: 'FAILED' },
    });
    throw err;
  }
}
