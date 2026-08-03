import { prisma } from '../prisma';
import { fetchLastFmSimilarArtists, fetchSpotifyArtist } from '../lastfm';
import { normaliseGenre } from '../graph/genre-normaliser';
import { getStandardisedComparisonKey } from '../identity';
import { OreConfig } from '../config/ore';
import { GENRE_ADJACENCY } from '../config/genre-adjacency';
import { musicbrainzLimiter } from '../utils/rate-limiter';
import { normalizeArtistName, resolveCollabToExistingRow } from '../artists/enrich-identity';
export interface OREEvidence {
  source: string; // e.g., 'Spotify Similar', 'Last.fm Similar', 'MusicBrainz Relationship', 'Local Graph'
  confidence: number;
  timestamp: string;
  metadata: any;
}

export interface ORECandidate {
  artistId: string;
  spotifyId?: string;
  musicBrainzId?: string;
  displayName: string;
  genres: string[];
  subgenres: string[];
  popularity: number;
  followers: number;
  imageUrl?: string;
  discoveryEvidence: OREEvidence[];
  retrievalDepth: number;
  retrievedAt: string;
  lastRefreshed: string;
  relationshipConfidence: number;
}

export interface OREMetrics {
  seeds: string[];
  providersQueried: string[];
  latencies: Record<string, number>;
  candidatesRetrieved: number;
  duplicatesMerged: number;
  cacheHits: number;
  cacheMisses: number;
  recursiveExpansionTree: Array<{ seed: string; children: string[] }>;
  evidenceCounts: Record<string, number>;
  missingProviders: string[];
  confidenceDistribution: Record<string, number>;
}

export interface RetrievalProvider {
  name: string;
  retrieve(
    seed: { name: string; artistId: string },
    depth: number,
    metrics?: OREMetrics,
  ): Promise<ORECandidate[]>;
}

// ── Cache Expiration Helper (7 Days) ──
const CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

// ── Save/Update Music Knowledge Graph in Database ──
async function cacheArtistInKnowledgeGraph(
  artist: ORECandidate,
  neighbors: Array<{ id: string; displayName: string; genres: string[]; popularity: number; imageUrl?: string }>
) {
  try {
    // Part 1: preserve any real_audio signature previously written by Identity
    // / Tier-1 embedding so frontier Expansion Intelligence can prefer it.
    let preservedAudio: {
      audioSignature?: unknown;
      audioSource?: unknown;
      confidenceTag?: unknown;
    } = {};
    try {
      const existing = await prisma.artist.findUnique({
        where: { id: artist.artistId },
        select: { metadata: true },
      });
      if (existing?.metadata) {
        const prev = JSON.parse(existing.metadata) as Record<string, unknown>;
        const tag = String(prev.confidenceTag ?? prev.audioSource ?? '');
        if (
          (tag === 'real_audio' || tag === 'REAL') &&
          prev.audioSignature
        ) {
          preservedAudio = {
            audioSignature: prev.audioSignature,
            audioSource: 'real_audio',
            confidenceTag: 'real_audio',
          };
        }
      }
    } catch {
      // ignore parse / miss — cache write still proceeds
    }

    const metaPayload = {
      retrievedAt: artist.retrievedAt,
      expiresAt: new Date(Date.now() + CACHE_EXPIRY_MS).toISOString(),
      providerVersion: 'ORE-2.0',
      subgenres: artist.subgenres,
      followers: artist.followers,
      musicBrainzId: artist.musicBrainzId,
      neighbors,
      ...preservedAudio,
    };

    let safeSpotifyId = artist.spotifyId || null;
    if (safeSpotifyId) {
      const existing = await prisma.artist.findFirst({
        where: { spotifyId: safeSpotifyId, id: { not: artist.artistId } },
        select: { id: true },
      });
      if (existing) safeSpotifyId = null;
    }

    try {
      // Duplicate-prevention (audit): merge into an existing row with the same
      // display name instead of creating a provider-keyed duplicate (the old
      // code upserted by `artist.artistId`, producing lastfm-* / spotify-id /
      // MBID rows for the same artist). Also write the canonical normalizedName
      // format; the old `.toLowerCase().trim()` left spaces ("kanye west"),
      // which made dedupe-by-normalizedName miss legacy rows.
      // Collaboration names ("21 Savage & Metro Boomin") resolve to the known
      // solo artist and merge there — never create a collab catalog row.
      const compactName = normalizeArtistName(artist.displayName);
      const collabTarget = await resolveCollabToExistingRow(artist.displayName);
      let effectiveId = artist.artistId;
      if (collabTarget) {
        effectiveId = collabTarget.id;
      } else {
        const existingByName = await prisma.artist.findFirst({
          where: { displayName: artist.displayName },
          select: { id: true },
        });
        if (existingByName) effectiveId = existingByName.id;
      }

      await prisma.artist.upsert({
        where: { id: effectiveId },
        update: {
          spotifyId: safeSpotifyId,
          popularity: artist.popularity,
          imageUrl: artist.imageUrl || null,
          metadata: JSON.stringify(metaPayload),
          sourceEvidence: JSON.stringify(artist.discoveryEvidence),
          normalizedName: compactName,
        },
        create: {
          id: effectiveId,
          spotifyId: safeSpotifyId,
          displayName: artist.displayName,
          normalizedName: compactName,
          rawGenres: JSON.stringify(artist.genres),
          popularity: artist.popularity,
          followers: artist.followers || 0,
          imageUrl: artist.imageUrl || null,
          metadata: JSON.stringify(metaPayload),
          sourceEvidence: JSON.stringify(artist.discoveryEvidence),
        },
      });
    } catch (upsertErr: unknown) {
      const code = typeof upsertErr === 'object' && upsertErr !== null && 'code' in upsertErr
        ? (upsertErr as { code: string }).code
        : undefined;
      if (code === 'P2002' && safeSpotifyId) {
        await prisma.artist.upsert({
          where: { id: artist.artistId },
          update: {
            spotifyId: null,
            popularity: artist.popularity,
            imageUrl: artist.imageUrl || null,
            metadata: JSON.stringify(metaPayload),
            sourceEvidence: JSON.stringify(artist.discoveryEvidence),
          },
          create: {
            id: artist.artistId,
            spotifyId: null,
            displayName: artist.displayName,
            normalizedName: artist.displayName.toLowerCase().trim(),
            rawGenres: JSON.stringify(artist.genres),
            popularity: artist.popularity,
            followers: artist.followers || 0,
            imageUrl: artist.imageUrl || null,
            metadata: JSON.stringify(metaPayload),
            sourceEvidence: JSON.stringify(artist.discoveryEvidence),
          },
        });
      } else {
        throw upsertErr;
      }
    }
  } catch (err) {
    console.warn(`[ORE] Failed to cache artist "${artist.displayName}" in database:`, err);
  }
}

export class LocalKnowledgeGraphProvider implements RetrievalProvider {
  name = 'Local Knowledge Graph';

  async retrieve(
    seed: { name: string; artistId: string },
    depth: number,
    metrics?: OREMetrics,
  ): Promise<ORECandidate[]> {
    try {
      const art = await prisma.artist.findFirst({
        where: {
          OR: [
            { id: seed.artistId },
            { normalizedName: seed.name.toLowerCase().trim() },
          ],
        },
      });

      if (!art || !art.metadata) {
        if (metrics) metrics.cacheMisses++;
        return [];
      }

      const meta = JSON.parse(art.metadata);
      const expiresAt = meta.expiresAt ? new Date(meta.expiresAt).getTime() : 0;

      // Handle Expired Cache Entry Lazily
      if (Date.now() > expiresAt) {
        if (metrics) metrics.cacheMisses++;
        return []; // Force fresh retrieval from live APIs
      }

      if (metrics) metrics.cacheHits++;
      const cachedNeighbors: any[] = meta.neighbors || [];
      
      return cachedNeighbors.map((n: any) => ({
        artistId: n.id,
        spotifyId: n.id.startsWith('spotify-') ? n.id.replace('spotify-', '') : undefined,
        displayName: n.displayName,
        genres: n.genres || [],
        subgenres: meta.subgenres || [],
        popularity: n.popularity || 40,
        followers: meta.followers || 0,
        imageUrl: n.imageUrl || undefined,
        retrievalDepth: depth,
        retrievedAt: meta.retrievedAt || new Date().toISOString(),
        lastRefreshed: new Date().toISOString(),
        relationshipConfidence: OreConfig.sourceConfidence.LOCAL_KNOWLEDGE_GRAPH,
        discoveryEvidence: [
          {
            source: 'Local Knowledge Graph',
            confidence: 0.95,
            timestamp: new Date().toISOString(),
            metadata: { parentSeedName: seed.name },
          },
        ],
      }));
    } catch (err) {
      console.warn(`[ORE] Local Knowledge Graph search failed for "${seed.name}":`, err);
      return [];
    }
  }
}

// ── PROVIDER 2: Spotify metadata resolver (no related-artists) ──
/**
 * Part 1: Spotify related-artists is permanently restricted. This provider no
 * longer expands the candidate graph via related-artists. It returns [] so
 * Last.fm / MusicBrainz / local graph own similarity expansion. Artist
 * *metadata* enrichment still uses Spotify search in LastFmProvider via
 * fetchSpotifyArtist (allowed Identity/catalog metadata, not related-artists).
 */
export class SpotifyProvider implements RetrievalProvider {
  name = 'Spotify';

  async retrieve(
    _seed: { name: string; artistId: string },
    _depth: number,
    _metrics?: OREMetrics,
  ): Promise<ORECandidate[]> {
    // Intentionally empty — do not call /related-artists (dead endpoint).
    // Similarity comes from LastFmProvider + MusicBrainzProvider.
    return [];
  }
}

// ── PROVIDER 3: Last.fm Provider ──
export class LastFmProvider implements RetrievalProvider {
  name = 'Last.fm';

  async retrieve(
    seed: { name: string; artistId: string },
    depth: number,
    _metrics?: OREMetrics,
  ): Promise<ORECandidate[]> {
    try {
      const similars = await fetchLastFmSimilarArtists(seed.name, 10);
      if (!similars || similars.length === 0) return [];

      const candidates: ORECandidate[] = [];

      for (const sim of similars) {
        const mbid = sim.mbid || '';
        let artistId = mbid || `lastfm-${getStandardisedComparisonKey(sim.name)}`;
        let popularity = 45;
        let imageUrl = '';
        let genres: string[] = [];

        // Try Spotify metadata resolution to obtain actual popularity and image
        const sArtist = await fetchSpotifyArtist(sim.name);
        if (sArtist) {
          artistId = `spotify-${sArtist.id}`;
          popularity = sArtist.popularity;
          imageUrl = sArtist.imageUrl;
          genres = sArtist.genres || [];
        }

        candidates.push({
          artistId,
          spotifyId: sArtist?.id || undefined,
          musicBrainzId: mbid || undefined,
          displayName: sim.name,
          genres,
          subgenres: [],
          popularity,
          followers: 0,
          imageUrl: imageUrl || undefined,
          retrievalDepth: depth,
          retrievedAt: new Date().toISOString(),
          lastRefreshed: new Date().toISOString(),
          relationshipConfidence: sim.match ? parseFloat(sim.match as any) : OreConfig.sourceConfidence.LASTFM_DYNAMIC_FALLBACK,
          discoveryEvidence: [
            {
              source: 'Last.fm Similar',
              confidence: 0.8,
              timestamp: new Date().toISOString(),
              metadata: { seedArtistName: seed.name, seedArtistId: seed.artistId, match: sim.match },
            },
          ],
        });
      }

      return candidates;
    } catch (err) {
      console.warn(`[ORE] Last.fm retrieval failed for "${seed.name}":`, err);
      return [];
    }
  }
}

// ── PROVIDER 4: MusicBrainz Provider (Live HTTP client with Graceful Timeout Fallback) ──
export class MusicBrainzProvider implements RetrievalProvider {
  name = 'MusicBrainz';

  async retrieve(
    seed: { name: string; artistId: string },
    depth: number,
    _metrics?: OREMetrics,
  ): Promise<ORECandidate[]> {
    try {
      // 1. Search MusicBrainz for artist
      // Audit fix H3: respect MusicBrainz ~1 rps policy via the shared bucket.
      // IMPORTANT: acquire BEFORE starting any abort timer. The 1 rps bucket
      // serializes many seeds; a timer started before the limiter wait fires
      // while queued, aborting every request instantly (AbortError flood).
      await musicbrainzLimiter.acquire();
      const searchUrl = `https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(seed.name)}&fmt=json`;
      const searchResult = await fetchWithTimeout(searchUrl, {
        headers: { 'User-Agent': 'MusicOrca/2.0.0 ( jeetdoesthings@example.com )' },
      });
      if (!searchResult) return [];

      const searchData = await searchResult.json();
      const artist = searchData?.artists?.[0];
      if (!artist || !artist.id) return [];

      // 2. Fetch artist relationships (fresh timeout — the search may have
      // consumed most of a shared budget, so don't reuse one timer).
      await musicbrainzLimiter.acquire();
      const detailsUrl = `https://musicbrainz.org/ws/2/artist/${artist.id}?inc=artist-rels+label-rels&fmt=json`;
      const detailsRes = await fetchWithTimeout(detailsUrl, {
        headers: { 'User-Agent': 'MusicOrca/2.0.0 ( jeetdoesthings@example.com )' },
      });
      if (!detailsRes) return [];

      const detailsData = await detailsRes.json();
      const relations = detailsData?.relations || [];

      const candidates: ORECandidate[] = [];
      for (const rel of relations) {
        if (rel.artist && (rel.type === 'collaboration' || rel.type === 'member of group' || rel.type === 'subgroup')) {
          const relArtist = rel.artist;
          candidates.push({
            artistId: relArtist.id,
            musicBrainzId: relArtist.id,
            displayName: relArtist.name,
            genres: [],
            subgenres: [],
            popularity: 35, // default basic popularity for MusicBrainz entries
            followers: 0,
            retrievalDepth: depth,
            retrievedAt: new Date().toISOString(),
            lastRefreshed: new Date().toISOString(),
            relationshipConfidence: OreConfig.sourceConfidence.MUSICBRAINZ_RELATIONSHIP,
            discoveryEvidence: [
              {
                source: 'MusicBrainz Relationship',
                confidence: 0.75,
                timestamp: new Date().toISOString(),
                metadata: { relationType: rel.type, parentArtist: seed.name },
              },
            ],
          });
        }
      }

      return candidates;
    } catch (err) {
      console.warn(`[ORE] MusicBrainz retrieval failed/timeout for "${seed.name}":`, err);
      return [];
    }
  }
}

/**
 * Fetch with a per-call abort timeout. Returns null on timeout/network error so
 * callers degrade gracefully (the old code shared one timer across the whole
 * retrieve(), which aborted before the limiter even let the request through).
 */
async function fetchWithTimeout(
  url: string,
  init?: RequestInit & { headers?: Record<string, string> },
  timeoutMs = 5000,
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return res.ok ? res : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fill empty genre arrays from local Artist table or Spotify search.
 * Leaves genres empty when nothing found — never invents 'pop'.
 */
async function hydrateEmptyCandidateGenres(candidates: ORECandidate[]): Promise<void> {
  const need = candidates.filter((c) => !c.genres || c.genres.length === 0);
  if (need.length === 0) return;

  const ids = need.map((c) => c.artistId).filter(Boolean);
  const names = need.map((c) => c.displayName.toLowerCase().trim());

  let rows: Array<{ id: string; displayName: string; rawGenres: string; imageUrl: string | null; normalizedName: string }> =
    [];
  try {
    rows = await prisma.artist.findMany({
      where: {
        OR: [
          { id: { in: ids } },
          { normalizedName: { in: names } },
        ],
      },
      select: {
        id: true,
        displayName: true,
        rawGenres: true,
        imageUrl: true,
        normalizedName: true,
      },
      take: 200,
    });
  } catch {
    rows = [];
  }

  const byId = new Map(rows.map((r) => [r.id, r]));
  const byName = new Map(rows.map((r) => [r.normalizedName, r]));

  for (const cand of need) {
    const row =
      byId.get(cand.artistId) ||
      byName.get(cand.displayName.toLowerCase().trim());
    if (row?.rawGenres) {
      try {
        const g = JSON.parse(row.rawGenres);
        if (Array.isArray(g) && g.length > 0) {
          cand.genres = g.filter((x: unknown) => typeof x === 'string' && x.length > 0);
        }
      } catch {
        /* ignore */
      }
      if (!cand.imageUrl && row.imageUrl) cand.imageUrl = row.imageUrl;
    }

    if ((!cand.genres || cand.genres.length === 0) && cand.displayName) {
      try {
        const sArtist = await fetchSpotifyArtist(cand.displayName);
        if (sArtist?.genres?.length) {
          cand.genres = sArtist.genres;
          if (sArtist.imageUrl && !cand.imageUrl) cand.imageUrl = sArtist.imageUrl;
          if (sArtist.popularity != null) cand.popularity = sArtist.popularity;
          if (sArtist.id) {
            cand.spotifyId = sArtist.id;
            if (!cand.artistId.startsWith('spotify-') && !/^[0-9A-Za-z]{15,30}$/.test(cand.artistId)) {
              cand.artistId = `spotify-${sArtist.id}`;
            }
          }
        }
      } catch {
        /* leave empty — ungrounded path drops later */
      }
    }
    // Do NOT set genres to ['pop'] when still empty.
  }
}

// ── MAIN ORE ENGINE CLASS ──
export class ORCARetrievalEngine {
  private providers: RetrievalProvider[];

  constructor() {
    this.providers = [
      new LocalKnowledgeGraphProvider(),
      new SpotifyProvider(),
      new LastFmProvider(),
      new MusicBrainzProvider(),
    ];
  }

  /**
   * Evaluates all candidates and merges duplicates, merging sources & evidence.
   * Pass the per-retrieval metrics object so duplicate counts are attributed
   * to the correct retrieval, not a shared module global.
   */
  mergeCandidates(candidates: ORECandidate[], metrics?: OREMetrics): ORECandidate[] {
    const mergedMap = new Map<string, ORECandidate>();
    const nameToIdMap = new Map<string, string>(); // normName -> artistId
    let dupCount = 0;

    for (const cand of candidates) {
      const normName = cand.displayName.toLowerCase().replace(/[^a-z0-9]/g, '');
      
      // Look up by exact artistId or by normalized name
      let primaryId = nameToIdMap.get(normName) || cand.artistId;
      
      const existing = mergedMap.get(primaryId);
      
      if (existing) {
        dupCount++;
        
        // Merge evidence sources
        for (const ev of cand.discoveryEvidence) {
          const hasEvidence = existing.discoveryEvidence.some(
            e => e.source === ev.source && e.metadata?.seedArtistId === ev.metadata?.seedArtistId
          );
          if (!hasEvidence) {
            existing.discoveryEvidence.push(ev);
          }
        }
        
        // Update confidence — P1-7: removed the aggregate
        // (`0.7 + (sources-1)*0.15`) overwrite. The relationshipConfidence field
        // on ORECandidate is now a clean per-source read propagated from one of
        // the 9 source-confidence assignment sites (see OreConfig).
        // The canonical discoveryConfidence aggregation lives in CUB's
        // `calculateDiscoveryConfidence` — this is Family A per-source evidence,
        // not the aggregate that doubles up downstream.
        
        // Merge genres
        const allGenres = Array.from(new Set([
          ...(existing.genres || []),
          ...(cand.genres || [])
        ])).filter(g => g && g.trim() !== '');
        existing.genres = allGenres;
        
        // Prefer Spotify details if available
        if (cand.spotifyId && !existing.spotifyId) {
          existing.spotifyId = cand.spotifyId;
        }
        if (cand.imageUrl && !existing.imageUrl) {
          existing.imageUrl = cand.imageUrl;
        }
        if (cand.musicBrainzId && !existing.musicBrainzId) {
          existing.musicBrainzId = cand.musicBrainzId;
        }
        
        // Swap Last.fm format ID to Spotify format ID if newly available
        if (!cand.artistId.startsWith('lastfm-') && existing.artistId.startsWith('lastfm-')) {
          mergedMap.delete(existing.artistId);
          existing.artistId = cand.artistId;
          mergedMap.set(cand.artistId, existing);
          nameToIdMap.set(normName, cand.artistId);
        }
      } else {
        mergedMap.set(cand.artistId, cand);
        nameToIdMap.set(normName, cand.artistId);
      }
    }

    if (metrics) metrics.duplicatesMerged = (metrics.duplicatesMerged || 0) + dupCount;
    return Array.from(mergedMap.values());
  }

  /**
   * Fallback strategy if all providers return zero candidates (prevent empty states)
   */
  async getColdStartFallbacks(depth: number): Promise<ORECandidate[]> {
    try {
      const populars = await prisma.artist.findMany({
        orderBy: { popularity: 'desc' },
        take: 15,
      });

      return populars.map((p: any) => ({
        artistId: p.id,
        spotifyId: p.spotifyId || undefined,
        displayName: p.displayName,
        genres: JSON.parse(p.rawGenres || '[]'),
        subgenres: [],
        popularity: p.popularity,
        followers: p.followers || 0,
        imageUrl: p.imageUrl || undefined,
        retrievalDepth: depth,
        retrievedAt: new Date().toISOString(),
        lastRefreshed: new Date().toISOString(),
        relationshipConfidence: OreConfig.sourceConfidence.GENRE_REPRESENTATIVES,
        discoveryEvidence: [
          {
            source: 'Genre representatives fallback',
            confidence: 0.6,
            timestamp: new Date().toISOString(),
            metadata: { type: 'COLD_START_FALLBACK' },
          },
        ],
      }));
    } catch {
      return [];
    }
  }

  /**
   * Main candidate retrieval flow with optional depth-2 recursive expansion.
   *
   * Returns the merged candidates plus per-retrieval metrics. The metrics
   * are no longer stored in a module global (which interleaved across
   * concurrent retrievals and returned the wrong user's data to debug
   * endpoints); callers receive them as part of the return value instead.
   */
  async retrieveCandidates(
    seeds: Array<{ name: string; artistId: string }>,
    maxDepth = 2
  ): Promise<{ candidates: ORECandidate[]; metrics: OREMetrics }> {
    const startTime = Date.now();

    // Per-retrieval metrics (not a module global — avoids concurrent
    // retrievals stomping each other's debug data).
    const metrics: OREMetrics = {
      seeds: seeds.map(s => s.name),
      providersQueried: this.providers.map(p => p.name),
      latencies: {},
      candidatesRetrieved: 0,
      duplicatesMerged: 0,
      cacheHits: 0,
      cacheMisses: 0,
      recursiveExpansionTree: [],
      evidenceCounts: {},
      missingProviders: [],
      confidenceDistribution: {},
    };

    const finalCandidates: ORECandidate[] = [];
    const queriedSeeds = new Set<string>();

    // Helper function to query all providers for a single seed
    const fetchForSeed = async (seed: { name: string; artistId: string }, depth: number): Promise<ORECandidate[]> => {
      const seedKey = `${seed.name.toLowerCase()}-${seed.artistId}`;
      if (queriedSeeds.has(seedKey)) return [];
      queriedSeeds.add(seedKey);

      // ── LEVEL 1: Can I retrieve from artist? ──
      const seedCandidates: ORECandidate[] = [];

      // Query Local Graph Provider
      const localProvider = this.providers.find(p => p.name === 'Local Knowledge Graph');
      if (localProvider) {
        const localStart = Date.now();
        const localResults = await localProvider.retrieve(seed, depth, metrics);
        metrics.latencies['Local Knowledge Graph'] = (metrics.latencies['Local Knowledge Graph'] || 0) + (Date.now() - localStart);

        if (localResults.length > 0) {
          return localResults; // Cache hit, return stored neighbors
        }
      }

      // Query External Providers in Parallel
      const externalProviders = this.providers.filter(p => p.name !== 'Local Knowledge Graph');
      const providerQueries = externalProviders.map(async provider => {
        const pStart = Date.now();
        try {
          const results = await provider.retrieve(seed, depth, metrics);
          metrics.latencies[provider.name] = (metrics.latencies[provider.name] || 0) + (Date.now() - pStart);
          return { providerName: provider.name, results };
        } catch {
          metrics.missingProviders.push(provider.name);
          return { providerName: provider.name, results: [] };
        }
      });

      const queryResults = await Promise.all(providerQueries);
      for (const { results } of queryResults) {
        seedCandidates.push(...results);
      }

      const seedDetails = await fetchSpotifyArtist(seed.name);

      if (seedCandidates.length > 0) {
        // Resolve empty genres from local catalog / Spotify for the *candidate*
        // itself. Never invent 'pop' and never copy the seed's genres onto
        // every neighbor (that collapsed the whole frontier to one territory).
        await hydrateEmptyCandidateGenres(seedCandidates);

        const mergedSeedCandidates = this.mergeCandidates(seedCandidates, metrics);
        const neighbors = mergedSeedCandidates.map(c => ({
          id: c.artistId,
          displayName: c.displayName,
          genres: c.genres,
          popularity: c.popularity,
          imageUrl: c.imageUrl,
        }));

        const seedObj: ORECandidate = {
          artistId: seed.artistId,
          spotifyId: seedDetails?.id || undefined,
          displayName: seed.name,
          genres: seedDetails?.genres || [],
          subgenres: [],
          popularity: seedDetails?.popularity || 50,
          followers: 0,
          imageUrl: seedDetails?.imageUrl || undefined,
          retrievalDepth: depth,
          retrievedAt: new Date().toISOString(),
          lastRefreshed: new Date().toISOString(),
          relationshipConfidence: OreConfig.sourceConfidence.SEED,
          discoveryEvidence: [
            { source: 'Seed Artist', confidence: 1.0, timestamp: new Date().toISOString(), metadata: {} },
          ],
        };

        await cacheArtistInKnowledgeGraph(seedObj, neighbors);
        return mergedSeedCandidates;
      }

      // ── LEVEL 2: Retrieve from artist's musical territory ──
      console.log(`[ORE] Level 1 returned 0 results for seed: ${seed.name}. Trying Level 2 (Musical Territory)...`);
      const rawGenres = seedDetails?.genres || [];
      const territoryId = normaliseGenre(rawGenres);

      if (territoryId) {
        const territoryMembers = await prisma.territoryMembership.findMany({
          where: { territoryId },
          take: 15,
          include: { artist: true }
        });

        if (territoryMembers.length > 0) {
          const territoryCandidates = territoryMembers.map((m: any) => ({
            artistId: m.artist.id,
            spotifyId: m.artist.spotifyId || undefined,
            displayName: m.artist.displayName,
            genres: JSON.parse(m.artist.rawGenres || '[]'),
            subgenres: [],
            popularity: m.artist.popularity,
            followers: m.artist.followers || 0,
            imageUrl: m.artist.imageUrl || undefined,
            retrievalDepth: depth,
            retrievedAt: new Date().toISOString(),
            lastRefreshed: new Date().toISOString(),
            relationshipConfidence: OreConfig.sourceConfidence.TERRITORY_FALLBACK,
            discoveryEvidence: [
              {
                source: 'Territory Fallback',
                confidence: 0.8,
                timestamp: new Date().toISOString(),
                metadata: { fallbackTerritory: territoryId, parentSeedName: seed.name }
              }
            ]
          }));
          return this.mergeCandidates(territoryCandidates, metrics);
        }
      }

      // ── LEVEL 3: Retrieve from neighbouring territories ──
      console.log(`[ORE] Level 2 returned 0 results for seed: ${seed.name}. Trying Level 3 (Neighbouring Territories)...`);
      if (territoryId) {
        const neighbours = GENRE_ADJACENCY[territoryId] || [];
        if (neighbours.length > 0) {
          const adjacentMembers = await prisma.territoryMembership.findMany({
            where: { territoryId: { in: neighbours } },
            take: 15,
            include: { artist: true }
          });

          if (adjacentMembers.length > 0) {
            const adjacentCandidates = adjacentMembers.map((m: any) => ({
              artistId: m.artist.id,
              spotifyId: m.artist.spotifyId || undefined,
              displayName: m.artist.displayName,
              genres: JSON.parse(m.artist.rawGenres || '[]'),
              subgenres: [],
              popularity: m.artist.popularity,
              followers: m.artist.followers || 0,
              imageUrl: m.artist.imageUrl || undefined,
              retrievalDepth: depth,
              retrievedAt: new Date().toISOString(),
              lastRefreshed: new Date().toISOString(),
              relationshipConfidence: OreConfig.sourceConfidence.NEIGHBOURING_TERRITORY,
              discoveryEvidence: [
                {
                  source: 'Neighbouring Territory Fallback',
                  confidence: 0.7,
                  timestamp: new Date().toISOString(),
                  metadata: { fallbackNeighbours: neighbours, parentSeedName: seed.name }
                }
              ]
            }));
            return this.mergeCandidates(adjacentCandidates, metrics);
          }
        }
      }

      // ── LEVEL 4: Use curated scene representatives ──
      console.log(`[ORE] Level 3 returned 0 results for seed: ${seed.name}. Trying Level 4 (Curated Scene Representatives)...`);
      const curatedNames = ['Fred again..', 'Disclosure', 'Joy Anonymous', 'Barry Can\'t Swim', 'Burial', 'Aphex Twin', 'Peggy Gou', 'Overmono'];
      const curated = await prisma.artist.findMany({
        where: { displayName: { in: curatedNames } },
        take: 10
      });

      if (curated.length > 0) {
        const sceneCandidates = curated.map((c: any) => ({
          artistId: c.id,
          spotifyId: c.spotifyId || undefined,
          displayName: c.displayName,
          genres: JSON.parse(c.rawGenres || '[]'),
          subgenres: [],
          popularity: c.popularity,
          followers: c.followers || 0,
          imageUrl: c.imageUrl || undefined,
          retrievalDepth: depth,
          retrievedAt: new Date().toISOString(),
          lastRefreshed: new Date().toISOString(),
          relationshipConfidence: OreConfig.sourceConfidence.CURATED_SCENE,
          discoveryEvidence: [
            {
              source: 'Curated Scene Fallback',
              confidence: 0.65,
              timestamp: new Date().toISOString(),
              metadata: { parentSeedName: seed.name }
            }
          ]
        }));
        return this.mergeCandidates(sceneCandidates, metrics);
      }

      // ── LEVEL 5: General cold-start representatives ──
      console.log(`[ORE] Level 4 returned 0 results for seed: ${seed.name}. Trying Level 5 (General Fallbacks)...`);
      return await this.getColdStartFallbacks(depth);
    };

    // ── DEPTH 1: Direct Neighbors ──
    const depth1Settled = await Promise.allSettled(seeds.map(seed => fetchForSeed(seed, 1)));
    const depth1Results = depth1Settled.map(result =>
      result.status === 'fulfilled' ? result.value : []
    );

    const depth1Candidates: ORECandidate[] = [];
    for (let i = 0; i < seeds.length; i++) {
      const seed = seeds[i];
      const candidates = depth1Results[i] || [];
      depth1Candidates.push(...candidates);

      metrics.recursiveExpansionTree.push({
        seed: seed.name,
        children: candidates.map(c => c.displayName),
      });
    }

    finalCandidates.push(...depth1Candidates);

    // ── DEPTH 2: Neighbors of Neighbors (Recursive Expansion) ──
    if (maxDepth >= 2 && depth1Candidates.length > 0) {
      // Pick top 5 most highly relevant, obscure, or interesting candidates from depth 1 to expand
      const depth2Seeds = depth1Candidates
        .sort((a, b) => b.relationshipConfidence - a.relationshipConfidence)
        .slice(0, 5)
        .map(c => ({ name: c.displayName, artistId: c.artistId }));

      const depth2Settled = await Promise.allSettled(depth2Seeds.map(seed => fetchForSeed(seed, 2)));
      const depth2Results = depth2Settled.map(result =>
        result.status === 'fulfilled' ? result.value : []
      );

      const depth2Candidates: ORECandidate[] = [];
      for (let i = 0; i < depth2Seeds.length; i++) {
        const seed = depth2Seeds[i];
        const candidates = depth2Results[i] || [];
        depth2Candidates.push(...candidates);

        metrics.recursiveExpansionTree.push({
          seed: seed.name,
          children: candidates.map(c => c.displayName),
        });
      }

      finalCandidates.push(...depth2Candidates);
    }

    // Merge global candidates
    let mergedResult = this.mergeCandidates(finalCandidates, metrics);

    // Step 5: Cold start fallback if all providers returned zero candidates
    if (mergedResult.length === 0) {
      mergedResult = await this.getColdStartFallbacks(1);
    }

    // Populate evidence counts
    for (const c of mergedResult) {
      for (const ev of c.discoveryEvidence) {
        metrics.evidenceCounts[ev.source] = (metrics.evidenceCounts[ev.source] || 0) + 1;
      }
      
      const confBucket = (Math.floor(c.relationshipConfidence * 10) / 10).toFixed(1);
      metrics.confidenceDistribution[confBucket] = (metrics.confidenceDistribution[confBucket] || 0) + 1;
    }

    metrics.candidatesRetrieved = mergedResult.length;
    metrics.latencies['Total ORE Pipeline'] = Date.now() - startTime;

    return { candidates: mergedResult, metrics };
  }
}
