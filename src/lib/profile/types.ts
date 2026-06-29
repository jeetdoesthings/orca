/**
 * ORCA User Profiling System — Core Type Definitions
 *
 * Multi-layer profile architecture:
 *   1. Surface Profile — what the user listens to
 *   2. Sonic Profile — how the music sounds
 *   3. Trait Profile — inferred taste dimensions (registry-driven)
 *   4. Discovery Profile — readiness for exploration
 *   5. Trajectory Profile — how taste changes over time
 *   6. Confidence Profile — reliability of inferences
 *
 * All types are data-driven and extensible. No hard-coded artist or genre logic.
 */

import type { AudioSignature } from '@/lib/graph/types';

// ─── Trait Registry Types ───────────────────────────────────────────

/** Transform functions for mapping audio features to trait scores */
export type FeatureTransform = 'linear' | 'inverse' | 'quadratic' | 'threshold';

/** A feature weight entry in a trait definition */
export interface FeatureWeight {
  /** How much this feature contributes to the trait (0.0 - 1.0) */
  weight: number;
  /** How the raw feature value is transformed before weighting */
  transform: FeatureTransform;
  /** For 'threshold' transforms: the cutoff value */
  threshold?: number;
}

/** Meta-signal types derived from aggregate listening behavior */
export type MetaSignalType =
  | 'genre_diversity'
  | 'popularity_avg'
  | 'popularity_variance'
  | 'tempo_variance'
  | 'feature_variance'
  | 'artist_count'
  | 'weight_concentration';

/** A meta-signal entry in a trait definition */
export interface MetaSignalWeight {
  weight: number;
  type: MetaSignalType;
}

/** Strategies for computing per-trait confidence */
export type ConfidenceStrategy = 'sample_size' | 'signal_strength' | 'combined';

/** Trait family groupings */
export type TraitFamily =
  | 'mood'
  | 'energy'
  | 'texture'
  | 'structure'
  | 'atmosphere'
  | 'emotional-tone'
  | 'novelty-behavior'
  | 'intensity';

/**
 * A trait definition in the dynamic registry.
 * Traits are pure data — no code branches. New traits are added by
 * creating new definition objects with feature mappings.
 */
export interface TraitDefinition {
  /** Unique identifier (slug) */
  id: string;
  /** Internal name */
  name: string;
  /** Human-readable display label */
  displayLabel: string;
  /** Family grouping for organization */
  family: TraitFamily;
  /** Human-readable description of what this trait means */
  description: string;
  /**
   * Maps AudioSignature keys → weight + transform.
   * These are the primary signals from audio features.
   */
  featureWeights: Partial<Record<keyof AudioSignature, FeatureWeight>>;
  /**
   * Optional meta-signals derived from aggregate listening behavior.
   * These supplement audio features with behavioral data.
   */
  metaSignals?: Record<string, MetaSignalWeight>;
  /** How confidence is calculated for this trait */
  confidenceStrategy: ConfidenceStrategy;
  /** Whether this trait is currently active in the pipeline */
  active: boolean;
  /** Whether this trait should be shown in user-facing UI */
  userVisible: boolean;
  /** Schema version for migration compatibility */
  version: number;
}

// ─── Profile Layer Types ────────────────────────────────────────────

/**
 * Layer 1: Surface Profile
 * Coarse representation of what the user listens to.
 */
export interface SurfaceProfile {
  /** Top artists by listening weight */
  topArtists: SurfaceArtist[];
  /** Top genres by aggregated weight */
  topGenres: SurfaceGenre[];
  /** Total unique artists in the profile */
  totalArtists: number;
  /** Total unique genres */
  totalGenres: number;
  /** Genre distribution as percentage shares (genre → 0.0–1.0) */
  listeningDistribution: Record<string, number>;
}

export interface SurfaceArtist {
  id: string;
  name: string;
  weight: number;
}

export interface SurfaceGenre {
  genre: string;
  weight: number;
  count: number;
}

/**
 * Layer 2: Sonic Profile
 * Numerical/vector representation of sonic preferences.
 */
export interface SonicProfile {
  /** Weighted average AudioSignature across all artists */
  centroid: AudioSignature;
  /** Per-dimension variance — how spread the user's features are */
  variance: AudioSignature;
  /** Notable extreme values in the user's sonic preference */
  extremes: SonicExtreme[];
  /** Dimensions where the user has strongest signal (sorted) */
  dominantDimensions: string[];
}

export interface SonicExtreme {
  dimension: string;
  value: number;
  direction: 'high' | 'low';
}

/**
 * Layer 3: Trait Profile
 * Registry-driven inferred taste traits.
 */
export interface TraitProfile {
  /** All computed trait scores */
  scores: TraitScore[];
  /** Top 3-5 trait IDs by score (high confidence only) */
  dominantTraits: string[];
  /** Traits with rising trend */
  emergingTraits: string[];
  /** Lowest-scoring traits — gaps for taste expansion */
  absentTraits: string[];
}

export interface TraitScore {
  traitId: string;
  score: number;        // 0.0 - 1.0
  confidence: number;   // 0.0 - 1.0
  trend: 'rising' | 'stable' | 'declining';
  lastUpdated: string;  // ISO timestamp
}

/**
 * Layer 4: Discovery Profile
 * How ready the user is for taste expansion.
 */
export interface DiscoveryProfile {
  /** Overall appetite for new/unfamiliar music (0.0 - 1.0) */
  noveltyAppetite: number;
  /** Shannon entropy of genre distribution (normalized 0.0 - 1.0) */
  genreDiversity: number;
  /** How spread listening is across artists (0.0 - 1.0) */
  artistDiversity: number;
  /** Willingness to cross genre boundaries (0.0 - 1.0) */
  boundaryOpenness: number;
  /** Rate of new artists explored recently */
  explorationVelocity: number;
  /** Composite readiness score (0.0 - 1.0) */
  overallReadiness: number;
  /** Human-readable readiness band */
  readinessLabel: 'low' | 'moderate' | 'high' | 'very high';
  /** Recommended novelty distance for taste expansion */
  optimalNoveltyLevel: number;
}

/**
 * Layer 5: Trajectory Profile
 * How the user's taste is changing over time.
 */
export interface TrajectoryProfile {
  /** Overall direction of taste movement */
  direction: 'widening' | 'narrowing' | 'stable' | 'oscillating';
  /** Rate of change (0.0 = frozen, 1.0 = rapid) */
  velocity: number;
  /** Recent measurable shifts */
  recentShifts: TrajectoryShift[];
  /** Human-readable long-term trend description */
  longTermTrend: string;
  /** How stable the profile is over time (0.0 = volatile, 1.0 = rock-solid) */
  stability: number;
}

export interface TrajectoryShift {
  metric: string;
  previousValue: number;
  currentValue: number;
  direction: 'up' | 'down' | 'stable';
  magnitude: number;
  timestamp: string;
}

/**
 * Layer 6: Confidence Profile
 * Reliability assessment of all inferences.
 */
export interface ConfidenceProfile {
  /** Overall profile confidence (0.0 - 1.0) */
  overall: number;
  /** How much data we have vs. what we'd ideally want */
  dataCompleteness: number;
  /** Number of data points used */
  sampleSize: number;
  /** Strength of signals across all traits */
  signalStrength: number;
  /** Trait IDs with high confidence (>= 0.7) */
  stableTraits: string[];
  /** Trait IDs with medium confidence (0.4 - 0.7) */
  emergingTraits: string[];
  /** Trait IDs with low confidence (< 0.4) */
  speculativeTraits: string[];
}

/**
 * Explanation payload — human-readable profile output.
 */
export interface ExplanationPayload {
  /** One-sentence taste summary */
  shortSummary: string;
  /** Detailed multi-sentence explanation */
  detailedSummary: string;
  /** Per-dimension explanations */
  traitExplanations: Record<string, string>;
  /** Discovery readiness explanation */
  discoveryExplanation: string;
  /** Trajectory explanation */
  trajectoryExplanation: string;
}

// ─── Complete Profile ───────────────────────────────────────────────

/**
 * The complete multi-layer user profile.
 * This is the master output of the profiling pipeline and the
 * primary input to all downstream systems (frontier ranking,
 * taste expansion, explainability, analytics).
 */
export interface UserProfile {
  userId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  surfaceProfile: SurfaceProfile;
  sonicProfile: SonicProfile;
  traitProfile: TraitProfile;
  discoveryProfile: DiscoveryProfile;
  trajectoryProfile: TrajectoryProfile;
  confidenceProfile: ConfidenceProfile;
  explanations: ExplanationPayload;
}

// ─── Pipeline Input Types ───────────────────────────────────────────

/**
 * Meta-signals computed from aggregate listening behavior.
 * These are passed to the trait inference engine alongside audio features.
 */
export interface ComputedMetaSignals {
  genreDiversity: number;
  popularityAvg: number;
  popularityVariance: number;
  tempoVariance: number;
  featureVariance: number;
  artistCount: number;
  weightConcentration: number;
}
