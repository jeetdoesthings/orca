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

    // Save to cache
    memoryCache[normName] = {
      id: resolved.id,
      name: resolved.name,
      genres: resolved.genres || [],
      popularity: resolved.popularity,
      imageUrl: resolved.images?.[0]?.url || '',
    };
    saveCache();

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
  accessToken: string
): Promise<OrcaNode[]> {
  if (exploredArtists.length === 0) return [];

  // ── Genre-diversified source selection ──
  // Instead of just top-20 by weight (which are often all one genre),
  // sample top artists from each genre biome to ensure frontier diversity.
  const genreBuckets = new Map<string, OrcaNode[]>();
  for (const a of exploredArtists) {
    const genre = normaliseGenre(a.genres);
    const bucket = genreBuckets.get(genre) || [];
    bucket.push(a);
    genreBuckets.set(genre, bucket);
  }

  // Sort each bucket by weight, take top N per genre.
  // Increase diversity: cap targetExplored at 80 instead of 30, and pull up to 8 per genre.
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
  const candidateMap = new Map<string, { artist: SpotifyArtist; adjacentTo: string[] }>();

  // ── Bypass Spotify related artists API entirely ──
  // Spotify's /related-artists endpoint is officially deprecated and returns 403 Forbidden.
  // We bypass it and directly trigger the Last.fm + Spotify Search fallback pipeline.
  const isForbidden = true;

  if (isForbidden) {
    console.log(`[Frontier build] Spotify related-artists deprecated. Using Last.fm + Spotify Search cache pipeline...`);
    
    // Get Last.fm similar artists for our top explored nodes across genres
    // Increase source set from 25 to 60 to expand candidate diversity
    const exploredKeys = new Set(exploredArtists.map(a => getStandardisedComparisonKey(a.name)));
    const fallbackSourceArtists = targetExplored.slice(0, 60);
    const fallbackCandidatesMap = new Map<string, { name: string; adjacentTo: string[] }>();

    for (const a of fallbackSourceArtists) {
      const similars = await fetchLastFmSimilarArtists(a.name, 6);
      if (similars) {
        for (const sim of similars) {
          const canonId = sim.name.toLowerCase().trim();
          const stdName = getStandardisedComparisonKey(sim.name);
          if (exploredIds.has(sim.mbid || '') || exploredKeys.has(stdName)) {
            continue; // already explored — skip
          }
          const existing = fallbackCandidatesMap.get(canonId);
          if (existing) {
            if (!existing.adjacentTo.includes(a.id)) {
              existing.adjacentTo.push(a.id);
            }
          } else {
            fallbackCandidatesMap.set(canonId, {
              name: sim.name,
              adjacentTo: [a.id],
            });
          }
        }
      }
    }

    // Now resolve candidates on Spotify using search API (checked against our cache first)
    const rawCandidates = Array.from(fallbackCandidatesMap.values()).slice(0, 120); // up to 120 candidates
    console.log(`[Frontier build] Found ${rawCandidates.length} unique Last.fm fallback candidates. Resolving on Spotify...`);

    const resolvedSpotifyArtists: { artist: SpotifyArtist; adjacentTo: string[] }[] = [];
    
    // To prevent hitting Spotify 429s, we limit new uncached Spotify searches in a single run.
    let newSearchesCount = 0;
    const MAX_NEW_SEARCHES_PER_RUN = 25;
    let spotifyRateLimited = false;

    for (const c of rawCandidates) {
      const normName = c.name.toLowerCase().trim();
      const isCached = !!memoryCache[normName];

      let spotifyArtist: SpotifyArtist | null = null;

      if (isCached) {
        spotifyArtist = await searchSpotifyArtist(c.name, accessToken);
      } else if (!spotifyRateLimited && newSearchesCount < MAX_NEW_SEARCHES_PER_RUN) {
        newSearchesCount++;
        spotifyArtist = await searchSpotifyArtist(c.name, accessToken);
        
        if (!spotifyArtist) {
          console.warn(`[Frontier build] Spotify search failed or was rate limited for ${c.name}. Bypassing subsequent live searches in this run to avoid hangs.`);
          spotifyRateLimited = true;
        }

        // Delay to avoid spamming the Spotify API
        if (!isCached) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }

      if (!spotifyArtist) {
        // Fall back to a mock artist profile using Last.fm candidate data!
        // Matches standard format: lastfm-name
        const mockId = `lastfm-${getStandardisedComparisonKey(c.name)}`;
        
        if (!exploredIds.has(mockId)) {
          let genres = ['pop'];
          const firstSourceId = c.adjacentTo[0];
          if (firstSourceId) {
            const srcNode = exploredArtists.find(e => e.id === firstSourceId);
            if (srcNode && srcNode.genres) {
              genres = srcNode.genres;
            }
          }
          
          spotifyArtist = {
            id: mockId,
            name: c.name,
            genres: genres,
            popularity: 45,
            images: [],
          };
        }
      }

      if (spotifyArtist && !exploredIds.has(spotifyArtist.id)) {
        resolvedSpotifyArtists.push({ artist: spotifyArtist, adjacentTo: c.adjacentTo });
      }
    }

    console.log(`[Frontier build] Resolved ${resolvedSpotifyArtists.length} candidates (performed ${newSearchesCount} new Spotify API searches).`);

    // Map resolved Spotify artists to candidateMap
    for (const item of resolvedSpotifyArtists) {
      const existing = candidateMap.get(item.artist.id);
      if (existing) {
        // Merge adjacentTo connections
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
  }

  console.log(`[Debug Frontier] Deduped candidates count: ${candidateMap.size}`);

  // Convert candidates to fully-fledged OrcaNode elements
  const candidates: ScoredCandidate[] = Array.from(candidateMap.values()).map(({ artist, adjacentTo }) => {
    const normalisedGenre = normaliseGenre(artist.genres);
    const weight = 0.3; // Frontier weight per specification
    // ── Position in own genre biome on the globe ──
    let [x, y, z] = computeNodeCoords(artist.id, normalisedGenre, weight);

    // Pull closer to adjacent explored nodes
    const adjacentPositions: [number, number, number][] = [];
    for (const adjId of adjacentTo) {
      const expNode = exploredArtists.find(e => e.id === adjId);
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

      // Pull 40% towards the average position of similar explored nodes
      const pullFactor = 0.4;
      x = x * (1 - pullFactor) + avgX * pullFactor;
      y = y * (1 - pullFactor) + avgY * pullFactor;
      z = z * (1 - pullFactor) + avgZ * pullFactor;

      // Project back onto the sphere of radius R * 1.008
      const currentRadius = Math.sqrt(x * x + y * y + z * z);
      const targetRadius = 1.65 * 1.008;
      if (currentRadius > 0) {
        x = (x / currentRadius) * targetRadius;
        y = (y / currentRadius) * targetRadius;
        z = (z / currentRadius) * targetRadius;
      }
    }

    // Seed a mock AudioSignature for dynamic cosine queries
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

    const node: OrcaNode = {
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
    };

    const score = computeFrontierScore(node, exploredArtists, adjacentTo);

    return {
      node,
      score,
      adjacentTo,
    };
  });

  console.log(`[Debug Frontier] Total candidate nodes generated: ${candidates.length}`);
  if (candidates.length > 0) {
    const scores = candidates.map(c => c.score);
    const avgScore = scores.reduce((s, x) => s + x, 0) / scores.length;
    console.log(`[Debug Frontier] Score stats: min=${Math.min(...scores).toFixed(2)}, max=${Math.max(...scores).toFixed(2)}, avg=${avgScore.toFixed(2)}`);
    const passMinScore = candidates.filter(c => c.score >= 10).length;
    console.log(`[Debug Frontier] Candidates passing minScore (>= 10): ${passMinScore}`);
  }

  return selectFrontierNodes(candidates);
}
