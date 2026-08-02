/**
 * Readiness Model types (Change B).
 * Authoritative session readiness — OCSE / WPE / frontend consume only.
 */

import type { ReadinessTier } from '@/lib/config/readiness';
import type { GenreRelationship } from '@/lib/gre/gre-types';

export type { ReadinessTier };

/** Rolling interaction signals inside the history window. */
export interface ReadinessHistoryEvent {
  type: 'accept' | 'reject' | 'skip' | 'integrate' | 'tier_override';
  at: Date | string;
  /** For tier_override events */
  tier?: ReadinessTier;
  /** Territory / genre key when relevant */
  territoryKey?: string;
  severity?: 'skip' | 'territory_reject';
}

export interface ReadinessModelInputs {
  relationships: GenreRelationship[];
  history: ReadinessHistoryEvent[];
  /** Strong signal: user tap this session */
  explicitTier?: ReadinessTier | null;
  nowMs?: number;
  historyWindowDays?: number;
}

/**
 * Single source of truth for user readiness this session.
 * No other pipeline stage may invent a competing recommended tier.
 */
export interface ReadinessState {
  recommendedTier: ReadinessTier;
  /** Human-readable; product language; no em dashes */
  reasoning: string;
  greSummary?: string;
  rejectionPressure?: number;
  acceptPressure?: number;
  appetiteScore?: number;
  explicitOverride?: ReadinessTier | null;
  computedAt: string;
}

/** GRE internal stage → product territory language (reasoning only). */
export const GRE_STAGE_PRODUCT_LABEL: Record<string, string> = {
  UNTUCHED: 'Unexplored',
  INTRODUCED: 'Curious',
  EXPLORING: 'Exploring',
  GROWING: 'Growing',
  INTEGRATED: 'Resident',
  CORE_IDENTITY: 'Resident',
  REDISCOVER: 'Returning',
};
