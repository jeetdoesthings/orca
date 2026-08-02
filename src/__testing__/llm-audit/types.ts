/**
 * LLM Taste-Expansion Audit — shared types.
 *
 * Stage trace types for capturing the full pipeline per persona×tier.
 * Audit result types for Parts 2–4.
 */
import type { TasteIdentity } from '@/lib/identity/orca-identity';
import type { RetrievedArtist } from '@/lib/retrieval/types';
import type { Candidate } from '@/lib/candidate/cub-types';
import type { LLMRecommendation, LLMRecommendationResult } from '@/lib/recommendation/llm-engine';
import type { VerifiedRecommendation } from '@/lib/recommendation/grounding';
import type { RecommendationSurface } from '@/lib/ocse/ocse-types';
import type { DisaggregatedDistance } from '@/lib/expansion/distance-components';

// ─── Persona ──────────────────────────────────────────────────────────

export type PersonaTier = 'comfort' | 'expansion' | 'leap';

export interface PersonaDefinition {
  id: string;
  label: string;
  description: string;
  homeTerritory: { genres: string[]; primaryGenre: string; country?: string };
  coldStart: boolean;
  seedArtists: Array<{ name: string; genres: string[]; popularity: number }>;
  /** Mock explored artists (OrcaNode shape without coordinates). */
  exploredArtists: Array<{
    id: string;
    name: string;
    genres: string[];
    popularity: number;
    weight: number;
  }>;
  listeningHistory: Array<{ artistId: string; eventType: string }>;
  tasteDrift: { recentGenres: string[]; longTermGenres: string[]; driftScore: number };
}

// ─── Pipeline Stage Traces ────────────────────────────────────────────

export interface IdentityTrace {
  identity: TasteIdentity;
  artistCount: number;
  homeGenres: string[];
}

export interface RetrievalTrace {
  rawRetrieved: RetrievedArtist[];
  rawCandidateCount: number;
  apiErrors: string[];
}

export interface PrefilterTrace {
  inputCount: number;
  outputCount: number;
  filteredOut: Array<{ artistId: string; name: string; reason: string }>;
  /** Fraction removed: filteredOut / inputCount. */
  filterFraction: number;
}

export interface LLMTrace {
  result: LLMRecommendationResult;
  pickCount: number;
  validationErrors: string[];
  /** Which tier was requested (for tier-consistency checks). */
  requestedTier: PersonaTier;
}

export interface GroundingTrace {
  verified: VerifiedRecommendation[];
  acceptedCount: number;
  rejectedCount: number;
  rejections: Array<{ artist: string; reasons: string[] }>;
}

export interface DistanceTrace {
  surface: RecommendationSurface;
  candidates: Candidate[];
  bucketCounts: { comfort: number; expansion: number; leap: number };
  mismatches: Array<{
    artist: string;
    distanceIntent: string;
    expansionDistance: number;
    assignedBucket: string;
    mismatch: boolean;
  }>;
}

export interface MaterializedTrace {
  comfort: Array<{ artist: string; explanation: string; genres: string[] }>;
  expansion: Array<{ artist: string; explanation: string; genres: string[] }>;
  leap: Array<{ artist: string; explanation: string; genres: string[] }>;
}

export interface PipelineStageTrace {
  personaId: string;
  tier: PersonaTier;
  identity: IdentityTrace;
  retrieval: RetrievalTrace;
  prefilter: PrefilterTrace;
  llm: LLMTrace;
  grounding: GroundingTrace;
  distance: DistanceTrace;
  materialized: MaterializedTrace;
}

// ─── Audit Results (Part 2) ───────────────────────────────────────────

export interface RetrieverCoverageAudit {
  countsPerPersona: Record<string, number>;
  countsPerPersonaTier: Record<string, Record<string, number>>;
  apiFailures: number;
  thinPools: string[]; // personaIds with < 10 results
}

export interface PrefilterIntegrityAudit {
  exploredInLLMPool: number;
  duplicatesInLLMPool: number;
  filterFractions: Record<string, number>; // per persona
}

export interface HallucinationAudit {
  ratesPerPersona: Record<string, number>;
  ratesPerPersonaTier: Record<string, Record<string, number>>;
  overallRate: number;
  totalPicks: number;
  totalHallucinated: number;
}

export interface TierConsistencyAudit {
  mismatchRateOverall: number;
  mismatchRatePerIntent: Record<string, number>;
  mismatchRatePerPersona: Record<string, number>;
  mismatches: Array<{
    persona: string;
    artist: string;
    distanceIntent: string;
    expansionDistance: number;
    reason: string;
  }>;
}

export interface HonestyFlagsAudit {
  shoreBucketFallbackCount: number;
  distanceVarianceCollapsedCount: number;
  leapBucketFallbackCount: number;
  totalTraces: number;
}

export interface ExplanationGroundednessAudit {
  totalChecked: number;
  genericCount: number;
  genericRate: number;
  genericExamples: Array<{ persona: string; artist: string; explanation: string }>;
}

// ─── Audit Results (Part 3) ───────────────────────────────────────────

export interface GenericnessAudit {
  perPersona: Record<
    string,
    {
      deepPickCount: number;
      canonicalCount: number;
      genericnessScore: number;
      canonicalPicks: string[];
      variedPicks: string[];
    }
  >;
}

export interface CrossPersonaOverlapAudit {
  pairs: Array<{
    personaA: string;
    personaB: string;
    comparison: string;
    overlapPercent: number;
    intersection: string[];
    union: string[];
  }>;
}

export interface RubricScore {
  representativeness: number; // Q1: 1-5
  accessibility: number; // Q2: 1-5
  notDiluted: number; // Q3: 1-5
  specificReasoning: number; // Q4: 1-5
}

export interface GatewayRubricAudit {
  perRecommendation: Array<{
    persona: string;
    tier: string;
    artist: string;
    score: RubricScore;
    source: 'llm-judge' | 'heuristic';
  }>;
  averages: RubricScore;
  perQuestionAverages: Record<keyof RubricScore, number>;
}

// ─── Audit Results (Part 4) ───────────────────────────────────────────

export interface RepeatabilityResult {
  personaId: string;
  runCount: number;
  pairwiseOverlaps: number[];
  averageOverlap: number;
  runs: Array<{ artistSet: string[] }>;
}

// ─── Final Report ─────────────────────────────────────────────────────

export interface AuditReport {
  generatedAt: string;
  totalTraces: number;
  tracesPerPersona: Record<string, number>;
  part2: {
    retrieverCoverage: RetrieverCoverageAudit;
    prefilterIntegrity: PrefilterIntegrityAudit;
    hallucinationRate: HallucinationAudit;
    tierConsistency: TierConsistencyAudit;
    honestyFlags: HonestyFlagsAudit;
    explanationGroundedness: ExplanationGroundednessAudit;
  };
  part3: {
    genericness: GenericnessAudit;
    crossPersonaOverlap: CrossPersonaOverlapAudit;
    gatewayRubric: GatewayRubricAudit;
  };
  part4: {
    repeatability: RepeatabilityResult[];
  };
}
