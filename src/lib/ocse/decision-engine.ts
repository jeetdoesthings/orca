import { normaliseGenre } from '@/lib/graph/genre-normaliser';
import { OcseConfig } from '../config/ocse';
import type { Candidate } from '@/lib/candidate/cub-types';
import type { DecisionProfile, OCSEContext } from './ocse-types';
import {
  computeBatchDiversity,
  computeDecisionScore,
  computeReadiness,
  confidenceFromTag,
  tesProxyFromCandidate,
} from './decision-score';

/**
 * Evaluates a single candidate across legacy dimensions + Part 7 components.
 * Batch diversity is applied in evaluateCandidateUniverse (session-level).
 */
export function evaluateCandidate(
  candidate: Candidate,
  context: OCSEContext,
  opts?: { batchDiversity?: number },
): DecisionProfile {
  const normGenre =
    candidate.genres && candidate.genres.length > 0
      ? normaliseGenre([candidate.genres[0]])
      : '';

  const rel = context.relationships.find((r) => r.genre === normGenre);
  const stage = rel?.stage || 'UNTUCHED';

  const cfg = OcseConfig;

  // ── Dimension 1: Relationship Support ──
  const relationshipSupport =
    cfg.relationshipSupportByStage[stage] ?? cfg.relationshipSupportByStage.DEFAULT;

  // ── Dimension 2: Growth contribution (P1-6) ──
  const diversity = rel?.metrics.diversity ?? 0.0;
  const growthContribution = computeGrowthContribution(
    candidate.artistId,
    diversity,
    context.currentVisibleWorldIds,
    cfg,
  );

  const familiarity = rel?.metrics.familiarity ?? 0.0;
  const noveltyContribution = Math.round((1.0 - familiarity) * 100) / 100;

  // ── Dimension 4: Discovery Quality ──
  const discoveryConfidence = candidate.discoveryConfidence;

  // ── Dimension 5: Timing ──
  const momentum = rel?.metrics.stability ?? 0.5;
  const recency = rel?.metrics.recency ?? 0.5;
  const timingContribution = Math.round(((momentum + recency) / 2) * 100) / 100;

  // ── Dimension 6: Cooldown ──
  let cooldownMultiplier = 1.0;
  const history = context.interactionHistory;
  const id = candidate.artistId;

  if (history.timesIntegrated[id] > 0) {
    cooldownMultiplier = 0.0;
  } else {
    if (history.timesIgnored[id] > 0) {
      cooldownMultiplier *= Math.pow(
        cfg.cooldownPenalties.ignoredMultiplier,
        history.timesIgnored[id],
      );
    }
    if (history.timesDismissed[id] > 0) {
      cooldownMultiplier *= Math.pow(
        cfg.cooldownPenalties.dismissedMultiplier,
        history.timesDismissed[id],
      );
    }

    const lastShownStr = history.lastShown[id];
    if (lastShownStr) {
      const hoursSinceLast =
        (Date.now() - new Date(lastShownStr).getTime()) / (1000 * 60 * 60);
      if (hoursSinceLast < cfg.cooldownPenalties.recentShownLimitHours) {
        cooldownMultiplier *= cfg.cooldownPenalties.recentShownPenalty;
      } else if (hoursSinceLast < cfg.cooldownPenalties.extendedShownLimitHours) {
        cooldownMultiplier *= cfg.cooldownPenalties.extendedShownPenalty;
      }
    }
  }
  cooldownMultiplier = Math.round(cooldownMultiplier * 100) / 100;

  const slider = context.sliderValue;
  const sliderCompatibility =
    Math.round((1.0 - Math.abs(noveltyContribution - slider)) * 100) / 100;

  // ── Legacy additive blend (inspectable; not final rank) ──
  const weights = cfg.dimensionWeights;
  const legacyBlend =
    relationshipSupport * weights.relationshipSupport +
    growthContribution * weights.growthContribution +
    noveltyContribution * weights.noveltyContribution +
    discoveryConfidence * weights.discoveryConfidence +
    timingContribution * weights.timingContribution +
    sliderCompatibility * weights.sliderCompatibility;

  // ── Part 7: DecisionScore components ──
  // RULE-10: expansionDistance read only — never fabricated.
  const tesProxy = tesProxyFromCandidate({
    expansionDistance: candidate.expansionDistance,
    noveltyContribution,
  });

  const readiness = computeReadiness({
    territoryKey: normGenre || 'unknown',
    rejections: history.territoryRejections ?? [],
    greStage: stage,
  });

  const batchDiversity =
    opts?.batchDiversity ?? OcseConfig.diversity.singletonDefault;

  const tag = candidate.confidenceTag ?? candidate.audioSource;
  const dataConfidence = confidenceFromTag(tag);

  const { decisionScore, components } = computeDecisionScore({
    tes: tesProxy,
    readiness,
    diversity: batchDiversity,
    confidence: dataConfidence,
    cooldownMultiplier,
  });

  // Final score for pipeline = Part 7 DecisionScore (cooldown applied).
  // When cooldown is 0, geo-mean path yields 0 — same fail-closed as legacy.
  const decisionConfidence = decisionScore;

  // ── Decision Reasons ──
  const decisionReasons: string[] = [];
  if (decisionConfidence > cfg.thresholds.highQuality) {
    decisionReasons.push('HIGH_DISCOVERY_QUALITY');
  }
  if (relationshipSupport > cfg.thresholds.supportsGrowth) {
    decisionReasons.push('SUPPORTS_GROWTH');
  }
  if (noveltyContribution > cfg.thresholds.expandTaste) {
    decisionReasons.push('EXPAND_TASTE');
  }
  if (timingContribution > cfg.thresholds.goodTiming) {
    decisionReasons.push('GOOD_TIMING');
  }
  if (stage === 'REDISCOVER') {
    decisionReasons.push('REDISCOVER');
  }
  if (dataConfidence >= 0.9) {
    decisionReasons.push('HIGH_METADATA_CONFIDENCE');
  }
  if (decisionReasons.length === 0) {
    decisionReasons.push('REINFORCE_IDENTITY');
  }

  // ── Explanation Generation ──
  const explanation: string[] = [];
  explanation.push(
    `Candidate ${candidate.name} belongs to ${normGenre} which is in stage: ${stage}.`,
  );
  explanation.push(
    `DecisionScore geo-mean: tes=${components.tes.toFixed(2)} readiness=${components.readiness.toFixed(2)} diversity=${components.diversity.toFixed(2)} confidence=${components.confidence.toFixed(2)} (legacyBlend=${legacyBlend.toFixed(2)}).`,
  );
  if (slider > 0.7) {
    explanation.push(
      `Your taste expansion slider encourages high exploration (setting: ${Math.round(slider * 100)}%).`,
    );
  } else if (slider < 0.3) {
    explanation.push(
      `Your taste expansion slider encourages high comfort (setting: ${Math.round(slider * 100)}%).`,
    );
  } else {
    explanation.push(
      `Your taste expansion slider is balanced (setting: ${Math.round(slider * 100)}%).`,
    );
  }
  if (cooldownMultiplier < 0.5) {
    explanation.push(
      `Artist visibility is penalized by active cooldown (cooldown multiplier: ${cooldownMultiplier}).`,
    );
  }

  // Phase 2 P0-1: OCSE pure reader of expansionDistance (RULE-10).

  return {
    candidateId: candidate.artistId,
    relationshipSupport,
    growthContribution,
    noveltyContribution,
    timingContribution,
    sliderCompatibility,
    cooldownMultiplier,
    discoveryConfidence,
    decisionConfidence,
    decisionScore,
    tesProxy: components.tes,
    readiness: components.readiness,
    batchDiversity: components.diversity,
    dataConfidence: components.confidence,
    expansionDistance: candidate.expansionDistance,
    audioSource: candidate.audioSource,
    confidenceTag: candidate.confidenceTag,
    decisionReasons,
    explanation,
  };
}

/**
 * P1-6: growthContribution from visible-world membership + GRE diversity.
 * Pure function — exported for unit tests.
 */
export function computeGrowthContribution(
  candidateId: string,
  genreDiversity: number,
  currentVisibleWorldIds: string[],
  cfg: typeof OcseConfig = OcseConfig,
): number {
  const g = cfg.growthContribution;
  const visible = currentVisibleWorldIds ?? [];

  if (visible.includes(candidateId)) {
    return g.alreadyVisible;
  }
  if (visible.length === 0) {
    return g.emptyWorld;
  }

  const diversity = Math.min(1, Math.max(0, genreDiversity));
  const inverseDiversity = 1.0 - diversity;
  const blended =
    inverseDiversity * g.diversityWeight + g.baseNew * (1 - g.diversityWeight);
  return Math.round(Math.min(1, Math.max(0, blended)) * 100) / 100;
}

/**
 * Main OCSE entry: evaluate universe with batch-level Diversity (Part 7).
 */
export function evaluateCandidateUniverse(
  candidates: Candidate[],
  context: OCSEContext,
): DecisionProfile[] {
  console.log(`[OCSE] Evaluating candidate universe of size: ${candidates.length}`);

  const primaryGenres = candidates.map((c) =>
    c.genres && c.genres.length > 0 ? c.genres[0] : 'unknown',
  );
  const batchDiversity = computeBatchDiversity(primaryGenres);

  return candidates.map((c) =>
    evaluateCandidate(c, context, { batchDiversity }),
  );
}
