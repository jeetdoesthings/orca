/**
 * Expansion Intelligence + Readiness + OCSE surface + leap-seek + shore-seek.
 * Extracted from buildFrontierNodes so the runner stays orchestration-only.
 */

import type { Candidate } from '@/lib/candidate/cub-types';
import type { GenreRelationship } from '@/lib/gre/gre-types';
import type { AudioSignature, OrcaNode } from '@/lib/graph/types';
import {
  computeDisaggregatedDistance,
  expansionBandFromDistance,
} from '@/lib/expansion/intelligence';
import {
  resolveAudioSignature,
  type AudioSource,
  type ConfidenceTag,
} from '@/lib/audio/resolve-signature';
import { computeReadinessState, historyFromInteractionMaps } from '@/lib/readiness/readiness-model';
import type { ReadinessState, ReadinessTier } from '@/lib/readiness/readiness-types';
import {
  buildRecommendationSurface,
  countLeapSeekMeetingBar,
  flattenRecommendationSurface,
} from '@/lib/ocse/recommendation-surface';
import type { DecisionProfile, OCSEContext, RecommendationSurface } from '@/lib/ocse/ocse-types';
import type { UserInteractionHistory } from '@/lib/ocse/ocse-types';
import { OcseConfig } from '@/lib/config/ocse';
import { LeapSeekConfig } from '@/lib/config/leap-seek';
import { ShoreSeekConfig } from '@/lib/config/shore-seek';
import { retrieveLeapSeekCandidates } from '@/lib/candidate/leap-seek';
import {
  retrieveShoreSeekCandidates,
  countShoreRange,
} from '@/lib/candidate/shore-seek';
import type { LeapSeekMeta } from '../types';

export interface ScoreAndSurfaceInput {
  userId: string;
  candidates: Candidate[];
  relationships: GenreRelationship[];
  userCentroid: AudioSignature;
  userGenreProfile: Map<string, number>;
  realAudioById: Map<string, AudioSignature>;
  priorPlaysByArtistId: Map<string, number>;
  interactionHistory: UserInteractionHistory;
  currentVisibleWorldIds: string[];
  sliderValue: number;
  explicitTier?: ReadinessTier | null;
  /** Territories already targeted recently (rotation). */
  recentLeapTerritories: string[];
  /** Explored artists for Shore-seek (home depth). */
  exploredArtists?: OrcaNode[];
  /** Skip OCSE entirely (baseline scripts). */
  skipOcse?: boolean;
}

export interface ScoreAndSurfaceResult {
  candidates: Candidate[];
  surface: RecommendationSurface | null;
  readiness: ReadinessState | null;
  profileMap: Map<string, DecisionProfile>;
  candidateAudioById: Map<string, { signature: AudioSignature; source: AudioSource }>;
  leapSeekMeta: LeapSeekMeta;
}

function nameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Run EI distance for one candidate; mutates candidate. */
function attachDistance(
  cand: Candidate,
  input: Pick<
    ScoreAndSurfaceInput,
    | 'userCentroid'
    | 'userGenreProfile'
    | 'relationships'
    | 'realAudioById'
    | 'priorPlaysByArtistId'
  >,
  audioCache: Map<string, { signature: AudioSignature; source: AudioSource }>,
): void {
  const genres =
    cand.genres && cand.genres.length > 0
      ? cand.genres
      : [cand.sourceTerritory || cand.source_territory || 'unknown'];
  // Audio signatures no longer feed expansionDistance (four-axis metadata model).
  // Still resolve for legacy node fields / layout that may read audioSignature.
  const { signature, source } = resolveAudioSignature({
    artistId: cand.artistId,
    genres,
    real: input.realAudioById.get(cand.artistId) ?? null,
  });
  const bundle = computeDisaggregatedDistance({
    userGenreProfile: input.userGenreProfile,
    relationships: input.relationships,
    candidateGenres: genres,
    candidatePopularity: cand.popularity,
    priorObservedPlays: input.priorPlaysByArtistId.get(cand.artistId) ?? 0,
  });
  cand.expansionDistance = Math.round(bundle.composite * 100) / 100;
  cand.distanceComponents = bundle;
  cand.expansionBand = expansionBandFromDistance(cand.expansionDistance);
  // Metadata completeness confidence from four axes (not audio provenance)
  cand.confidenceTag = bundle.compositeConfidence;
  cand.audioSource = bundle.compositeConfidence;
  if (cand.retrieval_path && !cand.retrievalPath) {
    cand.retrievalPath = cand.retrieval_path;
  }
  if (cand.source_territory && !cand.sourceTerritory) {
    cand.sourceTerritory = cand.source_territory;
  }
  if (!cand.retrievalPath) cand.retrievalPath = 'adjacency';
  audioCache.set(cand.artistId, { signature, source });
}

function mergePathCandidates(
  pool: Candidate[],
  incoming: Candidate[],
  path: 'leap_seek' | 'shore_seek',
): Candidate[] {
  const ids = new Set(pool.map((c) => c.artistId));
  const names = new Set(pool.map((c) => nameKey(c.name)));
  const out = [...pool];
  for (const lc of incoming) {
    const nk = nameKey(lc.name);
    if (ids.has(lc.artistId) || names.has(nk)) continue;
    lc.retrievalPath = path;
    lc.retrieval_path = path;
    if (lc.source_territory) lc.sourceTerritory = lc.source_territory;
    out.push(lc);
    ids.add(lc.artistId);
    names.add(nk);
  }
  return out;
}

/**
 * Shore-seek first (home depth), leap-seek (far), then surface.
 * Shore honesty: set shoreBucketFallback if still short after shore-seek.
 * Never rank-remaps distances here — client depth-filter is last resort.
 */
export async function scoreAndBuildSurface(
  input: ScoreAndSurfaceInput,
): Promise<ScoreAndSurfaceResult> {
  const candidateAudioById = new Map<
    string,
    { signature: AudioSignature; source: AudioSource }
  >();
  let candidates = [...input.candidates];
  const leapSeekMeta: LeapSeekMeta = { targetedTerritories: [] };

  // ── 1. Attach EI distances (adjacency pool) ──
  for (const cand of candidates) {
    try {
      attachDistance(cand, input, candidateAudioById);
    } catch (err) {
      console.error(
        `[score-and-surface] EI failed for ${cand.artistId}:`,
        err,
      );
    }
  }

  // ── 2. Shore-seek: depth within explored territory (before leap) ──
  let shoreBucketFallback = false;
  let shoreSeekInShoreCount = 0;
  const explored = input.exploredArtists ?? [];
  if (explored.length > 0) {
    try {
      const excludeIds = new Set(candidates.map((c) => c.artistId));
      const excludeNames = new Set(candidates.map((c) => nameKey(c.name)));
      for (const e of explored) {
        excludeIds.add(e.id);
        excludeNames.add(nameKey(e.name));
      }
      const shore = await retrieveShoreSeekCandidates(explored, {
        excludeIds,
        excludeNames,
      });
      const before = candidates.length;
      candidates = mergePathCandidates(candidates, shore.candidates, 'shore_seek');
      for (const c of candidates.slice(before)) {
        try {
          attachDistance(c, input, candidateAudioById);
        } catch {
          /* keep */
        }
      }
      shoreSeekInShoreCount = candidates.filter((c) => {
        const path = c.retrievalPath ?? c.retrieval_path;
        if (path !== 'shore_seek') return false;
        const d = c.distanceComponents?.composite ?? c.expansionDistance;
        return d != null && d < ShoreSeekConfig.shoreDistanceMax;
      }).length;
      console.log(
        `[score-and-surface] shore-seek +${shore.candidates.length} (in-band=${shoreSeekInShoreCount})`,
      );
    } catch (err) {
      console.warn('[score-and-surface] shore-seek failed:', err);
    }
  }

  // ── 3. Leap-seek ──
  try {
    const leap = await retrieveLeapSeekCandidates(
      input.userId,
      input.relationships,
      {
        recentTerritories: input.recentLeapTerritories,
        offlineOnly:
          !process.env.LASTFM_API_KEY && process.env.NODE_ENV === 'test',
      },
    );
    leapSeekMeta.targetedTerritories = [...leap.targetedTerritories];
    candidates = mergePathCandidates(candidates, leap.candidates, 'leap_seek');
    for (const c of candidates) {
      if (c.retrievalPath === 'leap_seek' || c.retrieval_path === 'leap_seek') {
        if (c.expansionDistance == null) {
          try {
            attachDistance(c, input, candidateAudioById);
          } catch {
            /* keep without distance */
          }
        }
      }
    }
    console.log(
      `[score-and-surface] leap-seek +${leap.candidates.length} (targets: ${leap.targetedTerritories.join(', ')})`,
    );
  } catch (err) {
    console.warn('[score-and-surface] leap-seek failed:', err);
  }

  // Shore honesty after real retrieval (not rank-remap)
  const shoreRange = countShoreRange(candidates);
  if (shoreRange < ShoreSeekConfig.minShorePopulation) {
    shoreBucketFallback = true;
    console.warn(
      `[score-and-surface] shore short after shore-seek (${shoreRange}/${ShoreSeekConfig.minShorePopulation})`,
    );
  }

  // Variance collapse detection (flag only — no remap on server)
  let distanceVarianceCollapsed = false;
  const dists = candidates
    .map((c) => c.expansionDistance)
    .filter((d): d is number => d != null && Number.isFinite(d));
  if (dists.length >= 3) {
    const mean = dists.reduce((a, b) => a + b, 0) / dists.length;
    const variance =
      dists.reduce((s, d) => s + (d - mean) * (d - mean), 0) / dists.length;
    if (variance < 0.002) {
      distanceVarianceCollapsed = true;
      console.warn(
        `[score-and-surface] distance variance collapsed (var=${variance.toFixed(5)})`,
      );
    }
  }

  if (input.skipOcse) {
    return {
      candidates,
      surface: null,
      readiness: null,
      profileMap: new Map(),
      candidateAudioById,
      leapSeekMeta,
    };
  }

  // ── 4. Readiness ──
  const historyEvents = historyFromInteractionMaps({
    timesIgnored: input.interactionHistory.timesIgnored,
    timesDismissed: input.interactionHistory.timesDismissed,
    timesIntegrated: input.interactionHistory.timesIntegrated,
    territoryRejections: input.interactionHistory.territoryRejections,
  });
  const readiness = computeReadinessState({
    relationships: input.relationships,
    history: historyEvents,
    explicitTier: input.explicitTier ?? null,
  });

  const baseContext: OCSEContext = {
    relationships: input.relationships,
    sliderValue: input.sliderValue,
    interactionHistory: input.interactionHistory,
    currentVisibleWorldIds: input.currentVisibleWorldIds,
    readinessState: readiness,
  };

  // ── 5. Surface (strict leap first) ──
  let surface = buildRecommendationSurface(candidates, baseContext, readiness, {
    leapPolicy: 'strict',
  });

  const minPop = OcseConfig.minBucketPopulation;
  let leapSeekCount = countLeapSeekMeetingBar(candidates);

  // ── 6. Refill leap-seek if thin ──
  if (surface.leap.length < minPop || leapSeekCount < minPop) {
    try {
      const refill = await retrieveLeapSeekCandidates(
        input.userId,
        input.relationships,
        {
          recentTerritories: input.recentLeapTerritories,
          excludeTerritories: leapSeekMeta.targetedTerritories,
          maxTerritories: LeapSeekConfig.refillExtraTerritories,
          offlineOnly:
            !process.env.LASTFM_API_KEY && process.env.NODE_ENV === 'test',
        },
      );
      const before = candidates.length;
      candidates = mergePathCandidates(candidates, refill.candidates, 'leap_seek');
      for (const c of candidates.slice(before)) {
        try {
          attachDistance(c, input, candidateAudioById);
        } catch {
          /* keep */
        }
      }
      leapSeekMeta.targetedTerritories = [
        ...leapSeekMeta.targetedTerritories,
        ...refill.targetedTerritories,
      ];
      leapSeekCount = countLeapSeekMeetingBar(candidates);
      surface = buildRecommendationSurface(candidates, baseContext, readiness, {
        leapPolicy: 'strict',
      });
      console.log(
        `[score-and-surface] leap refill +${refill.candidates.length}, bar=${leapSeekCount}`,
      );
    } catch (err) {
      console.warn('[score-and-surface] leap refill failed:', err);
    }
  }

  // ── 7. Last resort: allow near-pool into leap ──
  if (surface.leap.length < minPop) {
    console.warn(
      `[score-and-surface] leap short (${surface.leap.length}/${minPop}); allowNearFallback`,
    );
    surface = buildRecommendationSurface(candidates, baseContext, readiness, {
      leapPolicy: 'allowNearFallback',
    });
  }

  // Attach Shore honesty flags to surface (server source of truth)
  surface = {
    ...surface,
    shoreBucketFallback:
      shoreBucketFallback || (surface.shoreBucketFallback ?? false),
    distanceVarianceCollapsed,
    shoreSeekInShoreCount,
  };

  const profiles = flattenRecommendationSurface(surface);
  const profileMap = new Map(profiles.map((p) => [p.candidateId, p]));

  console.log(
    `[score-and-surface] surface comfort=${surface.comfort.length} expansion=${surface.expansion.length} leap=${surface.leap.length} leap_seek=${surface.leapSeekInLeapCount ?? 0} leapFallback=${surface.leapBucketFallback ?? false} shore_seek_in_band=${shoreSeekInShoreCount} shoreFallback=${surface.shoreBucketFallback ?? false} varCollapse=${distanceVarianceCollapsed}`,
  );

  return {
    candidates,
    surface,
    readiness,
    profileMap,
    candidateAudioById,
    leapSeekMeta,
  };
}
