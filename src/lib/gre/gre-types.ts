/**
 * Core type definitions for the Genre Relationship Engine (GRE).
 * Excludes any recommendation, candidate generation, or visibility logic.
 */

export type GenreRelationshipState =
  | 'UNTUCHED'
  | 'INTRODUCED'
  | 'EXPLORING'
  | 'GROWING'
  | 'INTEGRATED'
  | 'CORE_IDENTITY'
  | 'REDISCOVER';

export interface GenreRelationshipMetrics {
  familiarity: number; // 0.0 - 1.0
  diversity: number; // 0.0 - 1.0
  identity: number; // 0.0 - 1.0
  recency: number; // 0.0 - 1.0
  stability: number; // 0.0 - 1.0
}

export interface GenreRelationshipSummary {
  relationshipStrength: number;  // 0.0 - 1.0
  relationshipMomentum: number;  // 0.0 - 1.0
  relationshipBreadth: number;   // 0.0 - 1.0
  relationshipConfidence: number; // 0.0 - 1.0
}

export interface GenreRelationshipHistory {
  previousStage: GenreRelationshipState | null;
  currentStage: GenreRelationshipState;
  enteredAt: string;
  lastUpdated: string;
  stageDurationMs: number;
}

export interface GenreRelationship {
  genre: string;
  stage: GenreRelationshipState;
  metrics: GenreRelationshipMetrics;
  summary: GenreRelationshipSummary;
  confidence: number; // 0.0 - 1.0
  history?: GenreRelationshipHistory;
  reasoning?: string[];
}
