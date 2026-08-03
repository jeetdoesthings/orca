/**
 * Readiness Model (Change B).
 *
 * Position: Expansion Intelligence → **Readiness Model** → OCSE
 *
 * Absorbs GRE per-genre state + rolling reject/accept history + explicit
 * session tier. This is the only place that decides recommended readiness tier.
 * OCSE, Projection, and the frontend must treat `ReadinessState` as source of truth.
 */

import { ReadinessConfig, type ReadinessTier } from '@/lib/config/readiness';
import type {
  ReadinessHistoryEvent,
  ReadinessModelInputs,
  ReadinessState,
} from './readiness-types';
import { GRE_STAGE_PRODUCT_LABEL } from './readiness-types';
import { prisma } from '@/lib/prisma';
import type { UserInteractionHistory } from '@/lib/ocse/ocse-types';

/**
 * Build a ReadinessHistoryEvent[] from the canonical user interaction tables.
 * Accepts the OCSE interaction-history snapshot (UserArtistMemory counts + territory
 * rejections) and also loads explicit tier overrides from AgencyInteractionEvent.
 */
export async function loadReadinessHistory(
  userIdOrSpotifyId: string,
  interactionHistory: UserInteractionHistory,
): Promise<ReadinessHistoryEvent[]> {
  const user = await prisma.user.findFirst({
    where: { OR: [{ id: userIdOrSpotifyId }, { spotifyId: userIdOrSpotifyId }] },
    select: { id: true },
  });
  const userId = user?.id ?? userIdOrSpotifyId;

  const events = historyFromInteractionMaps({
    timesIgnored: interactionHistory.timesIgnored,
    timesDismissed: interactionHistory.timesDismissed,
    timesIntegrated: interactionHistory.timesIntegrated,
    territoryRejections: interactionHistory.territoryRejections,
  });

  const overrides = await prisma.agencyInteractionEvent.findMany({
    where: { userId, interactionType: 'tier_override' },
    orderBy: { timestamp: 'desc' },
    take: 50,
  });

  for (const row of overrides) {
    let tier: ReadinessTier | null = null;
    // AgencyInteractionEvent uses `timestamp`, not `createdAt` (crash fix: the
    // old code read row.createdAt which is undefined → TypeError).
    let at: string = (row.timestamp ?? new Date()).toISOString();
    try {
      const meta = JSON.parse((row.metadata as string) || '{}');
      if (meta.tier && (['comfort', 'expansion', 'leap'] as ReadinessTier[]).includes(meta.tier)) {
        tier = meta.tier as ReadinessTier;
      }
      if (meta.at) at = meta.at;
    } catch {
      // metadata corrupt: skip
    }
    if (tier) {
      events.push({ type: 'tier_override', tier, at });
    }
  }

  return events;
}

function parseAt(at: Date | string): number {
  return typeof at === 'string' ? new Date(at).getTime() : at.getTime();
}

/**
 * Map appetite score in [0,1] to comfort / expansion / leap.
 */
export function tierFromAppetite(score: number): ReadinessTier {
  const { comfortMax, expansionMax } = ReadinessConfig.tierThresholds;
  if (score < comfortMax) return 'comfort';
  if (score < expansionMax) return 'expansion';
  return 'leap';
}

function greAppetite(relationships: ReadinessModelInputs['relationships']): {
  score: number;
  summary: string;
} {
  if (!relationships.length) {
    return { score: 0.55, summary: 'limited territory history' };
  }

  let sum = 0;
  const stageCounts: Record<string, number> = {};
  for (const r of relationships) {
    const s = r.stage || 'DEFAULT';
    stageCounts[s] = (stageCounts[s] ?? 0) + 1;
    sum +=
      ReadinessConfig.greStageReadinessScore[s] ??
      ReadinessConfig.greStageReadinessScore.DEFAULT;
  }
  const score = sum / relationships.length;

  const open =
    (stageCounts.UNTUCHED ?? 0) +
    (stageCounts.INTRODUCED ?? 0) +
    (stageCounts.EXPLORING ?? 0);
  const settled =
    (stageCounts.CORE_IDENTITY ?? 0) + (stageCounts.INTEGRATED ?? 0);

  const topStage = Object.entries(stageCounts).sort((a, b) => b[1] - a[1])[0];
  const product = topStage
    ? GRE_STAGE_PRODUCT_LABEL[topStage[0]] ?? topStage[0]
    : 'mixed';
  const summary =
    open >= settled
      ? `mostly open territory (${product})`
      : `mostly settled territory (${product})`;

  return { score, summary };
}

function windowPressure(
  history: ReadinessHistoryEvent[],
  nowMs: number,
  windowDays: number,
): { rejection: number; accept: number; historicalTierBias: number } {
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  let rejection = 0;
  let accept = 0;
  let tierScore = 0;
  let tierN = 0;

  for (const ev of history) {
    const t = parseAt(ev.at);
    if (!Number.isFinite(t) || nowMs - t > windowMs || t > nowMs + 1000) continue;
    const ageDays = (nowMs - t) / (24 * 60 * 60 * 1000);
    const decay = Math.exp(-ageDays / Math.max(1, windowDays / 2));

    if (ev.type === 'reject' || ev.type === 'skip') {
      let w = ReadinessConfig.rejectionPressureWeight * decay;
      if (ev.severity === 'territory_reject') {
        w += ReadinessConfig.territoryRejectExtra * decay;
      }
      rejection += w;
    } else if (ev.type === 'accept' || ev.type === 'integrate') {
      accept += ReadinessConfig.acceptPressureWeight * decay;
    } else if (ev.type === 'tier_override' && ev.tier) {
      const map: Record<ReadinessTier, number> = {
        comfort: 0.25,
        expansion: 0.55,
        leap: 0.85,
      };
      tierScore += map[ev.tier] * decay;
      tierN += decay;
    }
  }

  const historicalTierBias =
    tierN > 0
      ? (tierScore / tierN - 0.55) * ReadinessConfig.historicalTierWeight
      : 0;

  return { rejection, accept, historicalTierBias };
}

function tierLabel(tier: ReadinessTier): string {
  return tier === 'comfort' ? 'Comfort' : tier === 'expansion' ? 'Expansion' : 'Leap';
}

function buildReasoning(
  tier: ReadinessTier,
  opts: {
    explicit?: boolean;
    greSummary: string;
    rejection: number;
    accept: number;
  },
): string {
  if (opts.explicit) {
    return ReadinessConfig.reasoningTemplates.explicit.replace(
      '{tier}',
      tierLabel(tier),
    );
  }
  if (opts.rejection > opts.accept + 0.15) {
    return ReadinessConfig.reasoningTemplates.comfort.replace(
      'Comfort',
      tierLabel(tier),
    );
  }
  if (opts.accept > opts.rejection + 0.15 && tier === 'leap') {
    return ReadinessConfig.reasoningTemplates.leap;
  }
  if (opts.greSummary.includes('open')) {
    return ReadinessConfig.reasoningTemplates.greHeavy.replace(
      '{tier}',
      tierLabel(tier),
    );
  }
  if (opts.greSummary.includes('settled')) {
    return ReadinessConfig.reasoningTemplates.greSettled.replace(
      '{tier}',
      tierLabel(tier),
    );
  }
  const base = ReadinessConfig.reasoningTemplates[tier];
  return base;
}

/**
 * Compute authoritative readiness for this user-session.
 */
export function computeReadinessState(
  inputs: ReadinessModelInputs,
): ReadinessState {
  const nowMs = inputs.nowMs ?? Date.now();
  const windowDays =
    inputs.historyWindowDays ?? ReadinessConfig.historyWindowDays;
  const explicit =
    inputs.explicitTier === 'comfort' ||
    inputs.explicitTier === 'expansion' ||
    inputs.explicitTier === 'leap'
      ? inputs.explicitTier
      : null;

  if (explicit && ReadinessConfig.explicitOverrideWins) {
    return {
      recommendedTier: explicit,
      reasoning: buildReasoning(explicit, {
        explicit: true,
        greSummary: '',
        rejection: 0,
        accept: 0,
      }),
      explicitOverride: explicit,
      greSummary: greAppetite(inputs.relationships).summary,
      computedAt: new Date(nowMs).toISOString(),
    };
  }

  const gre = greAppetite(inputs.relationships);
  const { rejection, accept, historicalTierBias } = windowPressure(
    inputs.history ?? [],
    nowMs,
    windowDays,
  );

  // Appetite: GRE baseline + accepts − rejections + historical tier bias
  let appetite = gre.score + accept - rejection + historicalTierBias;
  appetite = Math.min(1, Math.max(0, appetite));

  const recommendedTier = tierFromAppetite(appetite);
  const reasoning = buildReasoning(recommendedTier, {
    greSummary: gre.summary,
    rejection,
    accept,
  });

  return {
    recommendedTier,
    reasoning,
    greSummary: gre.summary,
    rejectionPressure: Math.round(rejection * 1000) / 1000,
    acceptPressure: Math.round(accept * 1000) / 1000,
    appetiteScore: Math.round(appetite * 1000) / 1000,
    explicitOverride: explicit,
    computedAt: new Date(nowMs).toISOString(),
  };
}

/**
 * Build history events from OCSE interaction history + territory rejects.
 * Pure helper for pipeline wiring.
 */
export function historyFromInteractionMaps(opts: {
  timesIgnored?: Record<string, number>;
  timesDismissed?: Record<string, number>;
  timesIntegrated?: Record<string, number>;
  territoryRejections?: Array<{
    territoryKey: string;
    at: Date | string;
    severity?: 'skip' | 'territory_reject';
  }>;
  tierOverrides?: Array<{ tier: ReadinessTier; at: Date | string }>;
  /** Approximate event times when only counts exist (spread across window). */
  nowMs?: number;
}): ReadinessHistoryEvent[] {
  const now = opts.nowMs ?? Date.now();
  const events: ReadinessHistoryEvent[] = [];

  for (const r of opts.territoryRejections ?? []) {
    events.push({
      type: 'reject',
      at: r.at,
      territoryKey: r.territoryKey,
      severity: r.severity ?? 'territory_reject',
    });
  }

  // Count-based signals: place as recent synthetic events (same day spread)
  const addCounts = (
    map: Record<string, number> | undefined,
    type: ReadinessHistoryEvent['type'],
  ) => {
    if (!map) return;
    let i = 0;
    for (const [, count] of Object.entries(map)) {
      for (let c = 0; c < Math.min(count, 5); c++) {
        events.push({
          type,
          at: new Date(now - i * 3600_000).toISOString(),
        });
        i++;
      }
    }
  };

  addCounts(opts.timesIntegrated, 'integrate');
  addCounts(opts.timesIgnored, 'skip');
  addCounts(opts.timesDismissed, 'reject');

  for (const t of opts.tierOverrides ?? []) {
    events.push({ type: 'tier_override', tier: t.tier, at: t.at });
  }

  return events;
}
