/**
 * Typed frontier pipeline contracts.
 * Materialize and debug routes consume these — no process globals.
 */

import type { OrcaNode } from '@/lib/graph/types';
import type { RecommendationSurface } from '@/lib/ocse/ocse-types';
import type { ReadinessState } from '@/lib/readiness/readiness-types';

export interface LeapSeekMeta {
  targetedTerritories: string[];
}

/** Result of the full frontier stage runner (CUB → … → layout). */
export interface FrontierBuildResult {
  nodes: OrcaNode[];
  surface: RecommendationSurface | null;
  readiness: ReadinessState | null;
  leapSeekMeta: LeapSeekMeta;
  /** True if the recommendation run succeeded but serve-log persistence failed. */
  serveLogFailure?: boolean;
}

export interface BuildFrontierOptions {
  sliderValue?: number;
  skipOcse?: boolean;
  explicitTier?: 'comfort' | 'expansion' | 'leap' | null;
}
