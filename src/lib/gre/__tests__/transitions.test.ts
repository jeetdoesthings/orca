/**
 * Part 8 — GRE transition rules + OCSE Readiness stage wiring.
 */
import { describe, it, expect } from 'vitest';
import {
  applyGreTransition,
  proposeStageFromMetrics,
  normalizeGreState,
  daysSinceFromRecency,
} from '@/lib/gre/transitions';
import type { GenreRelationshipMetrics } from '@/lib/gre/gre-types';
import { computeReadiness } from '@/lib/ocse/decision-score';
import { GreConfig } from '@/lib/config/gre';

function m(partial: Partial<GenreRelationshipMetrics>): GenreRelationshipMetrics {
  return {
    familiarity: 0,
    diversity: 0,
    identity: 0,
    recency: 0,
    stability: 0.5,
    ...partial,
  };
}

describe('normalizeGreState', () => {
  it('maps legacy labels to GRE 7-state', () => {
    expect(normalizeGreState('UNEXPLORED')).toBe('UNTUCHED');
    expect(normalizeGreState('CURIOUS')).toBe('INTRODUCED');
    expect(normalizeGreState('STABILIZED')).toBe('CORE_IDENTITY');
    expect(normalizeGreState('DORMANT')).toBe('REDISCOVER');
  });
});

describe('transition chain', () => {
  it('UNTUCHED→INTRODUCED on first exposure', () => {
    const r = applyGreTransition({
      previous: 'UNTUCHED',
      metrics: m({ recency: 0.3, familiarity: 0.05 }),
    });
    expect(r.stage).toBe('INTRODUCED');
    expect(r.transitioned).toBe(true);
  });

  it('INTRODUCED→EXPLORING after N durable expansions', () => {
    const blocked = applyGreTransition({
      previous: 'INTRODUCED',
      metrics: m({ recency: 0.2, familiarity: 0.1 }),
      context: { durableExpansionCount: 0 },
    });
    expect(blocked.stage).toBe('INTRODUCED');

    const go = applyGreTransition({
      previous: 'INTRODUCED',
      metrics: m({ recency: 0.2, familiarity: 0.1 }),
      context: {
        durableExpansionCount: GreConfig.transitions.curiousToExploringDurableN,
      },
    });
    expect(go.stage).toBe('EXPLORING');
  });

  it('EXPLORING→GROWING on growing thresholds', () => {
    const th = GreConfig.stageCalibrationValues.growing;
    const r = applyGreTransition({
      previous: 'EXPLORING',
      metrics: m({
        recency: th.recency + 0.05,
        familiarity: th.familiarity + 0.05,
        stability: th.stability + 0.05,
      }),
    });
    expect(r.stage).toBe('GROWING');
  });

  it('GROWING→INTEGRATED on integrated thresholds', () => {
    const th = GreConfig.stageCalibrationValues.integrated;
    const r = applyGreTransition({
      previous: 'GROWING',
      metrics: m({
        familiarity: th.familiarity + 0.05,
        diversity: th.diversity + 0.05,
        identity: th.identity + 0.05,
        recency: th.recency + 0.05,
      }),
    });
    expect(r.stage).toBe('INTEGRATED');
  });

  it('INTEGRATED→CORE_IDENTITY with min dwell', () => {
    const th = GreConfig.stageCalibrationValues.core;
    const tooSoon = applyGreTransition({
      previous: 'INTEGRATED',
      metrics: m({
        familiarity: th.familiarity + 0.05,
        diversity: th.diversity + 0.05,
        identity: th.identity + 0.05,
        recency: th.recency + 0.05,
      }),
      context: { daysInCurrentStage: 1 },
    });
    expect(tooSoon.stage).toBe('INTEGRATED');

    const ready = applyGreTransition({
      previous: 'INTEGRATED',
      metrics: m({
        familiarity: th.familiarity + 0.05,
        diversity: th.diversity + 0.05,
        identity: th.identity + 0.05,
        recency: th.recency + 0.05,
      }),
      context: { daysInCurrentStage: GreConfig.transitions.minDaysBeforeCore },
    });
    expect(ready.stage).toBe('CORE_IDENTITY');
  });

  it('INTEGRATED→REDISCOVER on inactivity', () => {
    const r = applyGreTransition({
      previous: 'INTEGRATED',
      metrics: m({ familiarity: 0.6, recency: 0.01 }),
      context: {
        daysSinceLastEngagement: GreConfig.transitions.inactivityDaysToDormant + 5,
      },
    });
    expect(r.stage).toBe('REDISCOVER');
  });

  it('REDISCOVER→EXPLORING on renewed engagement', () => {
    const r = applyGreTransition({
      previous: 'REDISCOVER',
      metrics: m({
        familiarity: 0.5,
        recency: GreConfig.transitions.returningRecency + 0.1,
      }),
    });
    expect(r.stage).toBe('EXPLORING');
  });

  it('territory-wide reject forces REDISCOVER', () => {
    const r = applyGreTransition({
      previous: 'GROWING',
      metrics: m({ familiarity: 0.5, recency: 0.8 }),
      context: { territoryWideReject: true },
    });
    expect(r.stage).toBe('REDISCOVER');
  });

  it('cannot leap UNTUCHED→CORE_IDENTITY in one step', () => {
    const th = GreConfig.stageCalibrationValues.core;
    const r = applyGreTransition({
      previous: 'UNTUCHED',
      metrics: m({
        familiarity: th.familiarity + 0.1,
        diversity: th.diversity + 0.1,
        identity: th.identity + 0.1,
        recency: th.recency + 0.1,
      }),
    });
    expect(r.stage).toBe('INTRODUCED');
    expect(r.stage).not.toBe('CORE_IDENTITY');
  });
});

describe('OCSE Readiness uses GRE stage', () => {
  it('same territory: INTRODUCED readiness > CORE_IDENTITY readiness', () => {
    const a = computeReadiness({ territoryKey: 'house', greStage: 'INTRODUCED' });
    const b = computeReadiness({ territoryKey: 'house', greStage: 'CORE_IDENTITY' });
    expect(a).toBeGreaterThan(b);
  });
});

describe('proposeStageFromMetrics', () => {
  it('returns UNTUCHED for empty metrics', () => {
    expect(proposeStageFromMetrics(m({})).stage).toBe('UNTUCHED');
  });
});

describe('daysSinceFromRecency', () => {
  it('high recency → low days', () => {
    expect(daysSinceFromRecency(0.9)).toBeLessThan(daysSinceFromRecency(0.1));
  });
});
