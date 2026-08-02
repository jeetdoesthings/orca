import type { DecisionProfile } from './ocse-types';
import type { Candidate, EvidenceSource } from '@/lib/candidate/cub-types';
import type { GenreRelationship } from '@/lib/gre/gre-types';
import { expansionBandFromDistance } from '@/lib/expansion/intelligence';

export interface RecommendationTrace {
  /** Target candidate ID */
  candidateId: string;
  /** Display name of the candidate artist */
  artistName: string;
  /** Popularity rating of the artist */
  popularity: number;
  /** Array of raw normalised genres matched to the artist */
  genres: string[];
  /** Normalized genre growth opportunity category satisfied by candidate */
  growthOpportunityGenre: string;
  /** Relationship stage of the matched opportunity genre at evaluation time */
  relationshipStage: string;
  /** Complete historical metrics of matched opportunity genre */
  relationshipMetrics: {
    familiarity: number;
    diversity: number;
    identity: number;
    recency: number;
    stability: number;
  } | null;
  /** Complete list of evidence sources aggregated by CUB discovery */
  rawDiscoveryEvidence: EvidenceSource[];
  /** Value coordinates across the 7 selection dimensions evaluated by OCSE */
  decisionDimensions: {
    relationshipSupport: number;
    growthContribution: number;
    noveltyContribution: number;
    timingContribution: number;
    sliderCompatibility: number;
    discoveryConfidence: number;
    cooldownMultiplier: number;
  };
  /** Final calculated selection confidence */
  decisionConfidence: number;
  /** Semantic taste expansion distance (0.0 to 1.0) */
  expansionDistance: number;
  /** Semantic classification band */
  expansionBand: 'CORE' | 'FAMILIAR' | 'COMFORT_EDGE' | 'EXPANSION' | 'OUTER_EDGE' | 'UNKNOWN';
  /** Structured decision classifications */
  decisionReasons: string[];
}

/**
 * Reconstructs the complete evidence lineage and dimensions trace for a recommendation,
 * allowing downstream layout and client systems to render details at arbitrary granularities.
 */
export function generateRecommendationTrace(
  profile: DecisionProfile,
  candidate: Candidate,
  relationship?: GenreRelationship
): RecommendationTrace {
  const dist = profile.expansionDistance ?? 0.0;
  // Sole band map: WorldConfig.expansionBands via expansionBandFromDistance.
  const band = expansionBandFromDistance(dist);

  return {
    candidateId: profile.candidateId,
    artistName: candidate.name,
    popularity: candidate.popularity,
    genres: candidate.genres || [],
    growthOpportunityGenre: candidate.discoveryContext.growthOpportunity,
    relationshipStage: relationship?.stage || 'UNTUCHED',
    relationshipMetrics: relationship ? {
      familiarity: relationship.metrics.familiarity,
      diversity: relationship.metrics.diversity,
      identity: relationship.metrics.identity,
      recency: relationship.metrics.recency,
      stability: relationship.metrics.stability
    } : null,
    rawDiscoveryEvidence: candidate.discoveryContext.sources,
    decisionDimensions: {
      relationshipSupport: profile.relationshipSupport,
      growthContribution: profile.growthContribution,
      noveltyContribution: profile.noveltyContribution,
      timingContribution: profile.timingContribution,
      sliderCompatibility: profile.sliderCompatibility,
      discoveryConfidence: profile.discoveryConfidence,
      cooldownMultiplier: profile.cooldownMultiplier
    },
    decisionConfidence: profile.decisionConfidence,
    expansionDistance: dist,
    expansionBand: band,
    decisionReasons: profile.decisionReasons
  };
}
export { generateRecommendationTrace as buildExplanationChain };
