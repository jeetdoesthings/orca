/**
 * OCSE DecisionScore components (Backend Fix Part 7).
 *
 * DecisionScore = weighted geometric mean of:
 *   TES proxy | Readiness | batch Diversity | data Confidence
 *
 * Geometric mean keeps "all factors must be present" without crushing scores
 * toward zero as hard as raw product of many [0,1] terms.
 *
 * OCSE remains pure reader of expansionDistance (RULE-10 / INV-5).
 */

import { OcseConfig } from '@/lib/config/ocse';
import { CONFIDENCE_TAG_WEIGHT, normalizeConfidenceTag } from '@/lib/audio/confidence-tags';
import { getDefaultTerritoryGraph, minTerritorySceneDistance } from '@/lib/territory-graph';
import { normaliseGenre } from '@/lib/graph/genre-normaliser';

export interface TerritoryRejection {
  /** Genre / territory direction key */
  territoryKey: string;
  /** ISO timestamp or Date */
  at: Date | string;
  /** ordinary skip vs territory-wide (Part 11) — sharper drop for territory-wide */
  severity?: 'skip' | 'territory_reject';
}

/** Floor so geo-mean never hits hard zero from a single missing factor. */
const GEO_EPS = 1e-3;

/**
 * Weighted geometric mean: exp(Σ w_i ln(v_i) / Σ w_i).
 * Values clamped to (GEO_EPS, 1].
 */
export function weightedGeometricMean(
  parts: Array<{ value: number; weight: number }>,
): number {
  const usable = parts.filter((p) => p.weight > 0);
  if (usable.length === 0) return 0;
  let logSum = 0;
  let wSum = 0;
  for (const p of usable) {
    const v = Math.max(GEO_EPS, Math.min(1, Number.isFinite(p.value) ? p.value : GEO_EPS));
    logSum += p.weight * Math.log(v);
    wSum += p.weight;
  }
  if (wSum <= 0) return 0;
  return Math.exp(logSum / wSum);
}

/**
 * Map metadata-completeness confidence tags → Confidence term.
 * high_confidence > partial_confidence > low_confidence
 * (legacy real_audio / tag_inferred / cold_start_default normalize into these)
 */
export function confidenceFromTag(
  tag: string | null | undefined,
): number {
  const t = normalizeConfidenceTag(tag);
  return CONFIDENCE_TAG_WEIGHT[t];
}

/**
 * Readiness: exponential recovery after rejections in a territory-direction.
 * Half-life configurable (default days). Territory-wide rejects hit harder.
 * GRE stage multiplies base readiness (Curious/Introduced gentler exposure).
 */
export function computeReadiness(opts: {
  territoryKey: string;
  rejections?: TerritoryRejection[];
  greStage?: string;
  nowMs?: number;
  halfLifeDays?: number;
}): number {
  const cfg = OcseConfig.readiness;
  const now = opts.nowMs ?? Date.now();
  const halfLife = opts.halfLifeDays ?? cfg.halfLifeDays;
  const stageKey = opts.greStage ?? 'UNTUCHED';
  const stageMul =
    cfg.stageMultiplier[stageKey] ?? cfg.stageMultiplier.DEFAULT ?? 1.0;

  let penalty = 0;
  for (const r of opts.rejections ?? []) {
    if (r.territoryKey !== opts.territoryKey) continue;
    const at = typeof r.at === 'string' ? new Date(r.at).getTime() : r.at.getTime();
    const days = Math.max(0, (now - at) / (1000 * 60 * 60 * 24));
    const decay = Math.exp(-days / Math.max(0.01, halfLife));
    const weight =
      r.severity === 'territory_reject'
        ? cfg.territoryRejectWeight
        : cfg.skipRejectWeight;
    penalty += weight * decay;
  }

  // readiness = stage base * exp(-penalty)
  const raw = stageMul * Math.exp(-penalty);
  return Math.round(Math.min(1, Math.max(0, raw)) * 1000) / 1000;
}

/**
 * Batch-level Diversity: mean pairwise territory/scene distance among batch
 * primary genres. Clustered batch → low; spread batch → high.
 */
export function computeBatchDiversity(
  primaryGenres: string[],
): number {
  const genres = primaryGenres
    .map((g) => {
      try {
        return normaliseGenre([g]);
      } catch {
        return g.toLowerCase();
      }
    })
    .filter(Boolean);

  if (genres.length <= 1) return OcseConfig.diversity.singletonDefault;

  try {
    const graph = getDefaultTerritoryGraph();
    let sum = 0;
    let n = 0;
    for (let i = 0; i < genres.length; i++) {
      for (let j = i + 1; j < genres.length; j++) {
        sum += minTerritorySceneDistance(graph, [genres[i]], [genres[j]]);
        n++;
      }
    }
    if (n === 0) return OcseConfig.diversity.singletonDefault;
    return Math.round(Math.min(1, Math.max(0, sum / n)) * 1000) / 1000;
  } catch {
    // Fallback: unique genre ratio
    const unique = new Set(genres).size;
    return Math.round(Math.min(1, (unique - 1) / Math.max(1, genres.length - 1)) * 1000) / 1000;
  }
}

/**
 * Live TES proxy for ranking (immutable TES snapshot is outcome metric).
 * Prefer expansionDistance (EI foreignness leap); fall back to novelty.
 * Pure reader — does not recompute expansionDistance.
 */
export function tesProxyFromCandidate(opts: {
  expansionDistance?: number;
  noveltyContribution: number;
}): number {
  if (
    opts.expansionDistance != null &&
    Number.isFinite(opts.expansionDistance)
  ) {
    return Math.min(1, Math.max(0, opts.expansionDistance));
  }
  return Math.min(1, Math.max(0, opts.noveltyContribution));
}

/**
 * Full DecisionScore from four components + optional cooldown.
 */
export function computeDecisionScore(opts: {
  tes: number;
  readiness: number;
  diversity: number;
  confidence: number;
  cooldownMultiplier?: number;
}): {
  decisionScore: number;
  components: {
    tes: number;
    readiness: number;
    diversity: number;
    confidence: number;
  };
} {
  const w = OcseConfig.decisionScoreWeights;
  const geo = weightedGeometricMean([
    { value: opts.tes, weight: w.tes },
    { value: opts.readiness, weight: w.readiness },
    { value: opts.diversity, weight: w.diversity },
    { value: opts.confidence, weight: w.confidence },
  ]);
  const cd = opts.cooldownMultiplier ?? 1;
  const decisionScore =
    Math.round(Math.min(1, Math.max(0, geo * cd)) * 100) / 100;
  return {
    decisionScore,
    components: {
      tes: opts.tes,
      readiness: opts.readiness,
      diversity: opts.diversity,
      confidence: opts.confidence,
    },
  };
}
