/**
 * ORCA Backend Layer 4: Latent Compatibility Engine — Types and Configuration
 */

export interface CompatibilityWeights {
  cultural: number;
  sensory: number;
}

export interface CompatibilityConfig {
  weights: CompatibilityWeights;
  confidenceThreshold: number;
  minSimilarityThreshold: number;
  explanationThreshold: number;
  version: number;
}

/** Default weights and parameters (fully configurable) */
export const DEFAULT_COMPATIBILITY_CONFIG: CompatibilityConfig = {
  weights: {
    cultural: 0.50, // 50% collaborative filtering / listening graph
    sensory: 0.50,  // 50% pure acoustic characteristics
  },
  confidenceThreshold: 0.4,       // Minimum artist embedding confidence to include in centroid calculations
  minSimilarityThreshold: 0.01,   // Cutoff similarity for graph proximity calculations
  explanationThreshold: 0.65,     // Score above which we generate structured explanations
  version: 1,
};

export interface UserTerritoryAffinityResult {
  userId: string;
  territoryId: string;
  compatibilityScore: number;
  culturalCompatibility: number;
  sensoryCompatibility: number;
  structuralDistance: number;
  accessibility: number;
  confidence: number;
  occupancy: number;
  hiddenPotential: number;
  explanation: string; // JSON string of StructuredExplanation
  computedAt: Date;
  modelVersion: number;
}

export interface StructuredExplanation {
  primaryDrivers: string[];
  reasons: string[];
}
