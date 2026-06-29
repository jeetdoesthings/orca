import { prisma } from '@/lib/prisma';
import type { OrcaNode, AudioSignature } from '@/lib/graph/types';
import type { InternalGenre } from '@/lib/graph/genre-normaliser';
import { normaliseGenre, getGenreColor, xyzToLatLng } from '@/lib/graph/genre-normaliser';
import { computeNodeCoords } from '@/lib/spotifySync';
import { fetchLastFmSimilarArtists } from '../lastfm';
import { getCanonicalArtistName, getStandardisedComparisonKey } from '../identity';
import fs from 'fs';
import path from 'path';

const CACHE_FILE = path.join(process.cwd(), 'src/lib/frontier/spotify-artists-cache.json');

interface CachedArtist {
  id: string;
  name: string;
  genres: string[];
  popularity: number;
  imageUrl: string;
}

let memoryCache: Record<string, CachedArtist> = {};

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = fs.readFileSync(CACHE_FILE, 'utf-8');
      memoryCache = JSON.parse(data);
    }
  } catch (err) {
    console.error('[Frontier Cache] Failed to load cache:', err);
  }
}

function saveCache() {
  try {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(memoryCache, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Frontier Cache] Failed to save cache:', err);
  }
}

// Load cache immediately
loadCache();

interface SpotifyArtist {
  id: string;
  name: string;
  genres?: string[];
  popularity: number;
  images: Array<{ url: string; width?: number }>;
}

export interface ScoredCandidate {
  node: OrcaNode;
  score: number;
  adjacentTo: string[];
}

const R = 1.65;

/**
 * Calculates geographic distance on a sphere of radius R between two lat/lng coordinates (in degrees)
 */
export function globeDistance(
  a: { lat: number; lng: number } | OrcaNode,
  b: { lat: number; lng: number } | OrcaNode
): number {
  const getLatLng = (obj: any) => {
    if (typeof obj.lat === 'number' && typeof obj.lng === 'number') {
      return { lat: obj.lat, lng: obj.lng };
    }
    if (typeof obj.x === 'number' && typeof obj.y === 'number' && typeof obj.z === 'number') {
      return xyzToLatLng(obj.x, obj.y, obj.z);
    }
    return { lat: 0, lng: 0 };
  };

  const posA = getLatLng(a);
  const posB = getLatLng(b);

  const dLat = posA.lat - posB.lat;
  const dLng = posA.lng - posB.lng;
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

/**
 * Check if two nodes are musically adjacent based on genres, related-artists, or biome proximity
 */
export function isAdjacent(
  explored: OrcaNode,
  candidate: OrcaNode,
  spotifyRelatedIds: Set<string>
): boolean {
  // Condition 1: Same normalised primary genre tag
  const exploredPrimary = normaliseGenre(explored.genres);
  const candidatePrimary = normaliseGenre(candidate.genres);
  const sharedGenreTag = exploredPrimary === candidatePrimary;

  // Condition 2: Spotify's related artists
  const inSpotifyRelated = spotifyRelatedIds.has(candidate.id);

  // Condition 3: Same globe biome, within 20 degrees distance on the sphere surface
  const sameGlobeBiome = exploredPrimary === candidatePrimary;
  const distance = globeDistance(explored, candidate);
  const closeOnGlobe = sameGlobeBiome && distance < 20;

  return sharedGenreTag || inSpotifyRelated || closeOnGlobe;
}

/**
 * Computes how strongly connected an unexplored node is to explored territory
 */
export function computeFrontierScore(
  candidate: OrcaNode,
  exploredNodes: OrcaNode[],
  adjacentToIds: string[]
): number {
  const adjacentExplored = exploredNodes.filter(e => adjacentToIds.includes(e.id));
  if (adjacentExplored.length === 0) return 0;

  // 1. Connection score: more connections = higher evidence (caps at 5 connections / 40 pts)
  const connectionScore = Math.min(adjacentExplored.length / 5, 1.0) * 40;

  // 2. Weight score: average listen weight of adjacent explored nodes (30 pts max)
  const avgWeight = adjacentExplored.reduce((s, a) => s + a.weight, 0) / adjacentExplored.length;
  const weightScore = avgWeight * 30;

  // 3. Proximity score: closest distance on sphere (closer = higher score, 20 pts max)
  const distances = adjacentExplored.map(e => globeDistance(candidate, e));
  const minDistance = Math.min(...distances);
  const proximityScore = Math.max(0, (20 - minDistance) / 20) * 20;

  // 4. Popularity penalty: slightly deprioritise mega-mainstream artists (max 10 pts penalty)
  const popularityPenalty = candidate.popularity > 85 ? -10 : 0;

  return connectionScore + weightScore + proximityScore + popularityPenalty;
}

/**
 * Caps total nodes at 80, caps per-genre biome at 15 to ensure diversity
 */
export function selectFrontierNodes(
  allCandidates: ScoredCandidate[],
  minScore = 5,
  totalCap = 150,
  perBiomeCap = 25
): OrcaNode[] {
  const sorted = allCandidates
    .filter(c => c.score >= minScore)
    .sort((a, b) => b.score - a.score);

  const biomeCounts: Record<string, number> = {};
  const selected: OrcaNode[] = [];

  for (const candidate of sorted) {
    if (selected.length >= totalCap) break;

    const primaryGenre = normaliseGenre(candidate.node.genres);
    const biomeCount = biomeCounts[primaryGenre] || 0;
    if (biomeCount >= perBiomeCap) continue;

    selected.push(candidate.node);
    biomeCounts[primaryGenre] = biomeCount + 1;
  }

  return selected;
}

/**
 * Spotify Search API helper to resolve Last.fm candidate artist details
 */
async function searchSpotifyArtist(
  name: string,
  token: string,
  retries = 0
): Promise<SpotifyArtist | null> {
  const normName = name.toLowerCase().trim();
  if (memoryCache[normName]) {
    const cached = memoryCache[normName];
    return {
      id: cached.id,
      name: cached.name,
      genres: cached.genres,
      popularity: cached.popularity,
      images: cached.imageUrl ? [{ url: cached.imageUrl }] : [],
    };
  }

  if (retries > 1) {
    console.warn(`[Frontier build] Max retries reached for search of ${name}. Skipping.`);
    return null;
  }

  try {
    const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(name)}&type=artist&limit=1`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 429) {
      console.warn(`[Frontier build] Spotify search rate limited (429) for ${name}. Returning null.`);
      return null;
    }

    if (!res.ok) {
      return null;
    }

    const data = await res.json();
    const artist = data.artists?.items?.[0];
    if (!artist) return null;

    const resolved: SpotifyArtist = {
      id: artist.id,
      name: artist.name,
      genres: artist.genres,
      popularity: artist.popularity,
      images: artist.images || [],
    };

    // Update in-memory cache — caller is responsible for flushing to disk once
    memoryCache[normName] = {
      id: resolved.id,
      name: resolved.name,
      genres: resolved.genres || [],
      popularity: resolved.popularity,
      imageUrl: resolved.images?.[0]?.url || '',
    };

    return resolved;
  } catch (error) {
    console.error(`[Frontier build] Spotify search failed for ${name}:`, error);
    return null;
  }
}

/**
 * Direct Spotify API related artists fetcher helper
 */
async function fetchRelatedArtists(artistId: string, token: string, retries = 0): Promise<SpotifyArtist[] | null> {
  if (retries > 2) {
    console.warn(`[Frontier build] Max retries reached for artist ${artistId}. Skipping...`);
    return [];
  }
  try {
    const url = `https://api.spotify.com/v1/artists/${artistId}/related-artists`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 429) {
      let retryAfter = parseInt(res.headers.get('Retry-After') || '2', 10);
      if (isNaN(retryAfter) || retryAfter > 3) {
        retryAfter = 2; // Capped to avoid massive hanging
      }
      console.warn(`[Frontier build] 429 Rate Limited for artist ${artistId}. Sleeping for ${retryAfter}s (retry ${retries + 1})...`);
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      return fetchRelatedArtists(artistId, token, retries + 1);
    }

    if (!res.ok) {
      if (res.status === 403 || res.status === 401) {
        console.warn(`[Frontier build] Related artists fetch forbidden or unauthorized (${res.status}) for artist ${artistId}. Direct catalog restricted.`);
        return null;
      }
      console.warn(`[Frontier build] HTTP ${res.status} for artist ${artistId}. Skipping...`);
      return [];
    }

    const data = await res.json();
    return data.artists || [];
  } catch (error) {
    console.error(`[Frontier build] Error fetching related artists for ${artistId}:`, error);
    return [];
  }
}

/**
 * Builds the list of frontier nodes adjacent to the user's explored nodes
 */
export async function buildFrontierNodes(
  exploredArtists: OrcaNode[],
  accessToken: string,
  userId: string
): Promise<OrcaNode[]> {
  if (exploredArtists.length === 0) return [];

  // ── Genre-diversified source selection ──
  const genreBuckets = new Map<string, OrcaNode[]>();
  for (const a of exploredArtists) {
    const genre = normaliseGenre(a.genres);
    const bucket = genreBuckets.get(genre) || [];
    bucket.push(a);
    genreBuckets.set(genre, bucket);
  }

  const perGenreLimit = Math.max(5, Math.ceil(80 / genreBuckets.size));
  const targetExplored: OrcaNode[] = [];
  for (const [, bucket] of genreBuckets) {
    bucket.sort((a, b) => b.weight - a.weight);
    targetExplored.push(...bucket.slice(0, perGenreLimit));
  }
  
  if (targetExplored.length > 80) {
    targetExplored.sort((a, b) => b.weight - a.weight);
    targetExplored.length = 80;
  }

  const exploredIds = new Set(exploredArtists.map(a => a.id));
  const exploredArtistMap = new Map(exploredArtists.map(e => [e.id, e]));
  const candidateMap = new Map<string, { artist: SpotifyArtist; adjacentTo: string[] }>();

  // Last.fm similar artists fetching loop (Stage 1 Candidate Universe Builder)
  const exploredKeys = new Set(exploredArtists.map(a => getStandardisedComparisonKey(a.name)));
  const fallbackSourceArtists = targetExplored.slice(0, 60);
  const fallbackCandidatesMap = new Map<string, { name: string; adjacentTo: Set<string> }>();
  const LASTFM_CHUNK_SIZE = 10;

  for (let i = 0; i < fallbackSourceArtists.length; i += LASTFM_CHUNK_SIZE) {
    const chunk = fallbackSourceArtists.slice(i, i + LASTFM_CHUNK_SIZE);
    const results = await Promise.allSettled(chunk.map(a => fetchLastFmSimilarArtists(a.name, 6).then(similars => ({ a, similars }))));

    for (const result of results) {
      if (result.status !== 'fulfilled' || !result.value.similars) continue;
      const { a, similars } = result.value;
      for (const sim of similars) {
        const canonId = sim.name.toLowerCase().trim();
        const stdName = getStandardisedComparisonKey(sim.name);
        if (exploredIds.has(sim.mbid || '') || exploredKeys.has(stdName)) continue;
        const existing = fallbackCandidatesMap.get(canonId);
        if (existing) {
          existing.adjacentTo.add(a.id);
        } else {
          fallbackCandidatesMap.set(canonId, { name: sim.name, adjacentTo: new Set([a.id]) });
        }
      }
    }
  }

  const rawCandidates = Array.from(fallbackCandidatesMap.entries()).slice(0, 120);
  const resolvedSpotifyArtists: { artist: SpotifyArtist; adjacentTo: string[] }[] = [];

  let newSearchesCount = 0;
  const MAX_NEW_SEARCHES_PER_RUN = 25;
  let spotifyRateLimited = false;

  for (const [, c] of rawCandidates) {
    const normName = c.name.toLowerCase().trim();
    const isCached = !!memoryCache[normName];
    const adjacentToArr = Array.from(c.adjacentTo);

    let spotifyArtist: SpotifyArtist | null = null;

    if (isCached) {
      spotifyArtist = await searchSpotifyArtist(c.name, accessToken);
    } else if (!spotifyRateLimited && newSearchesCount < MAX_NEW_SEARCHES_PER_RUN) {
      newSearchesCount++;
      spotifyArtist = await searchSpotifyArtist(c.name, accessToken);

      if (!spotifyArtist) {
        spotifyRateLimited = true;
      }
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    if (!spotifyArtist) {
      const mockId = `lastfm-${getStandardisedComparisonKey(c.name)}`;
      if (!exploredIds.has(mockId)) {
        let genres = ['pop'];
        const firstSourceId = adjacentToArr[0];
        if (firstSourceId) {
          const srcNode = exploredArtistMap.get(firstSourceId);
          if (srcNode?.genres) genres = srcNode.genres;
        }
        spotifyArtist = { id: mockId, name: c.name, genres, popularity: 45, images: [] };
      }
    }

    if (spotifyArtist && !exploredIds.has(spotifyArtist.id)) {
      resolvedSpotifyArtists.push({ artist: spotifyArtist, adjacentTo: adjacentToArr });
    }
  }

  saveCache();

  for (const item of resolvedSpotifyArtists) {
    const existing = candidateMap.get(item.artist.id);
    if (existing) {
      for (const adjId of item.adjacentTo) {
        if (!existing.adjacentTo.includes(adjId)) {
          existing.adjacentTo.push(adjId);
        }
      }
    } else {
      candidateMap.set(item.artist.id, {
        artist: item.artist,
        adjacentTo: item.adjacentTo,
      });
    }
  }

  // ── Stage 2: ORCA Candidate Selection Engine (OCSE) ──
  console.log(`[OCSE] Starting evaluation for user ${userId} on ${candidateMap.size} candidates...`);

  let currentUserId = userId;
  if (!currentUserId || currentUserId === '') {
    const demoUser = await prisma.user.findFirst({
      where: { syncStatus: 'COMPLETE' },
      select: { spotifyId: true }
    });
    currentUserId = demoUser?.spotifyId || 'demo';
  }

  const [
    relationships,
    affinities,
    familiarities,
    adoptions,
    memories,
    activeIntervention,
    bridges
  ] = await Promise.all([
    prisma.userTerritoryRelationship.findMany({ where: { userId: currentUserId } }),
    prisma.userTerritoryAffinity.findMany({ where: { userId: currentUserId } }),
    prisma.territoryFamiliarity.findMany({ where: { userId: currentUserId } }),
    prisma.territoryAdoption.findMany({ where: { userId: currentUserId } }),
    prisma.userArtistMemory.findMany({ where: { userId: currentUserId } }),
    prisma.longitudinalIntervention.findFirst({ where: { userId: currentUserId, state: 'ACTIVE' } }),
    prisma.territoryBridge.findMany({
      where: { artistId: { in: Array.from(candidateMap.keys()) } }
    })
  ]);

  const affinityMap = new Map(affinities.map(a => [a.territoryId, a.compatibilityScore]));
  const relationshipMap = new Map(relationships.map(r => [r.territoryId, r]));
  const memoryMap = new Map(memories.map(m => [m.artistId, m.persistence]));
  const bridgeSet = new Set(bridges.map(b => b.artistId));

  let activeJourneyArtistIds = new Set<string>();
  if (activeIntervention) {
    const template = await prisma.globalPathwayTemplate.findFirst({
      where: { targetTerritory: activeIntervention.targetTerritoryId }
    });
    if (template) {
      try {
        const ids: string[] = JSON.parse(template.pathwayNodes);
        ids.forEach(id => activeJourneyArtistIds.add(id));
      } catch {}
    }
  }

  const finalNodes: OrcaNode[] = [];

  for (const [artistId, { artist, adjacentTo }] of candidateMap) {
    const normalisedGenre = normaliseGenre(artist.genres);
    const affinityScore = affinityMap.get(normalisedGenre) ?? 0.5;
    const compatibility = Math.round(affinityScore * 100);

    const relRow = relationshipMap.get(normalisedGenre);
    const relState = relRow?.currentState || 'UNEXPLORED';
    const relConfidence = relRow?.stateConfidence ?? 0.8;
    
    let relScore = 15;
    if (relState === 'UNEXPLORED') relScore = 15;
    else if (relState === 'CURIOUS') relScore = 35;
    else if (relState === 'EXPLORING') relScore = 55;
    else if (relState === 'RESIDENT') relScore = 80;
    else if (relState === 'STABILIZED') relScore = 95;
    else if (relState === 'EMERGING') relScore = 70;

    const readiness = 60;
    const journeyValue = activeJourneyArtistIds.has(artistId) ? 100 : 0;
    const identityValue = relState === 'STABILIZED' ? 95 : relState === 'RESIDENT' ? 75 : 30;

    const memoryScore = memoryMap.get(artistId) ?? 0.0;
    const memoryPotential = Math.round(memoryScore * 100);
    const expansionPotential = 70;
    const recoveryPotential = (relState === 'DORMANT' || relState === 'RETURNING') ? 90 : 0;
    const bridgeUtility = bridgeSet.has(artistId) ? 95 : 0;
    const mindsetMatch = 75;

    const longitudinalConfidence = Math.round(relConfidence * 100);
    const overallConfidence = Math.round((compatibility + longitudinalConfidence) / 2);

    const intelligence = {
      compatibility,
      readiness,
      relationship: relScore,
      journeyValue,
      identityValue,
      memoryPotential,
      expansionPotential,
      recoveryPotential,
      bridgeUtility,
      mindsetMatch,
      longitudinalConfidence,
      overallConfidence
    };

    let semanticRole: 'REACHABLE' | 'BRIDGE' | 'JOURNEY_TARGET' | 'RECOVERY' | 'HIDDEN_POTENTIAL' | 'IDENTITY_REINFORCEMENT' | 'DORMANT_MEMORY' | null = null;

    if (journeyValue >= 80) {
      semanticRole = 'JOURNEY_TARGET';
    } else if (recoveryPotential >= 80) {
      semanticRole = 'RECOVERY';
    } else if (bridgeUtility >= 80) {
      semanticRole = 'BRIDGE';
    } else if (memoryPotential >= 70) {
      semanticRole = 'DORMANT_MEMORY';
    } else if (identityValue >= 75) {
      semanticRole = 'IDENTITY_REINFORCEMENT';
    } else if (expansionPotential >= 60 && compatibility >= 70) {
      semanticRole = 'HIDDEN_POTENTIAL';
    } else if (compatibility >= 50) {
      semanticRole = 'REACHABLE';
    }

    if (semanticRole && overallConfidence >= 45) {
      const weight = 0.3;
      let [x, y, z] = computeNodeCoords(artist.id, normalisedGenre, weight);

      const adjacentPositions: [number, number, number][] = [];
      for (const adjId of adjacentTo) {
        const expNode = exploredArtistMap.get(adjId);
        if (expNode && expNode.x !== undefined && expNode.y !== undefined && expNode.z !== undefined) {
          adjacentPositions.push([expNode.x, expNode.y, expNode.z]);
        }
      }

      if (adjacentPositions.length > 0) {
        let avgX = 0, avgY = 0, avgZ = 0;
        for (const pos of adjacentPositions) {
          avgX += pos[0];
          avgY += pos[1];
          avgZ += pos[2];
        }
        avgX /= adjacentPositions.length;
        avgY /= adjacentPositions.length;
        avgZ /= adjacentPositions.length;

        const pullFactor = 0.4;
        x = x * (1 - pullFactor) + avgX * pullFactor;
        y = y * (1 - pullFactor) + avgY * pullFactor;
        z = z * (1 - pullFactor) + avgZ * pullFactor;

        const currentRadius = Math.sqrt(x * x + y * y + z * z);
        const targetRadius = 1.65 * 1.008;
        if (currentRadius > 0) {
          x = (x / currentRadius) * targetRadius;
          y = (y / currentRadius) * targetRadius;
          z = (z / currentRadius) * targetRadius;
        }
      }

      const hash = artist.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      const factor = (hash % 100) / 100;
      const isPop = normalisedGenre.includes('pop') || normalisedGenre.includes('dance');
      const isRock = normalisedGenre.includes('rock') || normalisedGenre.includes('metal');
      const isAcoustic = normalisedGenre.includes('folk') || normalisedGenre.includes('classical') || normalisedGenre.includes('jazz');

      const signature: AudioSignature = {
        energy: Math.max(0.1, Math.min(0.99, 0.45 + factor * 0.3 + (isRock ? 0.25 : 0) - (isAcoustic ? 0.2 : 0))),
        valence: Math.max(0.1, Math.min(0.99, 0.5 + factor * 0.25 + (isPop ? 0.2 : 0))),
        danceability: Math.max(0.1, Math.min(0.99, 0.4 + factor * 0.3 + (isPop ? 0.35 : 0))),
        acousticness: Math.max(0.01, Math.min(0.99, 0.2 + factor * 0.2 + (isAcoustic ? 0.55 : 0) - (isRock ? 0.15 : 0))),
        instrumentalness: Math.max(0.01, Math.min(0.99, 0.1 + factor * 0.2 + (normalisedGenre.includes('ambient') ? 0.65 : 0))),
        tempo: Math.round(75 + factor * 80 + (isPop ? 25 : 0)),
      };

      const imageUrl = artist.images?.[1]?.url ?? artist.images?.[0]?.url ?? '';

      finalNodes.push({
        id: artist.id,
        name: artist.name,
        genres: artist.genres && artist.genres.length > 0 ? artist.genres : [normalisedGenre],
        popularity: artist.popularity,
        imageUrl,
        weight,
        state: 'frontier',
        audioSignature: signature,
        adjacentTo,
        x,
        y,
        z,
        candidateIntelligence: intelligence,
        semanticRole
      });
    }
  }

  console.log(`[OCSE] Selected ${finalNodes.length} nodes from ${candidateMap.size} candidates.`);
  return finalNodes.slice(0, 150);
}
