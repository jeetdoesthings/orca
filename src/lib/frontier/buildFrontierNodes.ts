import { prisma } from '@/lib/prisma';
import type { OrcaNode, AudioSignature } from '@/lib/graph/types';
import {
  normaliseGenre,
  normaliseGenreOrUnknown,
  resolveArtistGenres,
  xyzToLatLng,
} from '@/lib/graph/genre-normaliser';
import { computeNodeCoords } from '@/lib/spotifySync';
import { getStandardisedComparisonKey } from '../identity';
import { buildCandidateUniverse } from '../candidate/cub';
import { resolveUserPk, writeRecommendationServeLogs } from '../ocse/serve-log';
import type { DecisionProfile } from '../ocse/ocse-types';
import {
  computeExpansionDistanceFromInputs,
  expansionBandFromDistance,
  expansionValue,
  type ExpansionBand,
} from '../expansion/intelligence';
import {
  synthesizeAudioSignature,
  audioSignatureFromArtistMetadata,
  normalizeConfidenceTag,
  type AudioSource,
  type ConfidenceTag,
} from '../audio/resolve-signature';
import { WorldConfig } from '../config/world';
import { ExpansionConfig } from '../config/expansion';
import { readWorldState } from './world-state-store';
import {
  hydrateCandidatesFromCatalog,
  fillCandidatesFromCatalog,
  computeUserCentroid,
  computeUserGenreProfile,
} from './stages/enrich-candidates';
import { diversifyExpansionDistancesIfCollapsed } from './stages/diversify-distances';
import type { BuildFrontierOptions, FrontierBuildResult } from './types';
import { buildTasteIdentity } from '@/lib/identity/orca-identity';
import { retrieveCandidatePool } from '@/lib/retrieval/candidate-retriever';
import { generateLLMRecommendations, isGeminiQuotaExhausted } from '@/lib/recommendation/llm-engine';
import { groundLLMRecommendations } from '@/lib/recommendation/grounding';
import { classifyAndValidateSurface } from '@/lib/recommendation/classify-surface';
import { computeGenreRelationships } from '@/lib/gre/gre';
import { loadReadinessHistory } from '@/lib/readiness/readiness-model';
import { loadInteractionHistory } from '@/lib/ocse/interaction-history';
import { retrieveShoreSeekCandidates } from '@/lib/candidate/shore-seek';
import { retrieveLeapSeekCandidates } from '@/lib/candidate/leap-seek';

export type { FrontierBuildResult, BuildFrontierOptions } from './types';

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

/**
 * Calculates geographic distance between two lat/lng coordinates (in degrees)
 */
export function globeDistance(
  a: { lat: number; lng: number } | OrcaNode,
  b: { lat: number; lng: number } | OrcaNode
): number {
  const getLatLng = (obj: { lat?: number; lng?: number; x?: number; y?: number; z?: number }) => {
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
 * Sole stage runner: CUB → identity → retrieval → LLM → grounding → classification → layout.
 * Product code must call this only via `materializeWorld` (Ticket 4).
 *
 * Returns typed FrontierBuildResult (nodes + surface + leapSeekMeta) — no process globals.
 * `skipOcse` is scripts/baseline only — never pass from product routes.
 */
export async function buildFrontierNodes(
  exploredArtists: OrcaNode[],
  accessToken: string,
  userId: string,
  options?: BuildFrontierOptions,
): Promise<FrontierBuildResult> {
  if (exploredArtists.length === 0) {
    return {
      nodes: [],
      surface: null,
      readiness: null,
      leapSeekMeta: { targetedTerritories: [] },
    };
  }

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
  const exploredNames = new Set(exploredArtists.map(a => a.name.toLowerCase().replace(/[^a-z0-9]/g, '')));
  const exploredArtistMap = new Map(exploredArtists.map(e => [e.id, e]));
  // Remap lastfm-* / alias seed ids → actual explored node ids (Spotify login)
  const exploredIdByCompactName = new Map(
    exploredArtists.map((e) => [
      e.name.toLowerCase().replace(/[^a-z0-9]/g, ''),
      e.id,
    ]),
  );
  const remapSeedId = (seedId: string | undefined | null): string | null => {
    if (!seedId) return null;
    if (exploredIds.has(seedId)) return seedId;
    const bare = seedId.startsWith('spotify-') ? seedId.slice(8) : seedId;
    if (exploredIds.has(bare)) return bare;
    if (seedId.startsWith('lastfm-')) {
      const key = seedId.slice('lastfm-'.length).replace(/[^a-z0-9]/g, '');
      const hit = exploredIdByCompactName.get(key);
      if (hit) return hit;
    }
    // Fall back: leave as-is only if it will match something later; else drop
    return exploredIds.has(seedId) ? seedId : null;
  };
  const candidateMap = new Map<string, { artist: SpotifyArtist; adjacentTo: string[]; discoveryConfidence: number; classification: string }>();
  const nameToId = new Map<string, string>(); // normName -> artistId

  // Run CUB (Explorer) to generate Candidate Universe
  const universe = await buildCandidateUniverse(userId, accessToken);
  for (const cand of universe.candidates) {
    const normName = cand.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    
    // 1. Skip if already explored (by ID or standardized name)
    if (exploredIds.has(cand.artistId) || exploredNames.has(normName)) {
      continue;
    }

    // 2. Deduplicate candidates internally by standardized name
    const existingId = nameToId.get(normName);
    if (existingId) {
      const existing = candidateMap.get(existingId);
      if (existing) {
        const adjacentTo = cand.discoveryContext.sources
          .filter(s => s.metadata && s.metadata.seedArtistId)
          .map(s => remapSeedId(s.metadata.seedArtistId))
          .filter((id): id is string => !!id);
        existing.adjacentTo = Array.from(new Set([...existing.adjacentTo, ...adjacentTo]));
      }
      continue;
    }

    const adjacentTo = cand.discoveryContext.sources
      .filter(s => s.metadata && s.metadata.seedArtistId)
      .map(s => remapSeedId(s.metadata.seedArtistId))
      .filter((id): id is string => !!id);

    candidateMap.set(cand.artistId, {
      artist: {
        id: cand.artistId,
        name: cand.name,
        genres: cand.genres,
        popularity: cand.popularity,
        // Prefer [0] as primary URL (largest Spotify size when multi-image).
        images: cand.imageUrl ? [{ url: cand.imageUrl }] : [],
      },
      adjacentTo,
      discoveryConfidence: cand.discoveryConfidence,
      classification: cand.candidateClassification || 'UNKNOWN'
    });
    nameToId.set(normName, cand.artistId);
  }

  // Floor: if CUB/ORE returned a thin universe (demo / empty token), fill from
  // local Artist catalog by seed genre + adjacency so the globe is not empty.
  // Part 10: cold-start users get a wider min frontier.
  let coldStartUser = exploredArtists.length < (ExpansionConfig.coldStart?.minIdentityArtists ?? 5);
  try {
    const { assessColdStart } = await import('@/lib/identity/cold-start');
    const assessment = assessColdStart({
      exploredArtistCount: exploredArtists.length,
    });
    coldStartUser = assessment.coldStart;
  } catch {
    // keep heuristic
  }
  const minFrontier = coldStartUser
    ? (ExpansionConfig.coldStart?.minFrontierCandidates ?? 120)
    : (ExpansionConfig.minFrontierCandidates ?? 80);

  // Hydrate genres/images from local Artist table so ORE empty→pop never sticks.
  await hydrateCandidatesFromCatalog(candidateMap, universe);

  const distinctPrimaries = () => {
    const s = new Set<string>();
    for (const entry of candidateMap.values()) {
      const p = normaliseGenreOrUnknown(entry.artist.genres || []);
      if (p) s.add(p);
    }
    return s.size;
  };

  const needCatalogFill =
    candidateMap.size < minFrontier || distinctPrimaries() < 4;
  if (needCatalogFill) {
    await fillCandidatesFromCatalog({
      candidateMap,
      nameToId,
      exploredIds,
      exploredNames,
      exploredArtists,
      targetCount: Math.max(minFrontier, candidateMap.size + 40),
    });
    // Ensure universe.candidates includes catalog fills for EI/OCSE threading.
    for (const [id, entry] of candidateMap) {
      if (!universe.candidates.some((c) => c.artistId === id)) {
        universe.candidates.push({
          artistId: id,
          name: entry.artist.name,
          genres: entry.artist.genres || [],
          popularity: entry.artist.popularity || 50,
          imageUrl: entry.artist.images?.[0]?.url || '',
          discoveryContext: {
            growthOpportunity: normaliseGenre(entry.artist.genres || []),
            relationshipStage: 'EXPLORING',
            supportingArtists: entry.adjacentTo,
            sources: [
              {
                type: 'GENRE_EXPANSION',
                source: 'Local Artist Catalog',
                strength: 0.55,
                confidence: 0.55,
                metadata: { seedArtistId: entry.adjacentTo[0] },
              },
            ],
          },
          discoveryConfidence: 0.55,
          candidateClassification: 'EXPANSION',
          audioSource: 'cold_start_default',
          confidenceTag: 'cold_start_default',
        });
      }
    }
  }

  // ── Stage 1.5: Identity → GRE → Readiness → seek (shore/leap) → retrieval →
  // LLM reasoning (or deterministic fallback) → grounding → surface classifier ──
  // GRE/EI/OCSE are no longer the live recommendation engines. CUB still
  // contributes seed evidence, but the canonical frontier path now uses a
  // taste-identity snapshot, GRE relationship state, the Readiness Model,
  // Shore-seek / Leap-seek modules, factual retrieval, schema-validated LLM
  // musical reasoning (with a deterministic fallback when LLM is unavailable),
  // deterministic grounding, and a lightweight distance classifier that
  // preserves the existing RecommendationSurface shape.
  let profileMap = new Map<string, DecisionProfile>();

  // Deterministic classifier inputs (computed once for the whole universe).
  const userCentroid = computeUserCentroid(exploredArtists);
  const userGenreProfile = computeUserGenreProfile(exploredArtists);
  const exploredGenres = new Set(exploredArtists.flatMap(a => a.genres));
  // Part 2: prior incidental play estimates from Identity weights (pre-ORCA exposure only)
  const { estimatedPlaysFromWeight } = await import('@/lib/metrics/familiarity');
  const priorPlaysByArtistId = new Map<string, number>();
  for (const n of exploredArtists) {
    priorPlaysByArtistId.set(n.id, estimatedPlaysFromWeight(n.weight ?? 0));
  }

  const realAudioById = new Map<string, AudioSignature>();
  try {
    const candidateIds = universe.candidates.map((c) => c.artistId);
    if (candidateIds.length > 0) {
      const artistRows = await prisma.artist.findMany({
        where: { id: { in: candidateIds } },
        select: { id: true, metadata: true },
      });
      for (const row of artistRows) {
        const real = audioSignatureFromArtistMetadata(row.metadata);
        if (real) realAudioById.set(row.id, real);
      }
    }
  } catch (err) {
    console.warn(
      '[CUB Frontier Layout] Failed to load audio signatures; tag_inferred path:',
      err,
    );
  }

  const priorWorld = await readWorldState(userId);
  const identity = await buildTasteIdentity(userId, exploredArtists);
  const userPk = await resolveUserPk(userId);

  // Readiness Model inputs: GRE per-genre state + canonical interaction history.
  const [relationships, interactionHistory] = await Promise.all([
    computeGenreRelationships(userId),
    userPk
      ? loadInteractionHistory(userPk)
      : Promise.resolve({
          timesShown: {},
          timesIgnored: {},
          timesDismissed: {},
          timesIntegrated: {},
          lastShown: {},
          territoryRejections: [],
        }),
  ]);
  const historyEvents = userPk
    ? await loadReadinessHistory(userId, interactionHistory)
    : [];

  // Seed the pool with shore (deep cuts in home scenes) and leap (far-territory anchors)
  // candidates so the new modules are no longer orphaned.
  const seekExcludeIds = new Set<string>([
    ...exploredArtists.map((a) => a.id),
    ...priorWorld.visibleNodeIds,
    ...priorWorld.lastNodes.map((n) => n.id),
    ...identity.ignoredArtists.map((a) => a.id),
    ...identity.rejectedArtists.map((a) => a.id),
    ...identity.integratedArtists.map((a) => a.id),
  ]);
  const seekExcludeNames = new Set<string>([
    ...exploredArtists.map((a) => getStandardisedComparisonKey(a.name)),
    ...identity.ignoredArtists.map((a) => getStandardisedComparisonKey(a.name)),
    ...identity.rejectedArtists.map((a) => getStandardisedComparisonKey(a.name)),
    ...identity.integratedArtists.map((a) => getStandardisedComparisonKey(a.name)),
  ]);
  const [shoreResult, leapResult] = await Promise.all([
    retrieveShoreSeekCandidates(exploredArtists, {
      excludeIds: seekExcludeIds,
      excludeNames: seekExcludeNames,
    }),
    retrieveLeapSeekCandidates(userId, relationships),
  ]);
  const seedCandidateIds = new Set(universe.candidates.map((c) => c.artistId));
  const seekCandidates = [...shoreResult.candidates, ...leapResult.candidates].filter(
    (c) => !seedCandidateIds.has(c.artistId),
  );
  if (seekCandidates.length > 0) {
    universe.candidates = [...universe.candidates, ...seekCandidates];
  }
  console.log(
    `[CUB Frontier Layout] Seek: ${shoreResult.candidates.length} shore, ${leapResult.candidates.length} leap (${seekCandidates.length} new)`,
  );

  const retrieval = await retrieveCandidatePool(identity, accessToken, universe.candidates);
  universe.candidates = retrieval.candidates;
  console.log(`[CUB Frontier Layout] Retrieval: ${retrieval.candidates.length} candidates, ${retrieval.artists.length} artists (from ${universe.candidates.length} seeds)`);

  const llmStartedAt = Date.now();
  const knownIds = new Set([
    ...exploredArtists.map((a) => a.id),
    ...priorWorld.visibleNodeIds,
    ...priorWorld.lastNodes.map((n) => n.id),
  ]);
  const ignoredIds = new Set(identity.ignoredArtists.map((a) => a.id));
  const rejectedIds = new Set(identity.rejectedArtists.map((a) => a.id));
  const integratedIds = new Set(identity.integratedArtists.map((a) => a.id));
  const currentFrontierIds = new Set(identity.currentFrontier.map((a) => a.id));
  const shouldSkipLLM = options?.skipOcse || !process.env.GEMINI_API_KEY || isGeminiQuotaExhausted();
  const llm = shouldSkipLLM
    ? {
        recommendations: retrieval.candidates.slice(0, 300).map((c, i) => ({
          artistId: c.artistId,
          artist: c.name,
          rank: i + 1,
          distanceIntent: (i % 5 === 0 ? 'Deep' : i % 2 === 0 ? 'Shallow' : 'Shore') as
            | 'Shore'
            | 'Shallow'
            | 'Deep',
          gatewayPath: c.discoveryContext.supportingArtists.slice(0, 3),
          territoryFraming: c.sourceTerritory || c.genres[0] || 'adjacent territory',
          explanation: 'Deterministic baseline recommendation.',
          albumSuggestions: [],
          evidenceIds: c.discoveryContext.sources.map((s) => String(s.metadata?.id || s.source)),
        })),
        model: options?.skipOcse ? 'deterministic-skip' : 'deterministic-fallback',
        promptVersion: 'orca-llm-recommendation-v1',
        validationErrors: [],
      }
    : await generateLLMRecommendations({
        identity,
        knownArtistIds: Array.from(knownIds),
        ignoredArtistIds: Array.from(ignoredIds),
        rejectedArtistIds: Array.from(rejectedIds),
        integratedArtistIds: Array.from(integratedIds),
        currentFrontierIds: Array.from(currentFrontierIds),
        goals: [
          'Build a coherent musical journey from current taste.',
          'Prefer grounded gateway artists over isolated clones.',
        ],
        candidatePool: retrieval.artists,
        count: 300,
      });

  const verified = await groundLLMRecommendations({
    recommendations: llm.recommendations,
    candidatePool: retrieval.artists,
    candidates: retrieval.candidates,
    knownIds,
    ignoredIds,
    rejectedIds,
    integratedIds,
    knownNames: new Set(exploredArtists.map((a) => getStandardisedComparisonKey(a.name))),
  });
  console.log(`[CUB Frontier Layout] LLM: ${llm.recommendations.length} recs (${llm.model}), Verified: ${verified.filter(v => v.accepted).length} accepted, ${verified.filter(v => !v.accepted).length} rejected`);

  const scored = classifyAndValidateSurface({
    userId,
    identity,
    verified,
    candidates: retrieval.candidates,
    exploredArtists,
    userCentroid,
    userGenreProfile,
    realAudioById,
    explicitTier: options?.explicitTier ?? null,
    relationships,
    historyEvents,
  });

  try {
    const userPkServe = userPk;
    if (userPkServe) {
      const accepted = verified.filter((v) => v.accepted);
      const rejected = verified.filter((v) => !v.accepted);
      await prisma.recommendationRun.create({
        data: {
          userId: userPkServe,
          promptVersion: llm.promptVersion,
          model: llm.model,
          candidateCount: retrieval.candidates.length,
          acceptedCount: accepted.length,
          rejectedCount: rejected.length,
          validationFailures:
            llm.validationErrors.length || rejected.length
              ? JSON.stringify({
                  schema: llm.validationErrors,
                  grounding: rejected.map((v) => ({
                    artist: v.recommendation.artist,
                    reasons: v.rejectionReasons,
                  })),
                })
              : null,
          latencyMs: Date.now() - llmStartedAt,
        },
      });
      if (accepted.length > 0) {
        await Promise.all(
          accepted.slice(0, 200).map((v) =>
            prisma.recommendationMemory.upsert({
              where: { userId_artistId: { userId: userPkServe, artistId: v.candidate.artistId } },
              create: {
                userId: userPkServe,
                artistId: v.candidate.artistId,
                status: 'shown',
                shownAt: new Date(),
                sourceSnapshot: JSON.stringify({
                  promptVersion: llm.promptVersion,
                  model: llm.model,
                  rank: v.recommendation.rank,
                  confidence: v.confidence,
                }),
              },
              update: {
                status: 'shown',
                shownAt: new Date(),
                sourceSnapshot: JSON.stringify({
                  promptVersion: llm.promptVersion,
                  model: llm.model,
                  rank: v.recommendation.rank,
                  confidence: v.confidence,
                }),
              },
            }),
          ),
        );
      }
    }
  } catch (err) {
    console.warn('[CUB Frontier Layout] Recommendation run/memory write failed:', err);
  }

  universe.candidates = scored.candidates;
  const candidateAudioById = scored.candidateAudioById;
  profileMap = scored.profileMap;
  const readinessState = scored.readiness;
  const recommendationSurface = scored.surface;
  const leapSeekMeta = scored.leapSeekMeta;
  let serveLogFailure = false;

  // Layout needs candidateMap entries only for verified accepted artists.
  candidateMap.clear();
  for (const c of universe.candidates) {
    if (candidateMap.has(c.artistId)) continue;
    candidateMap.set(c.artistId, {
      artist: {
        id: c.artistId,
        name: c.name,
        genres: c.genres,
        popularity: c.popularity,
        images: c.imageUrl ? [{ url: c.imageUrl }] : [],
      },
      adjacentTo: c.discoveryContext.supportingArtists
        .map((id) => remapSeedId(id) || id)
        .filter((id) => exploredIds.has(id)),
      discoveryConfidence: c.discoveryConfidence,
      classification: c.candidateClassification || 'DISCOVERY',
    });
  }

  if (recommendationSurface) {
    try {
      const n = await writeRecommendationServeLogs({
        userId,
        surface: recommendationSurface,
        candidates: universe.candidates,
      });
      console.log(`[CUB Frontier Layout] Wrote ${n} RecommendationServeLog rows`);
    } catch (logErr) {
      serveLogFailure = true;
      console.warn('[CUB Frontier Layout] Serve log write failed:', logErr);
    }
  }

  // Part 11: drop candidates whose genres are under active territory-wide reject cooldown
  let territorySuppressions: Awaited<
    ReturnType<typeof import('@/lib/feedback/territory-reject').getActiveTerritorySuppressions>
  > = [];
  try {
    const { getActiveTerritorySuppressions, isTerritorySuppressed } = await import(
      '@/lib/feedback/territory-reject'
    );
    territorySuppressions = await getActiveTerritorySuppressions(userId);
    if (territorySuppressions.length > 0) {
      for (const [id, entry] of [...candidateMap.entries()]) {
        if (isTerritorySuppressed(territorySuppressions, entry.artist.genres || [])) {
          candidateMap.delete(id);
        }
      }
      universe.candidates = universe.candidates.filter(
        (c) => !isTerritorySuppressed(territorySuppressions, c.genres || []),
      );
      console.log(
        `[CUB Frontier Layout] Territory suppressions active: ${territorySuppressions.map((s) => s.territoryKey).join(', ')}`,
      );
    }
  } catch (err) {
    console.warn('[CUB Frontier Layout] Territory suppress load failed:', err);
  }

  // ── Stage 2: ORCA Candidate selection coordinate mapping ──
  console.log(`[CUB Frontier Layout] Generating candidate nodes for all ${candidateMap.size} candidates...`);
  const finalNodes: OrcaNode[] = [];
  let nodeCount = 0;
  for (const [, { artist, adjacentTo }] of candidateMap) {
    // Yield the event loop every 25 nodes so /api/auth/session and other
    // routes get a tick during long materializations (~120+ candidates).
    if (nodeCount > 0 && nodeCount % 25 === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    nodeCount++;
    const normalisedGenre = normaliseGenre(artist.genres);
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

    // Phase 2 P0-1: signature + expansion distance were computed in the
    // Expansion Intelligence pre-pass (Stage 1.5 Step 3) so OCSE could see the
    // real distance. Reuse them here instead of recomputing — single source of
    // truth per candidate. If the pre-pass skipped this artist (e.g. an error),
    // fall back to synthesizing inline so the layout still completes.
    const audioEntry = candidateAudioById.get(artist.id);
    const fallbackAudio = synthesizeAudioSignature(artist.id, normalisedGenre);
    const signature: AudioSignature = audioEntry?.signature ?? fallbackAudio.signature;
    const audioSource: AudioSource = audioEntry?.source ?? fallbackAudio.source;
    const confidenceTag: ConfidenceTag = normalizeConfidenceTag(audioSource);

    // Look up the pre-computed expansion data on the matching Candidate. The
    // candidateMap key is artistId; universe.candidates carries the threaded fields.
    const candidateForNode = universe.candidates.find(c => c.artistId === artist.id);
    const expansionDistance = candidateForNode?.expansionDistance
      ?? Math.round(
        computeExpansionDistanceFromInputs({
          userCentroid,
          userGenreProfile,
          relationships: [],
          candidateGenres: artist.genres && artist.genres.length > 0 ? artist.genres : [normalisedGenre],
          candidateSignature: signature,
          candidatePopularity: artist.popularity,
          audioSource,
          priorObservedPlays: priorPlaysByArtistId.get(artist.id) ?? 0,
        }) * 100,
      ) / 100;
    const expansionBand: ExpansionBand = candidateForNode?.expansionBand ?? expansionBandFromDistance(expansionDistance);

    // Prefer CUB/ORE imageUrl threaded on Candidate; then images[0].
    const imageUrl =
      candidateForNode?.imageUrl ||
      artist.images?.[0]?.url ||
      artist.images?.[1]?.url ||
      '';

    // ── Apply OCSE decision to the node (visibility, role, evidence) ──
    // Soft admit for Unexplored surface (display threshold); strict recommend
    // still uses visibilityThreshold for HIGH confidenceBand.
    const profile = profileMap.get(artist.id);
    const conf = profile?.decisionConfidence;
    const displayFloor = WorldConfig.visibilityThresholdDisplay ?? 0.18;
    const reachable = profile
      ? conf != null && conf >= displayFloor
      : true;

    const confidenceBand = profile
      ? (profile.decisionConfidence > WorldConfig.confidenceBands.high
        ? 'HIGH'
        : profile.decisionConfidence > WorldConfig.confidenceBands.medium
          ? 'MEDIUM'
          : 'LOW')
      : 'LOW';

    const semanticRole = profile && profile.decisionReasons[0]
      ? (profile.decisionReasons[0] as OrcaNode['semanticRole'])
      : undefined;

    // Expansion Value: how much new territory does this artist unlock?
    const neighborGenres = finalNodes
      .flatMap(n => n.genres || []);
    // Clean + rank tags (drop Last.fm junk, pick specific primary — not first-tag-wins)
    const genresForNode = resolveArtistGenres(
      Array.isArray(artist.genres) ? artist.genres : [],
      artist.name,
    );
    const hasRealGenres = genresForNode.length > 0;
    const expValue = expansionValue({
      candidateGenres: hasRealGenres ? genresForNode : [normalisedGenre],
      exploredGenres,
      frontierNeighborGenres: neighborGenres,
    });

    // Cap seed links: 3–7 edges to artists that explain why this node is here.
    // Too few → unexplored feels unrooted; too many → clustered web.
    const MIN_ADJ = 3;
    const MAX_ADJ = 7;
    let adjacentToCapped = adjacentTo
      .map((id) => remapSeedId(id) || id)
      .filter((id) => exploredIds.has(id));

    // Rank existing seeds by sphere proximity
    const rankByDist = (ids: string[]) =>
      ids
        .map((adjId) => {
          const exp = exploredArtistMap.get(adjId);
          if (!exp || exp.x == null) return { adjId, dist: Number.POSITIVE_INFINITY };
          const dx = (exp.x ?? 0) - x;
          const dy = (exp.y ?? 0) - y;
          const dz = (exp.z ?? 0) - z;
          return { adjId, dist: Math.sqrt(dx * dx + dy * dy + dz * dz) };
        })
        .sort((a, b) => a.dist - b.dist)
        .map((d) => d.adjId);

    adjacentToCapped = rankByDist(Array.from(new Set(adjacentToCapped))).slice(0, MAX_ADJ);

    // Fill to at least MIN_ADJ from same-genre / nearest explored (why this candidate is here)
    if (adjacentToCapped.length < MIN_ADJ) {
      const primary =
        (hasRealGenres ? genresForNode[0] : normalisedGenre) ||
        normaliseGenre(artist.genres || []);
      const fill: Array<{ id: string; dist: number; sameGenre: boolean }> = [];
      for (const exp of exploredArtistMap.values()) {
        if (adjacentToCapped.includes(exp.id)) continue;
        if (exp.x == null) continue;
        const dx = (exp.x ?? 0) - x;
        const dy = (exp.y ?? 0) - y;
        const dz = (exp.z ?? 0) - z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        let sameGenre = false;
        try {
          sameGenre = normaliseGenre(exp.genres || []) === normaliseGenre([primary]);
        } catch {
          sameGenre = false;
        }
        fill.push({ id: exp.id, dist, sameGenre });
      }
      fill.sort((a, b) => {
        if (a.sameGenre !== b.sameGenre) return a.sameGenre ? -1 : 1;
        return a.dist - b.dist;
      });
      for (const f of fill) {
        if (adjacentToCapped.length >= MIN_ADJ) break;
        adjacentToCapped.push(f.id);
      }
      // Still short? take nearest remaining up to MIN_ADJ
      if (adjacentToCapped.length < MIN_ADJ) {
        for (const f of fill) {
          if (adjacentToCapped.length >= MIN_ADJ) break;
          if (!adjacentToCapped.includes(f.id)) adjacentToCapped.push(f.id);
        }
      }
    }

    // Always ensure at least one link to explored when any explored exist
    // (leap_seek / empty seed paths)
    if (adjacentToCapped.length === 0 && exploredArtistMap.size > 0) {
      const nearest = Array.from(exploredArtistMap.values())
        .filter((exp) => exp.x != null)
        .map((exp) => {
          const dx = (exp.x ?? 0) - x;
          const dy = (exp.y ?? 0) - y;
          const dz = (exp.z ?? 0) - z;
          return { id: exp.id, dist: Math.sqrt(dx * dx + dy * dy + dz * dz) };
        })
        .sort((a, b) => a.dist - b.dist)
        .slice(0, MIN_ADJ);
      adjacentToCapped = nearest.map((n) => n.id);
    }

    adjacentToCapped = adjacentToCapped.slice(0, MAX_ADJ);

    finalNodes.push({
      id: artist.id,
      name: artist.name,
      genres: genresForNode,
      popularity: artist.popularity,
      imageUrl,
      weight,
      state: 'frontier',
      // Provider IDs — determine external URL for non-Spotify artists
      spotifyId: candidateForNode?.spotifyId
        || (artist.id.length === 22 && !artist.id.includes('-') ? artist.id : undefined),
      musicBrainzId: candidateForNode?.musicBrainzId
        || (artist.id.includes('-') && artist.id.length >= 36 ? artist.id : undefined),
      externalUrl: (candidateForNode?.availability?.spotify === false || !candidateForNode?.spotifyId)
        ? `https://www.youtube.com/results?search_query=${encodeURIComponent(artist.name + ' artist')}`
        : undefined,
      audioSignature: signature,
      audioSource,
      confidenceTag,
      adjacentTo: adjacentToCapped,
      x,
      y,
      z,
      // Expansion Intelligence — canonical, computed, deterministic
      expansionDistance,
      expansionBand,
      distanceComponents: candidateForNode?.distanceComponents,
      readinessBucket: profile?.readinessBucket,
      tierEmphasis: 1,
      retrievalPath:
        candidateForNode?.retrievalPath ?? candidateForNode?.retrieval_path,
      sourceTerritory:
        candidateForNode?.sourceTerritory ?? candidateForNode?.source_territory,
      projectionMetadata: {
        expansionDistance,
        expansionBand,
      },
      // OCSE Decision — why this candidate deserves a place in your world
      reachable,
      semanticRole,
      confidenceBand,
      availableActions: ['explore'],
      reasoning: profile ? profile.explanation : [],
      decisionReasons: profile ? profile.decisionReasons : [],
      explanation: profile ? profile.explanation : [],
      candidateEvidence: profile,
      // Expansion Value — gateway / territory-unlock potential
      memoryContribution: Math.round(expValue * 100) / 100,
    });
  }

  // Name-dedup frontier (keep higher discovery / popularity)
  const byName = new Map<string, OrcaNode>();
  for (const n of finalNodes) {
    const key = n.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const prev = byName.get(key);
    if (!prev || (n.popularity || 0) > (prev.popularity || 0)) {
      byName.set(key, n);
    }
  }
  const deduped = Array.from(byName.values());

  // Backfill missing images + empty/weak (only-pop) genres via multi-provider
  const needEnrich = deduped.filter((n) => {
    const weakImg = !n.imageUrl;
    const g = n.genres || [];
    const weakGenre =
      g.length === 0 ||
      g.every((x) => {
        const s = String(x).toLowerCase().trim();
        return s === 'pop' || s === 'unknown';
      });
    return weakImg || weakGenre;
  });
  if (needEnrich.length > 0) {
    try {
      const { enrichArtistIdentity, isWeakImageUrl, persistArtistImageAndGenres } =
        await import('@/lib/artists/enrich-identity');

      const dbRows = await prisma.artist.findMany({
        where: {
          OR: [
            { id: { in: needEnrich.map((n) => n.id) } },
            { displayName: { in: needEnrich.map((n) => n.name) } },
          ],
        },
        select: { id: true, displayName: true, imageUrl: true, rawGenres: true },
      });
      type EnrichedArtistRow = {
        id: string;
        displayName: string;
        imageUrl: string | null;
        rawGenres: string | null;
      };
      const typedDbRows = dbRows as EnrichedArtistRow[];
      const rowsById = new Map<string, EnrichedArtistRow>(typedDbRows.map((row) => [row.id, row]));
      const rowsByName = new Map<string, EnrichedArtistRow>(
        typedDbRows.map((row) => [row.displayName.toLowerCase(), row]),
      );
      const parseDbGenres = (raw: string | null): string[] => {
        if (!raw) return [];
        try {
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
        } catch {
          return raw.split(',').map((g) => g.trim()).filter(Boolean);
        }
      };

      const missingAfterDb = needEnrich.filter((n) => {
        const row = rowsById.get(n.id) ?? rowsByName.get(n.name.toLowerCase());
        if (!row) return true;

        const dbGenres = resolveArtistGenres(parseDbGenres(row.rawGenres), n.name);
        if (row.imageUrl && !isWeakImageUrl(row.imageUrl) && !n.imageUrl) {
          n.imageUrl = row.imageUrl;
        }
        if (dbGenres.length > 0) {
          const current = resolveArtistGenres(n.genres || [], n.name);
          const currentWeak =
            current.length === 0 ||
            current.every((g) => {
              const s = String(g).toLowerCase();
              return s === 'pop' || s === 'unknown';
            });
          if (currentWeak) n.genres = dbGenres;
        }

        const hasImage = Boolean(n.imageUrl && !isWeakImageUrl(n.imageUrl));
        const genres = resolveArtistGenres(n.genres || [], n.name);
        const hasGenres =
          genres.length > 0 &&
          !genres.every((g) => {
            const s = String(g).toLowerCase();
            return s === 'pop' || s === 'unknown';
          });
        return !(hasImage && hasGenres);
      });

      const slice = missingAfterDb.slice(0, 120);
      for (let i = 0; i < slice.length; i += 16) {
        const batch = slice.slice(i, i + 16);
        await Promise.all(
          batch.map(async (n) => {
            try {
              const enr = await enrichArtistIdentity({
                name: n.name,
                spotifyId:
                  n.id.length === 22 && !n.id.includes('-')
                    ? n.id
                    : n.id.startsWith('spotify-')
                      ? n.id.replace(/^spotify-/, '')
                      : undefined,
                genres: n.genres,
                imageUrl: n.imageUrl,
                popularity: n.popularity,
              });
              if (enr.imageUrl && !isWeakImageUrl(enr.imageUrl)) {
                n.imageUrl = enr.imageUrl;
              }
              if (enr.genres.length > 0) {
                // Prefer enrich genres when node empty, only-pop, or enrich is more specific
                const current = resolveArtistGenres(n.genres || [], n.name);
                const enriched = resolveArtistGenres(enr.genres, n.name);
                const currentWeak =
                  current.length > 0 &&
                  current.every((g) => {
                    const s = String(g).toLowerCase();
                    return s === 'pop' || s === 'unknown';
                  });
                if (
                  current.length === 0 ||
                  currentWeak ||
                  (enriched[0] && enriched[0] !== 'pop' && enriched[0] !== 'unknown' && (current[0] === 'pop' || current[0] === 'unknown'))
                ) {
                  n.genres = enriched.length > 0 ? enriched : enr.genres;
                } else if (current.length > 0) {
                  n.genres = current;
                }
              }
              // Persist for next materialize (best-effort)
              void persistArtistImageAndGenres({
                id: n.id,
                name: n.name,
                imageUrl: n.imageUrl,
                genres: n.genres,
                popularity: n.popularity,
                spotifyId: enr.spotifyId,
                musicBrainzId: n.musicBrainzId,
              });
            } catch {
              /* per-artist isolation */
            }
          }),
        );
      }
    } catch (err) {
      console.warn('[CUB Frontier Layout] Image/genre backfill skipped:', err);
    }
  }

  // Default projection visible flags (WPE also sets on globe read)
  for (const n of deduped) {
    if (n.visible === undefined) n.visible = true;
    if (n.reachable === undefined) n.reachable = true;
  }

  // Soft-admit rescue: never ship a fully unreachable frontier (slider/depth UI dies).
  const anyReachable = deduped.some((n) => n.reachable !== false);
  if (!anyReachable && deduped.length > 0) {
    const ranked = [...deduped].sort(
      (a, b) =>
        (b.candidateEvidence?.decisionConfidence ?? 0) -
        (a.candidateEvidence?.decisionConfidence ?? 0),
    );
    const promote = Math.max(12, Math.ceil(ranked.length * 0.5));
    for (const n of ranked.slice(0, promote)) {
      n.reachable = true;
    }
    console.warn(
      `[CUB Frontier Layout] Soft-admit: promoted ${promote}/${deduped.length} frontier nodes (all were below OCSE display floor)`,
    );
  }

  // Collapsed variance: protect shore_seek/leap_seek EI; flag honesty.
  // (Does NOT rewrite real retrieval-path distances — see diversify-distances.ts)
  const diversifyMeta = diversifyExpansionDistancesIfCollapsed(deduped);
  let surfaceOut = recommendationSurface;
  if (surfaceOut && diversifyMeta.distanceVarianceCollapsed) {
    surfaceOut = {
      ...surfaceOut,
      distanceVarianceCollapsed: true,
    };
  }

  const nodes = deduped.slice(0, 500);
  console.log(
    `[CUB Frontier Layout] Returning ${nodes.length} frontier nodes (images missing: ${nodes.filter((n) => !n.imageUrl).length})` +
      (diversifyMeta.distanceVarianceCollapsed
        ? ` [varCollapsed protected=${diversifyMeta.protectedCount} remappedAdj=${diversifyMeta.remappedCount}]`
        : ''),
  );
  return {
    nodes,
    surface: surfaceOut,
    readiness: readinessState,
    leapSeekMeta,
    serveLogFailure,
  };
}
