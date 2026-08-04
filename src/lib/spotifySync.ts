import { prisma } from '@/lib/prisma';
import { fetchWithTimeout } from '@/lib/utils/fetch-timeout';
import { normaliseGenre, GENRE_ANCHORS, latLngToXYZ, InternalGenre } from '@/lib/graph/genre-normaliser';
import type { OrcaNode, OrcaEdge, AudioSignature } from '@/lib/graph/types';
import { fetchLastFmArtistInfo, ICONIC_SEEDS } from './lastfm';
import { computeUserProfile } from '@/lib/profile/profile-engine';
import type { UserProfile } from '@/lib/profile/types';
import { processArtistLatentRepresentation, seedTraitDefinitions } from '@/lib/latent/latent-space';
import { computeUserTerritoryMapping } from '@/lib/profile/territory-mapping';
import { resolveAudioSignature, isRealAudio } from '@/lib/audio/resolve-signature';
import { resolveArtistRealAudio } from '@/lib/audio/embedding-cache';

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

interface SpotifyProfile {
  display_name: string;
  country: string;
  images: Array<{ url: string }>;
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function spotifyFetch(endpoint: string, token: string): Promise<any> {
  const url = `https://api.spotify.com/v1${endpoint}`;
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeRequest = async (retries = 2): Promise<any> => {
    const res = await fetchWithTimeout(url, {
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
    return (data.items || []).map((item: { track: SpotifyTrack }) => item.track);
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
      const items = (data.items || []).map((item: { track: SpotifyTrack }) => item.track);
      tracks.push(...items);
      nextUrl = data.next ? data.next.replace('https://api.spotify.com/v1', '') : null;
    }
  } catch (err) {
    console.error(`[Spotify Sync] Error fetching saved tracks:`, err);
  }
  return tracks.slice(0, limit);
}

// REMOVED (ORCA Backend Fix Part 1 — 2026):
// Spotify GET /v1/audio-features is permanently restricted for new developer
// apps (2024-11-27) and closed for existing apps (2026-03-09). Do NOT re-add
// fetchAudioFeaturesBatch or any /audio-features call. Acoustic distance uses
// Tier-1 Deezer preview + embedding cache (src/lib/audio/*) instead.
// Identity still uses Spotify for the user's own listening history only.

interface DecomposedWeight {
  frequencyScore: number;
  recencyScore: number;
  persistenceScore: number;
  weightShort: number;
  weightMedium: number;
  weightLong: number;
}

function decomposeArtistWeight(input: {
  topRankShort: number | null;
  topRankMedium: number | null;
  topRankLong: number | null;
  recentPlayCount: number;
  savedTrackCount: number;
}): DecomposedWeight {
  const freqPlays = Math.min(1.0, input.recentPlayCount / 10);
  const freqSaves = Math.min(1.0, input.savedTrackCount / 5);
  const frequencyScore = Math.max(0.05, 0.5 * freqPlays + 0.5 * freqSaves);

  const shortTermRankVal = input.topRankShort !== null ? (51 - input.topRankShort) / 50 : 0.0;
  const recentPlaysVal = Math.min(1.0, input.recentPlayCount / 5);
  const recencyScore = Math.max(0.05, 0.2 + 0.5 * shortTermRankVal + 0.3 * recentPlaysVal);

  const longTermRankVal = input.topRankLong !== null ? (51 - input.topRankLong) / 50 : 0.0;
  const mediumTermRankVal = input.topRankMedium !== null ? (51 - input.topRankMedium) / 50 : 0.0;
  const persistenceScore = Math.max(0.05, 0.2 + 0.5 * longTermRankVal + 0.3 * mediumTermRankVal);

  const weightShort = Math.max(0.05, Math.min(1.0, recencyScore * frequencyScore));
  const weightLong = Math.max(0.05, Math.min(1.0, persistenceScore * frequencyScore));
  const weightMedium = computeArtistWeight(input);

  return {
    frequencyScore,
    recencyScore,
    persistenceScore,
    weightShort,
    weightMedium,
    weightLong,
  };
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

/**
 * Part 1: write real_audio signatures into Artist.metadata so the frontier
 * path can reuse Tier-1 embeddings. Merges into existing metadata JSON so
 * ORE retrieval fields survive.
 */
async function persistRealAudioSignatures(nodes: OrcaNode[]): Promise<void> {
  const realNodes = nodes.filter(
    (n) => isRealAudio(n.audioSource ?? n.confidenceTag) && n.audioSignature,
  );
  if (realNodes.length === 0) return;

  await Promise.allSettled(
    realNodes.map(async (node) => {
      try {
        const existing = await prisma.artist.findUnique({
          where: { id: node.id },
          select: { metadata: true },
        });
        let meta: Record<string, unknown> = {};
        if (existing?.metadata) {
          try {
            meta = JSON.parse(existing.metadata) as Record<string, unknown>;
          } catch {
            meta = {};
          }
        }
        meta.audioSignature = node.audioSignature;
        meta.audioSource = 'real_audio';
        meta.confidenceTag = 'real_audio';
        await prisma.artist.upsert({
          where: { id: node.id },
          update: { metadata: JSON.stringify(meta) },
          create: {
            id: node.id,
            spotifyId: node.id,
            displayName: node.name,
            normalizedName: node.name.toLowerCase().trim(),
            rawGenres: JSON.stringify(node.genres || []),
            popularity: node.popularity || 50,
            followers: 0,
            imageUrl: node.imageUrl || null,
            metadata: JSON.stringify(meta),
          },
        });
      } catch (err) {
        console.warn(`[Spotify Sync] Failed to persist real_audio for ${node.id}:`, err);
      }
    }),
  );
}

// Compute the user's primary taste centroid (HomeRegion)
export function computeHomeRegion(nodes: OrcaNode[]): { lat: number; lng: number; label: string; spread: number } {
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
export function generateTasteSummary(nodes: OrcaNode[]): string {
  const nodeCount = nodes.length;
  const genres = new Set(nodes.map(n => n.genres[0] || 'pop'));
  const uniqueGenresCount = genres.size;

  return `${nodeCount} artists • ${uniqueGenresCount} genres`;
}

// Build edges between user artists based on genre overlap and audio similarity
export function buildSpotifyEdges(nodes: OrcaNode[]): OrcaEdge[] {
  const edges: OrcaEdge[] = [];
  const edgeSet = new Set<string>();

  const addEdge = (src: string, tgt: string, type: 'genre' | 'audio-similar', w: number) => {
    const key = src < tgt ? `${src}:${tgt}` : `${tgt}:${src}`;
    if (edgeSet.has(key) || src === tgt) return;
    edgeSet.add(key);
    edges.push({ source: src, target: tgt, type, weight: w });
  };

  // 1. Same-genre ring: each node → up to 2 peers in normalised genre (not full clique)
  const byGenre = new Map<string, OrcaNode[]>();
  nodes.forEach((node) => {
    const primary = normaliseGenre(node.genres?.length ? node.genres : ['pop']);
    if (!byGenre.has(primary)) byGenre.set(primary, []);
    byGenre.get(primary)!.push(node);
  });

  byGenre.forEach((genreNodes) => {
    if (genreNodes.length < 2) return;
    for (let i = 0; i < genreNodes.length; i++) {
      for (let j = 1; j <= Math.min(2, genreNodes.length - 1); j++) {
        const targetNode = genreNodes[(i + j) % genreNodes.length];
        if (targetNode && targetNode.id !== genreNodes[i].id) {
          addEdge(genreNodes[i].id, targetNode.id, 'genre', 0.5);
        }
      }
    }
  });

  // 2. Each artist → top-K audio-similar only (never fully mesh — that collapses layout)
  const K = 2;
  for (let i = 0; i < nodes.length; i++) {
    if (!nodes[i].audioSignature) continue;
    const scored: { j: number; sim: number }[] = [];
    for (let j = 0; j < nodes.length; j++) {
      if (i === j || !nodes[j].audioSignature) continue;
      const sim = audioCosineSimilarity(nodes[i].audioSignature!, nodes[j].audioSignature!);
      if (sim > 0.55) scored.push({ j, sim });
    }
    scored.sort((a, b) => b.sim - a.sim);
    for (const s of scored.slice(0, K)) {
      addEdge(nodes[i].id, nodes[s.j].id, 'audio-similar', s.sim);
    }
  }

  return edges;
}

function audioCosineSimilarity(a: AudioSignature, b: AudioSignature): number {
  // Inline scalar dot product — eliminates two 6-element array allocations per call.
  // At O(N²) call volume (up to 90,000 calls/sync), this removes ~180,000 transient arrays.
  const nt = (t: number) => Math.max(0, Math.min(1, (t - 40) / 160));
  const a5 = nt(a.tempo);
  const b5 = nt(b.tempo);
  const dot = a.energy * b.energy + a.valence * b.valence + a.danceability * b.danceability
            + a.acousticness * b.acousticness + a.instrumentalness * b.instrumentalness + a5 * b5;
  const mag1 = Math.sqrt(
    a.energy ** 2 + a.valence ** 2 + a.danceability ** 2
    + a.acousticness ** 2 + a.instrumentalness ** 2 + a5 ** 2
  );
  const mag2 = Math.sqrt(
    b.energy ** 2 + b.valence ** 2 + b.danceability ** 2
    + b.acousticness ** 2 + b.instrumentalness ** 2 + b5 ** 2
  );
  return mag1 === 0 || mag2 === 0 ? 0 : dot / (mag1 * mag2);
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
      rawArtists = FALLBACK_POPULAR_SEEDS.map((s) => ({
        id: s.id,
        name: s.name,
        genres: s.genres,
        popularity: s.popularity,
        images: [],
      }));
    }

    // Prepare helper maps for computing weights
    // (Part 1: no Spotify /audio-features — Tier-1 embeddings applied below.)
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

    // Build the processed nodes list (tag_inferred first; Tier-1 fill next).
    const nodes: OrcaNode[] = rawArtists.map(artist => {
      const decomp = decomposeArtistWeight({
        topRankShort: shortRanks.get(artist.id) ?? null,
        topRankMedium: mediumRanks.get(artist.id) ?? null,
        topRankLong: longRanks.get(artist.id) ?? null,
        recentPlayCount: recentPlayCounts.get(artist.id) ?? 0,
        savedTrackCount: savedTrackCounts.get(artist.id) ?? 0,
      });
      const weight = decomp.weightMedium;

      const normalisedGenre = normaliseGenre(artist.genres);

      // Prefer largest Spotify image (images[0]); fall back to smaller sizes.
      const imageUrl =
        artist.images?.[0]?.url ?? artist.images?.[1]?.url ?? artist.images?.[2]?.url ?? '';

      // Part 1: default to tag_inferred (genre/hash). real_audio only after Tier-1 embed.
      const { signature, source: audioSource, confidenceTag } = resolveAudioSignature({
        artistId: artist.id,
        genres: (artist.genres && artist.genres.length > 0) ? artist.genres : [normalisedGenre],
        real: null,
      });

      // Coordinate seeding: place deterministic points using GENRE_ANCHORS
      const [x, y, z] = computeNodeCoords(artist.id, normalisedGenre, weight);

      const rawGenres =
        artist.genres && artist.genres.length > 0 ? artist.genres : [normalisedGenre];
      // Primary InternalGenre first so globe seed + layout never clump on raw tags.
      const genresPrimaryFirst = [
        normalisedGenre,
        ...rawGenres.filter((g) => normaliseGenre([g]) !== normalisedGenre),
      ];

      return {
        id: artist.id,
        name: artist.name,
        genres: genresPrimaryFirst,
        popularity: artist.popularity || 50,
        imageUrl,
        weight,
        state: 'explored' as const,
        audioSignature: signature,
        audioSource,
        confidenceTag,
        x,
        y,
        z,
        weightShort: decomp.weightShort,
        weightMedium: decomp.weightMedium,
        weightLong: decomp.weightLong,
        frequencyScore: decomp.frequencyScore,
        recencyScore: decomp.recencyScore,
        persistenceScore: decomp.persistenceScore,
      };
    });

    // Tier-1 (optional): Deezer preview → embedding for top-weighted artists.
    // Gated by ORCA_EMBEDDING_URL or ORCA_EMBEDDING_ALLOW_MOCK; never invents real_audio.
    {
      const ranked = [...nodes].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
      const tier1Cap = Math.min(15, ranked.length);
      for (let i = 0; i < tier1Cap; i += 3) {
        const batch = ranked.slice(i, i + 3);
        await Promise.all(
          batch.map(async (n) => {
            try {
              const real = await resolveArtistRealAudio({
                artistId: n.id,
                artistName: n.name,
              });
              if (real) {
                n.audioSignature = real.signature;
                n.audioSource = 'real_audio';
                n.confidenceTag = 'real_audio';
              }
            } catch (err) {
              console.warn(`[Spotify Sync] Tier-1 embed skipped for ${n.name}:`, err);
            }
          }),
        );
      }
    }

    // Multi-provider fill for empty genres or weak images (Last.fm / Deezer / MB / Wiki).
    // Spotify is primary; this covers long-tail artists Spotify returns without genres.
    {
      const { enrichArtistIdentity, isWeakImageUrl } = await import(
        '@/lib/artists/enrich-identity'
      );
      const needEnrich = nodes.filter(
        (n) =>
          !n.genres?.length ||
          (n.genres.length === 1 && n.genres[0] === normaliseGenre([])) ||
          isWeakImageUrl(n.imageUrl),
      );
      // Cap to avoid blocking sync for huge libraries
      const cap = needEnrich.slice(0, 40);
      for (let i = 0; i < cap.length; i += 5) {
        const batch = cap.slice(i, i + 5);
        await Promise.all(
          batch.map(async (n) => {
            try {
              const enr = await enrichArtistIdentity({
                name: n.name,
                spotifyId: n.id,
                genres: n.genres,
                imageUrl: n.imageUrl,
                popularity: n.popularity,
              });
              if (enr.genres.length > 0) n.genres = enr.genres;
              if (enr.imageUrl && isWeakImageUrl(n.imageUrl)) n.imageUrl = enr.imageUrl;
              if (enr.popularity) n.popularity = enr.popularity;
            } catch (err) {
              console.warn(`[Spotify Sync] enrich failed for ${n.name}:`, err);
            }
          }),
        );
      }
    }

    // Persist real_audio signatures onto Artist.metadata so frontier Expansion
    // Intelligence can prefer them over tag_inferred (Part 1). Non-blocking.
    void persistRealAudioSignatures(nodes);

    // Build edges
    const edges = buildSpotifyEdges(nodes);

    // Compute Centroid (HomeRegion) & Summary Narrative
    const homeRegion = computeHomeRegion(nodes);
    const summary = generateTasteSummary(nodes);

    // Fetch previous profile and existing frontier count to maintain trends/readiness context
    let previousProfile: UserProfile | null = null;
    let existingFrontierCount = 0;
    try {
      const existingUser = await prisma.user.findUnique({
        where: { spotifyId: userId },
        select: { profileData: true, frontierData: true },
      });
      if (existingUser?.profileData) {
        previousProfile = JSON.parse(existingUser.profileData);
      }
      if (existingUser?.frontierData) {
        const parsedFrontier = JSON.parse(existingUser.frontierData);
        existingFrontierCount = Array.isArray(parsedFrontier) ? parsedFrontier.length : 0;
      }
    } catch (e) {
      console.warn('[Spotify Sync] Failed to retrieve previous profile/frontier data:', e);
    }

    // Compute User Profile (Phase 3)
    const profile = computeUserProfile(userId, nodes, existingFrontierCount, previousProfile);

    // Process and store canonical artist embeddings in backend database
    try {
      console.log(`[Spotify Sync] Generating latent space representations for ${nodes.length} artists...`);
      await seedTraitDefinitions();

      // Fan out all embedding writes concurrently instead of awaiting each one serially.
      // Turns 200+ sequential DB round-trips into a single Promise.allSettled batch.
      await Promise.allSettled(
        nodes.map(node =>
          processArtistLatentRepresentation({
            spotifyId: node.id,
            name: node.name,
            genres: node.genres || [],
            popularity: node.popularity || 50,
            followers: 0,
            imageUrl: node.imageUrl || '',
            audioSignature: node.audioSignature,
            bio: undefined,
          }).catch(err => {
            console.warn(`[Spotify Sync] Failed to generate embedding for artist ${node.name}:`, err);
          })
        )
      );
      console.log(`[Spotify Sync] Finished embedding generation.`);
    } catch (err) {
      console.error('[Spotify Sync] Failed to seed/process latent space embeddings:', err);
    }

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
        profileData: JSON.stringify(profile),
        profileVersion: profile.version,
        profileComputedAt: new Date(),
      },
    });

    try {
      console.log(`[Spotify Sync] Computing user territory mapping for ${userId}...`);
      await computeUserTerritoryMapping(userId);
    } catch (territoryErr) {
      const err = territoryErr as Error;
      console.error(`[Spotify Sync] Failed to compute territory mapping:`, err.message);
    }

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
