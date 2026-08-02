/**
 * GRE state transition rules (Backend Fix Part 8).
 *
 * Vocabulary stays the live 7-state set (not the fix-plan 6-state diagram):
 *   UNTUCHED → INTRODUCED → EXPLORING → GROWING → INTEGRATED → CORE_IDENTITY
 *                                    ↘ REDISCOVER ↙
 *
 * Mapping fix-plan names: Unexplored=UNTUCHED, Curious=INTRODUCED,
 * Exploring=EXPLORING/GROWING, Resident=INTEGRATED/CORE_IDENTITY,
 * Dormant/Returning=REDISCOVER.
 *
 * Absolute metric proposal still exists; transitions gate jumps so we cannot
 * leap UNTUCHED → CORE_IDENTITY in one step without intermediate evidence.
 */

import { GreConfig } from '@/lib/config/gre';
import type { GenreRelationshipMetrics, GenreRelationshipState } from './gre-types';

/** Legacy / Layer-6-ish labels that may appear in older DB rows. */
const LEGACY_TO_GRE: Record<string, GenreRelationshipState> = {
  UNEXPLORED: 'UNTUCHED',
  CURIOUS: 'INTRODUCED',
  EXPLORING: 'EXPLORING',
  EMERGING: 'GROWING',
  RESIDENT: 'INTEGRATED',
  STABILIZED: 'CORE_IDENTITY',
  DORMANT: 'REDISCOVER',
  RETURNING: 'REDISCOVER',
  REJECTED: 'REDISCOVER',
  RESISTANT: 'REDISCOVER',
  UNTUCHED: 'UNTUCHED',
  INTRODUCED: 'INTRODUCED',
  GROWING: 'GROWING',
  INTEGRATED: 'INTEGRATED',
  CORE_IDENTITY: 'CORE_IDENTITY',
  REDISCOVER: 'REDISCOVER',
};

export function normalizeGreState(
  raw: string | null | undefined,
): GenreRelationshipState {
  if (!raw) return 'UNTUCHED';
  return LEGACY_TO_GRE[raw] ?? LEGACY_TO_GRE[raw.toUpperCase()] ?? 'UNTUCHED';
}

/**
 * Propose target stage from metrics alone (calibration thresholds).
 * Used as the "desired" state before transition gating.
 */
export function proposeStageFromMetrics(
  metrics: GenreRelationshipMetrics,
): { stage: GenreRelationshipState; reason: string } {
  const th = GreConfig.stageCalibrationValues;
  const { familiarity, diversity, identity, recency, stability } = metrics;

  if (
    familiarity > th.core.familiarity &&
    diversity > th.core.diversity &&
    identity > th.core.identity &&
    recency > th.core.recency
  ) {
    return {
      stage: 'CORE_IDENTITY',
      reason: 'High familiarity, diversity, identity, and recency.',
    };
  }
  if (
    familiarity > th.integrated.familiarity &&
    diversity > th.integrated.diversity &&
    identity > th.integrated.identity &&
    recency > th.integrated.recency
  ) {
    return {
      stage: 'INTEGRATED',
      reason: 'Established familiarity and identity anchoring.',
    };
  }
  if (
    recency > th.growing.recency &&
    familiarity > th.growing.familiarity &&
    stability > th.growing.stability
  ) {
    return {
      stage: 'GROWING',
      reason: 'High recency and stability with rising familiarity.',
    };
  }
  if (
    recency > th.exploring.recency &&
    diversity > th.exploring.diversity &&
    familiarity <= th.exploring.familiarityLimit
  ) {
    return {
      stage: 'EXPLORING',
      reason: 'Active trial with diversity despite modest familiarity.',
    };
  }
  if (
    familiarity > th.rediscover.familiarity &&
    recency <= th.rediscover.recencyLimit
  ) {
    return {
      stage: 'REDISCOVER',
      reason: 'Prior familiarity but dormant recency.',
    };
  }
  if (
    familiarity > th.introduced.familiarityLimit ||
    recency > th.introduced.recencyLimit
  ) {
    return {
      stage: 'INTRODUCED',
      reason: 'First exposure / early relationship signals.',
    };
  }
  return {
    stage: 'UNTUCHED',
    reason: 'No meaningful listening history.',
  };
}

/** Ordered progression rank (higher = more established). REDISCOVER is special. */
const PROGRESS_RANK: Record<GenreRelationshipState, number> = {
  UNTUCHED: 0,
  INTRODUCED: 1,
  EXPLORING: 2,
  GROWING: 3,
  INTEGRATED: 4,
  CORE_IDENTITY: 5,
  REDISCOVER: -1,
};

export interface TransitionContext {
  /** Count of durable (TES-positive) expansions in this territory in rolling window. */
  durableExpansionCount?: number;
  /** Part 11: territory-wide reject pushes toward REDISCOVER faster. */
  territoryWideReject?: boolean;
  /** Days since last engagement in territory (from recency if not provided). */
  daysSinceLastEngagement?: number;
  /** Days already spent in previous stage (hysteresis / min dwell). */
  daysInCurrentStage?: number;
}

export interface TransitionResult {
  stage: GenreRelationshipState;
  previous: GenreRelationshipState;
  reason: string;
  transitioned: boolean;
}

/**
 * Apply explicit transition rules from previous stage + proposed metrics target.
 */
export function applyGreTransition(opts: {
  previous: GenreRelationshipState | string | null;
  metrics: GenreRelationshipMetrics;
  context?: TransitionContext;
}): TransitionResult {
  const tr = GreConfig.transitions;
  const previous = normalizeGreState(
    typeof opts.previous === 'string' || opts.previous == null
      ? opts.previous
      : opts.previous,
  );
  const proposed = proposeStageFromMetrics(opts.metrics);
  const ctx = opts.context ?? {};
  const durable = ctx.durableExpansionCount ?? 0;
  const daysIn = ctx.daysInCurrentStage ?? 0;

  // Infer inactivity days from recency if not provided
  let daysSince = ctx.daysSinceLastEngagement;
  if (daysSince == null) {
    const r = Math.max(1e-6, Math.min(1, opts.metrics.recency));
    // recency ≈ exp(-days / halfLife) → days ≈ -halfLife * ln(recency)
    daysSince = -GreConfig.recencyHalfLifeDays * Math.log(r);
    if (opts.metrics.recency <= 0) daysSince = 999;
  }

  // Territory-wide reject: force toward REDISCOVER from any established state
  if (ctx.territoryWideReject && previous !== 'UNTUCHED') {
    return {
      stage: 'REDISCOVER',
      previous,
      reason: 'Territory-wide reject → REDISCOVER (faster than passive inactivity).',
      transitioned: previous !== 'REDISCOVER',
    };
  }

  // ── From UNTUCHED ──
  if (previous === 'UNTUCHED') {
    // First exposure: any signal or proposed beyond untouched
    if (
      proposed.stage !== 'UNTUCHED' ||
      opts.metrics.familiarity > 0 ||
      opts.metrics.recency > tr.firstExposureRecency
    ) {
      return {
        stage: 'INTRODUCED',
        previous,
        reason: 'UNTUCHED→INTRODUCED: first exposure to territory.',
        transitioned: true,
      };
    }
    return {
      stage: 'UNTUCHED',
      previous,
      reason: proposed.reason,
      transitioned: false,
    };
  }

  // ── From INTRODUCED (Curious) ──
  if (previous === 'INTRODUCED') {
    const exploreReady =
      durable >= tr.curiousToExploringDurableN ||
      proposed.stage === 'EXPLORING' ||
      proposed.stage === 'GROWING' ||
      PROGRESS_RANK[proposed.stage] >= PROGRESS_RANK.EXPLORING;
    if (exploreReady) {
      // One step at a time: INTRODUCED only advances to EXPLORING (not INTEGRATED).
      return {
        stage: 'EXPLORING',
        previous,
        reason: `INTRODUCED→EXPLORING: durable expansions≥${tr.curiousToExploringDurableN} or explore metrics.`,
        transitioned: true,
      };
    }
    if (
      daysSince >= tr.inactivityDaysToDormant &&
      opts.metrics.familiarity > tr.rediscover.familiarityFloor
    ) {
      return {
        stage: 'REDISCOVER',
        previous,
        reason: 'INTRODUCED→REDISCOVER: inactivity after early exposure.',
        transitioned: true,
      };
    }
    return stay(previous, proposed.reason);
  }

  // ── From EXPLORING ──
  if (previous === 'EXPLORING') {
    if (
      opts.metrics.recency > GreConfig.stageCalibrationValues.growing.recency &&
      opts.metrics.familiarity > GreConfig.stageCalibrationValues.growing.familiarity &&
      opts.metrics.stability > GreConfig.stageCalibrationValues.growing.stability
    ) {
      return {
        stage: 'GROWING',
        previous,
        reason: 'EXPLORING→GROWING: recency + familiarity + stability thresholds.',
        transitioned: true,
      };
    }
    if (daysSince >= tr.inactivityDaysToDormant) {
      return {
        stage: 'REDISCOVER',
        previous,
        reason: 'EXPLORING→REDISCOVER: inactivity window.',
        transitioned: true,
      };
    }
    return stay(previous, proposed.reason);
  }

  // ── From GROWING ──
  if (previous === 'GROWING') {
    if (
      opts.metrics.familiarity > GreConfig.stageCalibrationValues.integrated.familiarity &&
      opts.metrics.identity > GreConfig.stageCalibrationValues.integrated.identity &&
      opts.metrics.recency > GreConfig.stageCalibrationValues.integrated.recency
    ) {
      return {
        stage: 'INTEGRATED',
        previous,
        reason: 'GROWING→INTEGRATED: territory meaningfully anchors identity (centroid shift proxy = identity metric).',
        transitioned: true,
      };
    }
    if (daysSince >= tr.inactivityDaysToDormant) {
      return {
        stage: 'REDISCOVER',
        previous,
        reason: 'GROWING→REDISCOVER: inactivity window.',
        transitioned: true,
      };
    }
    return stay(previous, proposed.reason);
  }

  // ── From INTEGRATED ──
  if (previous === 'INTEGRATED') {
    if (
      opts.metrics.familiarity > GreConfig.stageCalibrationValues.core.familiarity &&
      opts.metrics.diversity > GreConfig.stageCalibrationValues.core.diversity &&
      opts.metrics.identity > GreConfig.stageCalibrationValues.core.identity &&
      opts.metrics.recency > GreConfig.stageCalibrationValues.core.recency &&
      daysIn >= tr.minDaysBeforeCore
    ) {
      return {
        stage: 'CORE_IDENTITY',
        previous,
        reason: 'INTEGRATED→CORE_IDENTITY: core thresholds + min dwell.',
        transitioned: true,
      };
    }
    if (daysSince >= tr.inactivityDaysToDormant) {
      return {
        stage: 'REDISCOVER',
        previous,
        reason: 'INTEGRATED→REDISCOVER: inactivity (Resident→Dormant).',
        transitioned: true,
      };
    }
    return stay(previous, proposed.reason);
  }

  // ── From CORE_IDENTITY ──
  if (previous === 'CORE_IDENTITY') {
    if (daysSince >= tr.inactivityDaysToDormant) {
      return {
        stage: 'REDISCOVER',
        previous,
        reason: 'CORE_IDENTITY→REDISCOVER: inactivity (Resident→Dormant).',
        transitioned: true,
      };
    }
    // Stay core if metrics still hot; no demotion to INTEGRATED without inactivity
    return stay(previous, proposed.reason);
  }

  // ── From REDISCOVER (Dormant / Returning) ──
  if (previous === 'REDISCOVER') {
    if (
      opts.metrics.recency > tr.returningRecency ||
      opts.metrics.familiarity > GreConfig.stageCalibrationValues.rediscover.familiarity
    ) {
      // Renewed engagement → back to EXPLORING (returning path)
      return {
        stage: 'EXPLORING',
        previous,
        reason: 'REDISCOVER→EXPLORING: renewed engagement (Returning).',
        transitioned: true,
      };
    }
    return stay(previous, proposed.reason);
  }

  return stay(previous, proposed.reason);
}

function stay(
  previous: GenreRelationshipState,
  reason: string,
): TransitionResult {
  return {
    stage: previous,
    previous,
    reason: `Hold ${previous}: ${reason}`,
    transitioned: false,
  };
}

/**
 * Estimate days since last engagement from recency metric.
 * Exported for tests / OCSE.
 */
export function daysSinceFromRecency(recency: number): number {
  if (recency <= 0) return 999;
  return -GreConfig.recencyHalfLifeDays * Math.log(Math.min(1, Math.max(1e-6, recency)));
}
