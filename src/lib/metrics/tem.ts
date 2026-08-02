import { PrismaClient } from '@prisma/client';
import { AGENCY_V0_WEIGHTS } from '@/lib/config/agency';

const prisma = new PrismaClient();

export interface TEMConfig {
  evaluationWindowDays: number; // e.g., 90
  baselineWindowDays: number; // e.g., 180
  adoptionThresholdMinutes: number; // e.g., 60
  adoptionThresholdSessions: number; // e.g., 3
  durabilityWindows: number; // e.g., 9
  /** Part 5: defaults to Agency v0 prior; override only with reviewed weights. */
  agencyWeights: Record<string, number>;
}

export const DEFAULT_TEM_CONFIG: TEMConfig = {
  evaluationWindowDays: 90,
  baselineWindowDays: 180,
  adoptionThresholdMinutes: 60,
  adoptionThresholdSessions: 3,
  durabilityWindows: 9, // 10 days each if 90 days total
  // Part 5: v0 prior — recalibration drafts never auto-replace this
  agencyWeights: { ...AGENCY_V0_WEIGHTS },
};

export interface TEMResult {
  score: number;
  adoptedTerritories: number;
  foreignness: number;
  durability: number;
  agency: number;
  meaningfulness: number;
  contributingTerritories: any[];
  evaluationWindow: number;
  confidence: number;
  version: string;
}

/**
 * Taste Expansion Metric (TEM) — retrospective outcome score.
 *
 * NOT used for live candidate ranking (that is Expansion Intelligence distance
 * + OCSE). TEM measures whether genuine expansion stuck after the fact.
 * Spec "TES" ≈ territory score F×D×A×M; composite TEM is exp-normalized sum.
 *
 * Multiplicative on purpose: foreign AND durable AND agentic AND meaningful.
 * Autoplay-only paths cannot mint high TEM even if F is high.
 */

export interface TemListenEvent {
  artistId: string;
  territoryId?: string | null;
  timestamp: Date;
  eventType?: string | null;
  initiationType?: string | null;
  durationMs?: number | null;
  sessionId?: string | null;
}

/**
 * Normalizes a sum exponentially into a [0, 1] range.
 */
export function exponentialNormalize(value: number, scale: number = 0.5): number {
  return 1.0 - Math.exp(-value * scale);
}

/** Territory-level foreignness from baseline exposure (0 = familiar, 1 = new). */
export function computeForeignness(
  baselineEvents: TemListenEvent[],
  evalStartMs: number,
): number {
  if (baselineEvents.length === 0) return 1.0;
  const exposureCount = baselineEvents.length;
  const exposurePenalty = Math.min(1.0, exposureCount / 50.0);
  const lastBaselineEvent = baselineEvents[baselineEvents.length - 1];
  const daysSinceLastExposure =
    (evalStartMs - lastBaselineEvent.timestamp.getTime()) / (24 * 60 * 60 * 1000);
  const recencyPenalty = Math.max(0.0, 1.0 - daysSinceLastExposure / 180);
  return Math.max(0.0, 1.0 - (exposurePenalty * 0.7 + recencyPenalty * 0.3));
}

/** Later windows weigh more; AUTOPLAY / SKIP excluded. */
export function computeDurability(
  evalEvents: TemListenEvent[],
  evalStartMs: number,
  config: TEMConfig = DEFAULT_TEM_CONFIG,
): number {
  const windowDurationMs =
    (config.evaluationWindowDays * 24 * 60 * 60 * 1000) / config.durabilityWindows;
  const windowCounts = new Array(config.durabilityWindows).fill(0);

  for (const e of evalEvents) {
    const msIntoEval = e.timestamp.getTime() - evalStartMs;
    const windowIndex = Math.min(
      config.durabilityWindows - 1,
      Math.floor(msIntoEval / windowDurationMs),
    );
    if (e.initiationType !== 'AUTOPLAY' && e.eventType !== 'SKIP') {
      windowCounts[windowIndex]++;
    }
  }

  let durabilityScore = 0;
  let maxPossibleDurability = 0;
  for (let i = 0; i < config.durabilityWindows; i++) {
    const weight = Math.pow(1.2, i);
    maxPossibleDurability += weight;
    if (windowCounts[i] > 0) {
      const windowIntensity = Math.min(1.0, Math.log10(1 + windowCounts[i]) / Math.log10(10));
      durabilityScore += weight * windowIntensity;
    }
  }
  return maxPossibleDurability > 0 ? durabilityScore / maxPossibleDurability : 0;
}

/** Active choice weights; SKIP excluded; AUTOPLAY low. */
export function computeAgency(
  evalEvents: TemListenEvent[],
  config: TEMConfig = DEFAULT_TEM_CONFIG,
): number {
  let agencyScoreTotal = 0;
  let validEvents = 0;
  for (const e of evalEvents) {
    if (e.eventType === 'SKIP') continue;
    const weight =
      config.agencyWeights[e.initiationType || ''] ??
      config.agencyWeights[e.eventType || ''] ??
      0.5;
    agencyScoreTotal += weight;
    validEvents++;
  }
  return validEvents > 0 ? agencyScoreTotal / validEvents : 0;
}

export function computeMeaningfulness(evalEvents: TemListenEvent[]): number {
  let meaningfulnessScore = 0;
  const exploredArtists = new Set<string>();

  for (const e of evalEvents) {
    exploredArtists.add(e.artistId);
    if (e.eventType === 'SAVE' || e.initiationType === 'LIBRARY_SAVE') {
      meaningfulnessScore += 0.2;
    }
    if (e.eventType === 'PLAYLIST_ADD' || e.initiationType === 'PLAYLIST_CREATED') {
      meaningfulnessScore += 0.3;
    }
    if (e.initiationType === 'ARTIST_PAGE') {
      meaningfulnessScore += 0.15;
    }
  }

  if (exploredArtists.size >= 3) meaningfulnessScore += 0.3;
  else if (exploredArtists.size === 2) meaningfulnessScore += 0.15;

  if (evalEvents.length > 1) {
    const firstEvalMs = evalEvents[0].timestamp.getTime();
    const lastEvalMs = evalEvents[evalEvents.length - 1].timestamp.getTime();
    const spanWeeks = (lastEvalMs - firstEvalMs) / (7 * 24 * 60 * 60 * 1000);
    if (spanWeeks > 3) meaningfulnessScore += 0.2;
  }

  return Math.min(1.0, meaningfulnessScore);
}

/** Spec TES-style composite (plus meaningfulness). Multiplicative, never additive. */
export function territoryExpansionScore(
  foreignness: number,
  durability: number,
  agency: number,
  meaningfulness: number,
): number {
  return foreignness * durability * agency * meaningfulness;
}

/**
 * Pure TEM aggregation over in-memory events (no DB).
 * Used by calculateTEM and unit tests.
 */
export function calculateTEMFromEvents(
  events: TemListenEvent[],
  evaluationEndDate: Date,
  config: TEMConfig = DEFAULT_TEM_CONFIG,
): TEMResult {
  const evalEnd = evaluationEndDate.getTime();
  const evalStart = evalEnd - config.evaluationWindowDays * 24 * 60 * 60 * 1000;

  if (events.length === 0) {
    return {
      score: 0.0,
      adoptedTerritories: 0,
      foreignness: 0,
      durability: 0,
      agency: 0,
      meaningfulness: 0,
      contributingTerritories: [],
      evaluationWindow: config.evaluationWindowDays,
      confidence: 0,
      version: '2.0',
    };
  }

  const territoryEvents = new Map<string, TemListenEvent[]>();
  for (const event of events) {
    if (!event.territoryId) continue;
    if (!territoryEvents.has(event.territoryId)) {
      territoryEvents.set(event.territoryId, []);
    }
    territoryEvents.get(event.territoryId)!.push(event);
  }

  const contributingTerritories: TEMResult['contributingTerritories'] = [];
  let sumForeignness = 0;
  let sumDurability = 0;
  let sumAgency = 0;
  let sumMeaningfulness = 0;
  let adoptedCount = 0;
  let totalScoreSum = 0;

  for (const [territoryId, tEvents] of territoryEvents.entries()) {
    const baselineEvents = tEvents.filter((e) => e.timestamp.getTime() < evalStart);
    const evalEvents = tEvents.filter((e) => e.timestamp.getTime() >= evalStart);

    let evalDurationMinutes = 0;
    const sessionIds = new Set<string>();
    for (const e of evalEvents) {
      if (e.durationMs) {
        evalDurationMinutes += e.durationMs / 60000;
      } else if (e.eventType === 'COMPLETE') {
        evalDurationMinutes += 3;
      } else if (e.eventType === 'PLAY') {
        evalDurationMinutes += 1.5;
      }
      const sessionId =
        e.sessionId || `sim-sess-${Math.floor(e.timestamp.getTime() / (60 * 60 * 1000))}`;
      sessionIds.add(sessionId);
    }

    if (
      evalDurationMinutes < config.adoptionThresholdMinutes ||
      sessionIds.size < config.adoptionThresholdSessions
    ) {
      continue;
    }

    const foreignness = computeForeignness(baselineEvents, evalStart);
    const durability = computeDurability(evalEvents, evalStart, config);
    const agency = computeAgency(evalEvents, config);
    const meaningfulness = computeMeaningfulness(evalEvents);
    const score = territoryExpansionScore(foreignness, durability, agency, meaningfulness);

    if (score > 0) {
      adoptedCount++;
      sumForeignness += foreignness;
      sumDurability += durability;
      sumAgency += agency;
      sumMeaningfulness += meaningfulness;
      totalScoreSum += score;
      contributingTerritories.push({
        territoryId,
        foreignness,
        durability,
        agency,
        meaningfulness,
        contribution: score,
      });
    }
  }

  const finalTEM = exponentialNormalize(totalScoreSum, 0.5);

  return {
    score: finalTEM,
    adoptedTerritories: adoptedCount,
    foreignness: adoptedCount > 0 ? sumForeignness / adoptedCount : 0,
    durability: adoptedCount > 0 ? sumDurability / adoptedCount : 0,
    agency: adoptedCount > 0 ? sumAgency / adoptedCount : 0,
    meaningfulness: adoptedCount > 0 ? sumMeaningfulness / adoptedCount : 0,
    contributingTerritories,
    evaluationWindow: config.evaluationWindowDays,
    confidence: Math.min(1.0, events.length / 500),
    version: '2.0',
  };
}

export async function calculateTEM(
  userId: string,
  evaluationEndDate: Date,
  config: TEMConfig = DEFAULT_TEM_CONFIG,
): Promise<TEMResult> {
  const evalEnd = evaluationEndDate.getTime();
  const evalStart = evalEnd - config.evaluationWindowDays * 24 * 60 * 60 * 1000;
  const baselineStart = evalStart - config.baselineWindowDays * 24 * 60 * 60 * 1000;

  const events = await prisma.userListeningEvent.findMany({
    where: {
      userId,
      timestamp: {
        gte: new Date(baselineStart),
        lte: new Date(evalEnd),
      },
    },
    orderBy: {
      timestamp: 'asc',
    },
  });

  return calculateTEMFromEvents(events as TemListenEvent[], evaluationEndDate, config);
}
