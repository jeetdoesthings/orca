import { prisma } from '../prisma';
import { normaliseGenre } from '../graph/genre-normaliser';
import { CubConfig } from '../config/cub';
import { IdentityConfig } from '../config/identity';
import { GENRE_ADJACENCY } from '../config/genre-adjacency';
import { ORCARetrievalEngine } from './ore';
import type {
  IdentitySeed,
  Candidate,
  EvidenceSource,
  DiscoverySourceType,
  CandidateUniverse,
  GenreGrowthOpportunity,
  DiscoveryContext,
} from './cub-types';

async function saveDiscoveredArtistToDb(art: {
  id: string;
  spotifyId?: string;
  displayName: string;
  rawGenres: string[];
  popularity: number;
  imageUrl?: string;
  sourceEvidence?: any;
}) {
  try {
    // Duplicate-prevention (audit): merge into an existing row with the same
    // display name instead of creating a provider-keyed duplicate.
    // Collaboration names ("21 Savage & Metro Boomin") resolve to the known
    // solo artist and merge there — never create a collab catalog row.
    const { resolveCollabToExistingRow } = await import('@/lib/artists/enrich-identity');
    const collabTarget = await resolveCollabToExistingRow(art.displayName);
    let effectiveId = art.id;
    if (collabTarget) {
      effectiveId = collabTarget.id;
    } else {
      const existing = await prisma.artist.findFirst({
        where: { displayName: art.displayName },
        select: { id: true },
      });
      if (existing) effectiveId = existing.id;
    }
    const compactName = art.displayName.toLowerCase().trim();
    await prisma.artist.upsert({
      where: { id: effectiveId },
      update: {
        popularity: art.popularity,
        imageUrl: art.imageUrl || null,
        sourceEvidence: art.sourceEvidence ? JSON.stringify(art.sourceEvidence) : null,
        normalizedName: compactName,
      },
      create: {
        id: effectiveId,
        spotifyId: art.spotifyId || null,
        displayName: art.displayName,
        normalizedName: compactName,
        rawGenres: JSON.stringify(art.rawGenres),
        popularity: art.popularity,
        followers: 0,
        imageUrl: art.imageUrl || null,
        sourceEvidence: art.sourceEvidence ? JSON.stringify(art.sourceEvidence) : null,
      }
    });
  } catch (err) {
    console.warn(`[CUB] Failed to save discovered artist "${art.displayName}" to database:`, err);
  }
}

// Scene memberships (Source D)
const SCENE_MEMBERSHIPS: Record<string, string[]> = {
  'boiler-room-ldn': ['conducta', 'sammy virji', 'salute', 'joy anonymous', 'barry cant swim', 'interplanetary criminal'],
  'berghain-resident': ['marcel dettmann', 'ben klock', 'rodhad', 'fiedel'],
  'hyperdub-records': ['burial', 'kode9', 'laurel halo', 'cooly g'],
  'warp-records': ['aphex twin', 'boards of canada', 'squarepusher', 'flying lotus'],
};

// Festival lineups mapping (Source G)
const FESTIVAL_LINEUPS: Record<string, string[]> = {
  glastonbury: ['fred again..', 'disclosure', 'charli xcx', 'coldplay', 'sam fender'],
  sonar: ['peggy gou', 'overmono', 'salute', 'four tet', 'floating points'],
  coachella: ['lana del rey', 'tyler the creator', 'doja cat', 'bleachers', 'justice'],
};

/**
 * Helper to fetch raw top artists and savings records.
 */
export async function extractIdentitySeeds(userId: string): Promise<IdentitySeed[]> {
  const seeds: IdentitySeed[] = [];
  const artistIds = new Set<string>();

  try {
    const [listeningEvents, memories] = await Promise.all([
      prisma.userListeningEvent.findMany({ where: { userId } }),
      prisma.userArtistMemory.findMany({ where: { userId } }),
    ]);

    // Audit fix M5: query only the artists referenced by events/memories
    // instead of loading the whole Artist table and scanning it per seed.
    const referencedIds = Array.from(
      new Set([
        ...listeningEvents.map((e: { artistId: string }) => e.artistId),
        ...memories.map((m: { artistId: string }) => m.artistId),
      ]),
    );
    const dbArtists = await prisma.artist.findMany({
      where: { id: { in: referencedIds } },
      select: { id: true, displayName: true },
    });
    const artistById = new Map<string, any>(dbArtists.map((a: any) => [a.id, a]));

    const artistListenCounts: Record<string, number> = {};
    for (const event of listeningEvents) {
      artistListenCounts[event.artistId] = (artistListenCounts[event.artistId] || 0) + 1;
    }

    const sortedListens = Object.entries(artistListenCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, IdentityConfig.maxTopArtists);

    for (const [artId, count] of sortedListens) {
      if (seeds.length >= IdentityConfig.maxSeedPoolSize) break;
      const dbArt = artistById.get(artId);
      if (dbArt) {
        artistIds.add(artId);
        seeds.push({
          artistId: artId,
          name: dbArt.displayName,
          weight: Math.min(IdentityConfig.seedTopArtistWeight, count * 0.1),
          source: 'TOP_ARTIST',
        });
      }
    }

    const highMemories = memories.sort((a: any, b: any) => b.persistence - a.persistence).slice(0, IdentityConfig.maxTopArtists);
    for (const mem of highMemories) {
      if (seeds.length >= IdentityConfig.maxSeedPoolSize) break;
      if (!artistIds.has(mem.artistId)) {
        const dbArt = artistById.get(mem.artistId);
        if (dbArt) {
          artistIds.add(mem.artistId);
          seeds.push({
            artistId: mem.artistId,
            name: dbArt.displayName,
            weight: mem.persistence || IdentityConfig.seedSavedTrackWeight,
            source: 'SAVED_TRACK',
          });
        }
      }
    }
  } catch (err) {
    console.error('[CUB] Failed to extract seeds from listening tables, falling back', err);
  }

  if (seeds.length === 0) {
    for (const fb of IdentityConfig.fallbackSeeds) {
      seeds.push({
        artistId: fb.id,
        name: fb.displayName,
        weight: IdentityConfig.seedSavedTrackWeight,
        source: 'TOP_ARTIST',
      });
    }
  }

  return seeds;
}

/**
 * Step 1 & 2: Analyze Musical Identity and identify growth opportunities.
 */
export async function identifyGenreGrowthOpportunities(
  userId: string,
  seeds: IdentitySeed[]
): Promise<GenreGrowthOpportunity[]> {
  const opportunities: GenreGrowthOpportunity[] = [];

  // Phase 2 P0-2: CUB reads GRE's persisted 7-state from UserGenreRelationshipState
  // (keyed by raw genre) rather than userTerritoryRelationship (now Layer-6-only).
  // The switch below speaks GRE's vocabulary — this is why Option C.ii was chosen
  // over retiring GRE entirely (CUB depends on these rows existing).
  const [relationships, affinities] = await Promise.all([
    prisma.userGenreRelationshipState.findMany({ where: { userId } }),
    prisma.userTerritoryAffinity.findMany({ where: { userId } }),
  ]);

  const affinityMap = new Map<string, number>(affinities.map((a: any) => [a.territoryId, a.compatibilityScore]));

  const seedGenres = new Set<string>();
  const seedArtists = await prisma.artist.findMany({
    where: { id: { in: seeds.map((seed) => seed.artistId) } },
    select: { rawGenres: true },
  });
  for (const artist of seedArtists) {
    if (artist?.rawGenres) {
      const genres: string[] = JSON.parse(artist.rawGenres);
      genres.forEach((g) => seedGenres.add(normaliseGenre([g])));
    }
  }

  const allGenres = Array.from(new Set([...seedGenres, 'house', 'techno', 'uk-garage', 'grime', 'hip-hop', 'lo-fi-hip-hop', 'ambient', 'downtempo', 'pop', 'rock', 'jazz']));

  for (const genre of allGenres) {
    // Phase 2 P0-2: lookup keyed by `genre` (UserGenreRelationshipState), not `territoryId`.
    const rel = relationships.find((r: any) => r.genre === genre);
    const dbState = rel?.currentState || 'UNTUCHED';

    // Map GRE stages directly (canonical taxonomy)
    let stage: GenreGrowthOpportunity['stage'] = 'Untouched';
    let basePriority = 0.3;

    // dbState is a GRE 7-state value (CORE_IDENTITY / INTEGRATED / etc.)
    // persisted to UserGenreRelationshipState by relationship-persistence.
    switch (dbState) {
      case 'CORE_IDENTITY':
        stage = 'Core Identity';
        basePriority = 0.4;
        break;
      case 'INTEGRATED':
        stage = 'Integrated';
        basePriority = 0.55;
        break;
      case 'GROWING':
        stage = 'Growing';
        basePriority = 0.85;
        break;
      case 'EXPLORING':
        stage = 'Exploring';
        basePriority = 0.75;
        break;
      case 'INTRODUCED':
        stage = 'Introduced';
        basePriority = 0.65;
        break;
      case 'REDISCOVER':
        stage = 'Rediscover';
        basePriority = 0.75;
        break;
      default:
        stage = 'Untouched';
        basePriority = 0.3;
        break;
    }

    const compat = affinityMap.get(genre) || 0.5;
    const priority = Math.round(((basePriority + compat) / 2) * 100) / 100;

    opportunities.push({ genre, stage, priority });
  }

  return opportunities.sort((a, b) => b.priority - a.priority);
}

/**
 * Calculates discovery confidence based on matching target opportunity and source counts.
 */
export function calculateDiscoveryConfidence(
  sources: EvidenceSource[],
  candidateGenres: string[],
  growthOpportunity: string
): number {
  if (sources.length === 0) return 0.0;
  const cfg = CubConfig;
  const maxBase = Math.max(...sources.map((s) => s.confidence));
  
  const normOpportunity = growthOpportunity.toLowerCase().trim();
  const matchesGenre = candidateGenres.some((g) => normaliseGenre([g]) === normOpportunity);
  
  const genreBoost = matchesGenre ? cfg.genreMatchBoost : 0.0;

  const uniqueTypes = new Set(sources.map((s) => s.type));
  const increment = (uniqueTypes.size - 1) * cfg.multiSourceDiversityMultiplier;

  return Math.min(cfg.maxPossibleConfidence, maxBase + genreBoost + increment);
}

/**
 * Assigns a candidate classification based on the growth opportunity stage.
 */
export function classifyCandidate(
  stage: string
): 'IDENTITY' | 'EXPANSION' | 'DISCOVERY' | 'REDISCOVERY' | 'UNKNOWN' {
  if (stage === 'Core Identity' || stage === 'Integrated') {
    return 'IDENTITY';
  }
  if (stage === 'Growing') {
    return 'EXPANSION';
  }
  if (stage === 'Untouched') {
    return 'DISCOVERY';
  }
  if (stage === 'Rediscover') {
    return 'REDISCOVERY';
  }
  return 'UNKNOWN';
}

/**
 * Main Genre-Driven Candidate Universe Builder pipeline.
 */
export async function buildCandidateUniverse(
  userId: string,
  accessToken: string
): Promise<CandidateUniverse> {
  console.log(`[CUB 2.1] Building genre-driven candidate universe for user: ${userId}`);

  // Step 1: Extract Identity Seeds
  const seeds = await extractIdentitySeeds(userId);
  console.log(`[CUB 2.1] Extracted ${seeds.length} identity seeds.`);

  // Step 2: Identify Genre Growth Opportunities
  const opportunities = await identifyGenreGrowthOpportunities(userId, seeds);
  console.log(`[CUB 2.1] Identified ${opportunities.length} growth opportunities.`);

  // Step 3: Query ORE (ORCA Retrieval Engine) for candidates
  const engine = new ORCARetrievalEngine();
  const { candidates: oreCandidates } = await engine.retrieveCandidates(
    seeds.map(s => ({ name: s.name, artistId: s.artistId }))
  );

  const mappedCandidates: Candidate[] = [];

  // Step 4: Map ORE Candidates to CUB Structure
  for (const oreCand of oreCandidates) {
    const primaryNormGenre = normaliseGenre(oreCand.genres);
    const opp = opportunities.find(o => o.genre === primaryNormGenre) || opportunities[0];

    const sources: EvidenceSource[] = oreCand.discoveryEvidence.map(ev => {
      let type: DiscoverySourceType = 'LASTFM_SIMILAR';
      if (ev.source.includes('Spotify')) {
        type = 'SPOTIFY_METADATA';
      } else if (ev.source.includes('MusicBrainz')) {
        type = 'COLLABORATION_NETWORK';
      } else if (ev.source.includes('Local Graph')) {
        type = 'GENRE_EXPANSION';
      } else if (ev.source.includes('fallback')) {
        type = 'USER_HISTORY';
      }

      return {
        type,
        source: ev.source,
        strength: ev.confidence,
        confidence: ev.confidence,
        metadata: ev.metadata,
      };
    });

    mappedCandidates.push({
      artistId: oreCand.artistId,
      name: oreCand.displayName,
      genres: oreCand.genres,
      popularity: oreCand.popularity,
      imageUrl: oreCand.imageUrl || '',
      discoveryContext: {
        growthOpportunity: primaryNormGenre || 'pop',
        relationshipStage: opp?.stage || 'Growing',
        supportingArtists: seeds.map(s => s.name),
        sources,
      },
      // P1-7: discoveryConfidence is now seeded from the strongest per-source
      // confidence (= initial evidence before CUB's canonical aggregation).
      // Previously this read `oreCand.relationshipConfidence` (the per-source
      // assignment), but mixing ORE's per-source evidence with CUB's canonical
      // aggregation duplicated confidence accounting at `:400` below. The final,
      // canonical value is produced by `calculateDiscoveryConfidence` — this
      // initial value is the strongest single-source proof.
      discoveryConfidence: Math.max(...sources.map((s: EvidenceSource) => s.confidence)),
      candidateClassification: classifyCandidate(opp?.stage || 'Growing'),
      audioSource: 'cold_start_default',
      confidenceTag: 'cold_start_default',
      retrievalPath: 'adjacency',
    });
  }

  // Inject User Seeds as candidates to ensure identity coverage
  // Audit fix M5: query only the seed artists instead of the whole table.
  const seedIds = seeds.map((s) => s.artistId);
  const dbArtists = await prisma.artist.findMany({
    where: { id: { in: seedIds } },
    select: { id: true, displayName: true, popularity: true, rawGenres: true, imageUrl: true },
  });
  const artistById = new Map<string, any>(dbArtists.map((a: any) => [a.id, a]));

  for (const seed of seeds) {
    const artist = artistById.get(seed.artistId);
    if (!artist) continue;
    
    const genres: string[] = JSON.parse(artist.rawGenres || '[]');

    const evidenceHistory: EvidenceSource = {
      type: 'USER_HISTORY',
      source: 'Listening History Seeds',
      strength: seed.weight,
      confidence: CubConfig.maxPossibleConfidence,
      metadata: { seedSource: seed.source },
    };

    mappedCandidates.push({
      artistId: seed.artistId,
      name: seed.name,
      genres,
      popularity: artist.popularity,
      imageUrl: artist.imageUrl || '',
      discoveryContext: {
        growthOpportunity: 'pop',
        relationshipStage: 'Core Identity',
        supportingArtists: [seed.name],
        sources: [evidenceHistory],
      },
      discoveryConfidence: CubConfig.maxPossibleConfidence,
      candidateClassification: 'IDENTITY',
      audioSource: 'cold_start_default',
      confidenceTag: 'cold_start_default',
      retrievalPath: 'adjacency',
    });
  }

  // Leap-seek is a separate pipeline stage (after GRE) — see frontier/stages/score-and-surface.ts

  // De-duplicate final mapped candidates list
  const mergedMap = new Map<string, Candidate>();
  for (const cand of mappedCandidates) {
    const existing = mergedMap.get(cand.artistId);
    if (existing) {
      for (const src of cand.discoveryContext.sources) {
        const hasSource = existing.discoveryContext.sources.some(
          s => s.type === src.type && s.metadata?.seedArtistId === src.metadata?.seedArtistId
        );
        if (!hasSource) {
          existing.discoveryContext.sources.push(src);
        }
      }
      existing.discoveryConfidence = calculateDiscoveryConfidence(
        existing.discoveryContext.sources,
        existing.genres,
        existing.discoveryContext.growthOpportunity
      );
    } else {
      if (!cand.retrievalPath) cand.retrievalPath = 'adjacency';
      mergedMap.set(cand.artistId, cand);
    }
  }

  const finalCandidates = Array.from(mergedMap.values());

  // Count source distribution metrics
  const sourceBreakdown: Record<DiscoverySourceType, number> = {
    LASTFM_SIMILAR: 0,
    SPOTIFY_METADATA: 0,
    GENRE_EXPANSION: 0,
    SCENE_EXPANSION: 0,
    COLLABORATION_NETWORK: 0,
    LABEL_NETWORK: 0,
    FESTIVAL_LIVE: 0,
    PLAYLIST_COOCCURRENCE: 0,
    AUDIO_SIMILARITY: 0,
    HIDDEN_POTENTIAL: 0,
    USER_HISTORY: 0,
    LEAP_SEEK: 0,
    SHORE_SEEK: 0,
  };

  for (const c of finalCandidates) {
    for (const s of c.discoveryContext.sources) {
      sourceBreakdown[s.type]++;
    }
  }

  return {
    userId,
    candidates: finalCandidates,
    generatedAt: new Date().toISOString(),
    identitySeeds: seeds,
    genreGrowthOpportunities: opportunities,
    debugStats: {
      totalSeeds: seeds.length,
      duplicateMerges: oreResult.metrics.duplicatesMerged,
      sourceBreakdown,
      candidatesPerOpportunity: {},
    },
  };
}
