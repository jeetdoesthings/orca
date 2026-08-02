import type { GenreRelationship } from '@/lib/gre/gre-types';
import type { TerritoryRejection } from './decision-score';
import type { ReadinessState, ReadinessTier } from '@/lib/readiness/readiness-types';
import type { DisaggregatedDistance } from '@/lib/expansion/distance-components';

export interface UserInteractionHistory {
  timesShown: Record<string, number>;
  timesIgnored: Record<string, number>;
  timesDismissed: Record<string, number>;
  timesIntegrated: Record<string, number>;
  lastShown: Record<string, string>; // ISO date string
  /**
   * Part 7: territory-direction rejections for Readiness recovery.
   * Part 11 territory-wide rejects use severity: 'territory_reject'.
   */
  territoryRejections?: TerritoryRejection[];
}

export interface OCSEContext {
  relationships: GenreRelationship[];
  /** @deprecated Prefer readinessState.recommendedTier — kept for legacy sliderCompatibility. */
  sliderValue: number; // 0.0 - 1.0
  interactionHistory: UserInteractionHistory;
  currentVisibleWorldIds: string[];
  /**
   * Change B: authoritative readiness. When set, OCSE must not invent tiers.
   */
  readinessState?: ReadinessState;
}

/**
 * Change C: bucketed OCSE output — all three tiers computed together.
 */
export interface RecommendationSurface {
  comfort: DecisionProfile[];
  expansion: DecisionProfile[];
  leap: DecisionProfile[];
  readiness: ReadinessState;
  generatedAt: string;
  /**
   * True when leap min population required threshold-widen on near pool
   * after leap-seek refill still failed (Component 2).
   */
  leapBucketFallback?: boolean;
  /** Count of leap-seek-tagged candidates in leap bucket (debug / UI). */
  leapSeekInLeapCount?: number;
  /**
   * True when Shore-range (d < 0.34) pool still empty after shore-seek
   * and rank-remap may fabricate Shore membership (last resort).
   */
  shoreBucketFallback?: boolean;
  /**
   * True when expansionDistance variance collapsed (< 0.002) and distances
   * were rank-remapped because the signal itself is too compressed.
   */
  distanceVarianceCollapsed?: boolean;
  /** Count of shore_seek-tagged candidates under Shore distance bar. */
  shoreSeekInShoreCount?: number;
}

export type { ReadinessTier, DisaggregatedDistance };

export interface DecisionProfile {
  candidateId: string;
  relationshipSupport: number; // 0.0 - 1.0
  growthContribution: number;  // 0.0 - 1.0
  noveltyContribution: number;   // 0.0 - 1.0
  timingContribution: number;    // 0.0 - 1.0
  sliderCompatibility: number;   // 0.0 - 1.0
  cooldownMultiplier: number;    // 0.0 - 1.0
  discoveryConfidence: number;   // 0.0 - 1.0
  /**
   * Final ranking score (Part 7 DecisionScore after cooldown).
   * Pipeline visibility threshold reads this field.
   */
  decisionConfidence: number;    // 0.0 - 1.0
  /** Part 7: geo-mean DecisionScore before aliasing to decisionConfidence. */
  decisionScore?: number;
  /** Part 7 components — inspectable for every scored candidate. */
  tesProxy?: number;
  readiness?: number;
  batchDiversity?: number;
  dataConfidence?: number;
  // Phase 2 P0-1: OCSE is now a pure reader of this field. Expansion Intelligence
  // owns it and threads it through Candidate.expansionDistance before OCSE runs.
  // Undefined when Expansion Intelligence has not computed it for this candidate
  // (e.g. the /api/debug/ocse route, which does not run Expansion Intelligence).
  // OCSE MUST NOT fabricate a value here — see RULE-10 and confidence.md §6.
  expansionDistance?: number;    // 0.0 - 1.0 — distance in taste space, NOT a confidence
  /** Change A: full distance breakdown when available. */
  distanceComponents?: DisaggregatedDistance;
  /** Change C: exclusive primary bucket assignment. */
  readinessBucket?: ReadinessTier;
  /** Bucket-specific distance-fit score [0,1]. */
  bucketDistanceFit?: number;
  /**
   * Metadata completeness confidence (four-axis model).
   * high | partial | low — legacy audio-era tags still normalize.
   */
  audioSource?:
    | 'high_confidence'
    | 'partial_confidence'
    | 'low_confidence'
    | 'real_audio'
    | 'tag_inferred'
    | 'cold_start_default'
    | 'REAL'
    | 'SYNTHETIC'
    | 'MISSING';
  confidenceTag?:
    | 'high_confidence'
    | 'partial_confidence'
    | 'low_confidence'
    | 'real_audio'
    | 'tag_inferred'
    | 'cold_start_default';
  decisionReasons: string[];
  explanation: string[];
}
