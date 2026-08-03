import type { Candidate } from '@/lib/candidate/cub-types';
import type { AudioSignature, OrcaNode } from '@/lib/graph/types';
import { normaliseGenreOrUnknown } from '@/lib/graph/genre-normaliser';
import { resolveAudioSignature, type AudioSource } from '@/lib/audio/resolve-signature';
import {
  computeDisaggregatedDistance,
  expansionBandFromDistance,
} from '@/lib/expansion/intelligence';
import type { ReadinessHistoryEvent, ReadinessState, ReadinessTier } from '@/lib/readiness/readiness-types';
import { computeReadinessState } from '@/lib/readiness/readiness-model';
import type { GenreRelationship } from '@/lib/gre/gre-types';
import type { DecisionProfile, RecommendationSurface } from '@/lib/ocse/ocse-types';
import type { TasteIdentity } from '@/lib/identity/orca-identity';
import type { VerifiedRecommendation } from './grounding';
import type { LeapSeekMeta } from '@/lib/frontier/types';

export interface ClassifySurfaceInput {
  userId: string;
  identity: TasteIdentity;
  verified: VerifiedRecommendation[];
  candidates: Candidate[];
  exploredArtists: OrcaNode[];
  userCentroid: AudioSignature;
  userGenreProfile: Map<string, number>;
  realAudioById: Map<string, AudioSignature>;
  explicitTier?: ReadinessTier | null;
  /** GRE per-genre relationships — required for full Readiness Model. */
  relationships?: GenreRelationship[];
  /** Rolling accept/reject/tier-override history — required for full Readiness Model. */
  historyEvents?: ReadinessHistoryEvent[];
}

export interface ClassifySurfaceResult {
  candidates: Candidate[];
  surface: RecommendationSurface;
  readiness: ReadinessState;
  profileMap: Map<string, DecisionProfile>;
  candidateAudioById: Map<string, { signature: AudioSignature; source: AudioSource }>;
  leapSeekMeta: LeapSeekMeta;
}

function overlapRatio(a: string[], b: string[]): number {
  const sa = new Set(a.map((g) => normaliseGenreOrUnknown([g]) || g.toLowerCase()));
  const sb = new Set(b.map((g) => normaliseGenreOrUnknown([g]) || g.toLowerCase()));
  if (sa.size === 0 || sb.size === 0) return 0;
  let n = 0;
  for (const x of sa) if (sb.has(x)) n++;
  return n / Math.min(sa.size, sb.size);
}

function bucketFromIntent(intent: string, composite: number, overlap: number): ReadinessTier {
  // Intent is the primary signal (honestly derived from the retrieval path:
  // leap_seek → Deep, shore_seek → Shore, adjacency → Shallow).
  // Distance acts as a sanity gate only at the extremes: an intent that
  // strongly contradicts the measured distance is demoted.
  const want: ReadinessTier | null =
    intent === 'Deep' ? 'leap' : intent === 'Shore' ? 'comfort' : intent === 'Shallow' ? 'expansion' : null;
  if (want) {
    if (want === 'leap' && composite < 0.34) return 'expansion'; // claimed far, measured close
    if (want === 'comfort' && composite > 0.67) return 'expansion'; // claimed close, measured far
    return want;
  }
  if (composite >= 0.67) return 'leap';
  if (composite <= 0.34) return 'comfort';
  if (overlap < 0.12) return 'leap';
  if (overlap > 0.45) return 'comfort';
  return 'expansion';
}

function confidenceNumber(tag?: string): number {
  if (tag === 'high_confidence' || tag === 'real_audio' || tag === 'REAL') return 0.9;
  if (tag === 'low_confidence' || tag === 'cold_start_default' || tag === 'MISSING') return 0.45;
  return 0.7;
}

function makeReadiness(
  input: Pick<ClassifySurfaceInput, 'identity' | 'explicitTier' | 'relationships' | 'historyEvents'>,
): ReadinessState {
  return computeReadinessState({
    relationships: input.relationships ?? [],
    history: input.historyEvents ?? [],
    explicitTier: input.explicitTier ?? null,
  });
}

function profileFor(input: {
  candidate: Candidate;
  verified: VerifiedRecommendation;
  bucket: ReadinessTier;
  distanceFit: number;
  rank: number;
}): DecisionProfile {
  const conf = Math.min(
    0.98,
    Math.max(0.12, input.verified.confidence * 0.7 + input.distanceFit * 0.2 + (1 / input.rank) * 0.1),
  );
  const explanation = [
    input.verified.recommendation.explanation ||
      `Expands through ${input.verified.recommendation.territoryFraming || input.candidate.genres[0] || 'a grounded adjacent territory'}.`,
  ];
  return {
    candidateId: input.candidate.artistId,
    relationshipSupport: input.distanceFit,
    growthContribution: input.bucket === 'leap' ? 0.85 : input.bucket === 'expansion' ? 0.68 : 0.48,
    noveltyContribution: input.candidate.expansionDistance ?? 0.5,
    timingContribution: 0.75,
    sliderCompatibility: input.bucket === 'expansion' ? 0.85 : 0.7,
    cooldownMultiplier: 1,
    discoveryConfidence: input.verified.confidence,
    decisionConfidence: Math.round(conf * 1000) / 1000,
    decisionScore: Math.round(conf * 1000) / 1000,
    tesProxy: Math.round(((input.candidate.expansionDistance ?? 0.5) * input.verified.confidence) * 1000) / 1000,
    readiness: 0.8,
    batchDiversity: 0.75,
    dataConfidence: confidenceNumber(input.candidate.confidenceTag),
    expansionDistance: input.candidate.expansionDistance,
    distanceComponents: input.candidate.distanceComponents,
    readinessBucket: input.bucket,
    bucketDistanceFit: input.distanceFit,
    audioSource: input.candidate.audioSource,
    confidenceTag: input.candidate.confidenceTag,
    decisionReasons: [
      input.bucket === 'comfort'
        ? 'REACHABLE'
        : input.bucket === 'expansion'
          ? 'RECOMMENDED_EXPANSION'
          : 'BRIDGE',
    ],
    explanation,
  };
}

export function classifyAndValidateSurface(input: ClassifySurfaceInput): ClassifySurfaceResult {
  const candidateAudioById = new Map<string, { signature: AudioSignature; source: AudioSource }>();
  const accepted = input.verified
    .filter((v) => v.accepted)
    .sort((a, b) => a.recommendation.rank - b.recommendation.rank);
  const homeGenres = input.identity.homeTerritory.genres;
  const candidates: Candidate[] = [];
  const buckets: Record<ReadinessTier, DecisionProfile[]> = {
    comfort: [],
    expansion: [],
    leap: [],
  };
  const leapTargets = new Set<string>();

  for (const verified of accepted) {
    const c: Candidate = { ...verified.candidate };
    const genres = c.genres?.length ? c.genres : verified.artist.genres;
    const { signature, source } = resolveAudioSignature({
      artistId: c.artistId,
      genres,
      real: input.realAudioById.get(c.artistId) ?? null,
    });
    candidateAudioById.set(c.artistId, { signature, source });
    const distance = computeDisaggregatedDistance({
      userCentroid: input.userCentroid,
      userGenreProfile: input.userGenreProfile,
      // Real GRE relationships — distances must be personalized, not anonymous.
      relationships: input.relationships ?? [],
      candidateGenres: genres.length ? genres : ['unknown'],
      candidatePopularity: c.popularity,
      priorObservedPlays: 0,
    });
    c.distanceComponents = distance;
    c.expansionDistance = Math.round(distance.composite * 100) / 100;
    c.expansionBand = expansionBandFromDistance(c.expansionDistance);
    c.confidenceTag = verified.confidence >= 0.85 ? 'high_confidence' : verified.confidence >= 0.65 ? 'partial_confidence' : 'low_confidence';
    c.audioSource = c.confidenceTag;
    c.discoveryConfidence = verified.confidence;
    c.retrievalPath = c.retrievalPath ?? verified.artist.retrievalPath;
    c.sourceTerritory = c.sourceTerritory ?? verified.artist.sourceTerritory ?? genres[0];
    const overlap = overlapRatio(homeGenres, genres);
    const bucket = bucketFromIntent(verified.recommendation.distanceIntent, c.expansionDistance, overlap);
    if (bucket === 'leap' && c.sourceTerritory) leapTargets.add(c.sourceTerritory);
    const distanceFit =
      bucket === 'comfort'
        ? 1 - Math.min(1, c.expansionDistance / 0.5)
        : bucket === 'leap'
          ? Math.min(1, c.expansionDistance / 0.7)
          : 1 - Math.abs(c.expansionDistance - 0.5);
    const profile = profileFor({
      candidate: c,
      verified,
      bucket,
      distanceFit: Math.round(Math.max(0.15, distanceFit) * 1000) / 1000,
      rank: Math.max(1, verified.recommendation.rank),
    });
    candidates.push(c);
    buckets[bucket].push(profile);
  }

  const sortProfiles = (profiles: DecisionProfile[]) =>
    profiles.sort((a, b) => {
      const ra = accepted.find((v) => v.candidate.artistId === a.candidateId)?.recommendation.rank ?? 999;
      const rb = accepted.find((v) => v.candidate.artistId === b.candidateId)?.recommendation.rank ?? 999;
      return ra - rb;
    });
  const readiness = makeReadiness({
    identity: input.identity,
    explicitTier: input.explicitTier,
    relationships: input.relationships,
    historyEvents: input.historyEvents,
  });
  const surface: RecommendationSurface = {
    comfort: sortProfiles(buckets.comfort),
    expansion: sortProfiles(buckets.expansion),
    leap: sortProfiles(buckets.leap),
    readiness,
    generatedAt: new Date().toISOString(),
    leapBucketFallback: buckets.leap.length === 0,
    leapSeekInLeapCount: buckets.leap.filter((p) => {
      const c = candidates.find((x) => x.artistId === p.candidateId);
      return c?.retrievalPath === 'leap_seek';
    }).length,
    shoreBucketFallback: buckets.comfort.length === 0,
    distanceVarianceCollapsed: false,
    shoreSeekInShoreCount: buckets.comfort.filter((p) => {
      const c = candidates.find((x) => x.artistId === p.candidateId);
      return c?.retrievalPath === 'shore_seek' || (c?.expansionDistance ?? 1) < 0.34;
    }).length,
  };

  return {
    candidates,
    surface,
    readiness,
    profileMap: new Map([...surface.comfort, ...surface.expansion, ...surface.leap].map((p) => [p.candidateId, p])),
    candidateAudioById,
    leapSeekMeta: { targetedTerritories: Array.from(leapTargets).slice(0, 12) },
  };
}
