/**
 * Recommendation Surface (Change C).
 *
 * OCSE output is three independently ranked buckets (comfort / expansion / leap),
 * not one top-N list sliced into thirds. Switching tiers is a read of this surface.
 */

import type { Candidate } from '@/lib/candidate/cub-types';
import type { DisaggregatedDistance } from '@/lib/expansion/distance-components';
import type { ReadinessState, ReadinessTier } from '@/lib/readiness/readiness-types';
import { OcseConfig } from '@/lib/config/ocse';
import {
  computeBatchDiversity,
  confidenceFromTag,
  weightedGeometricMean,
} from './decision-score';
import { evaluateCandidate } from './decision-engine';
import type {
  DecisionProfile,
  OCSEContext,
  RecommendationSurface,
} from './ocse-types';
import { normaliseGenre } from '@/lib/graph/genre-normaliser';

type ComponentKey = 'territory' | 'scene' | 'era' | 'language';

const COMPONENT_KEYS: ComponentKey[] = [
  'territory',
  'scene',
  'era',
  'language',
];

function componentValue(d: DisaggregatedDistance, key: ComponentKey): number {
  switch (key) {
    case 'territory':
      return d.territory_distance.value;
    case 'scene':
      return d.scene_distance.value;
    case 'era':
      return d.era_distance.value;
    case 'language':
      return d.language_distance.value;
  }
}

/**
 * How well the candidate's five distances match the bucket's target profile.
 * 1 = perfect match to targets; 0 = maximally far from targets.
 */
export function bucketDistanceFit(
  components: DisaggregatedDistance | undefined,
  bucket: ReadinessTier,
  tolerance = 0,
): number {
  if (!components) {
    // Fallback: use composite distance proximity to mid target
    return 0.4;
  }
  const weights = OcseConfig.bucketDistanceWeights[bucket];
  const targets = OcseConfig.bucketDistanceTargets[bucket];
  let wSum = 0;
  let fitSum = 0;
  for (const key of COMPONENT_KEYS) {
    const w = weights[key];
    const target = targets[key];
    const actual = componentValue(components, key);
    const band = 0.35 + tolerance;
    const err = Math.abs(actual - target);
    const localFit = Math.max(0, 1 - err / Math.max(0.15, band));
    fitSum += w * localFit;
    wSum += w;
  }
  if (wSum <= 0) return 0.4;
  return Math.round((fitSum / wSum) * 1000) / 1000;
}

/**
 * Readiness fit for a bucket: boost when bucket matches recommended tier.
 * This is NOT user readiness (that is Change B) — it is bucket alignment.
 */
export function bucketReadinessFit(
  bucket: ReadinessTier,
  readiness: ReadinessState,
): number {
  if (bucket === readiness.recommendedTier) return 1.0;
  // Adjacent tiers still acceptable
  const order: ReadinessTier[] = ['comfort', 'expansion', 'leap'];
  const di = Math.abs(order.indexOf(bucket) - order.indexOf(readiness.recommendedTier));
  if (di === 1) return 0.75;
  return 0.55;
}

function scoreForBucket(
  candidate: Candidate,
  profile: DecisionProfile,
  bucket: ReadinessTier,
  readiness: ReadinessState,
  diversity: number,
  tolerance: number,
): number {
  const distFit = bucketDistanceFit(
    candidate.distanceComponents,
    bucket,
    tolerance,
  );
  const readyFit = bucketReadinessFit(bucket, readiness);
  const conf = confidenceFromTag(
    candidate.confidenceTag ?? candidate.audioSource,
  );
  const w = OcseConfig.surfaceScoreWeights;
  const geo = weightedGeometricMean([
    { value: distFit, weight: w.distanceFit },
    { value: readyFit, weight: w.readinessFit },
    { value: diversity, weight: w.diversity },
    { value: conf, weight: w.confidence },
  ]);
  // Apply cooldown from base profile
  return Math.round(geo * (profile.cooldownMultiplier ?? 1) * 1000) / 1000;
}

function diversifyGenres(profiles: DecisionProfile[], candidates: Candidate[]): number {
  const byId = new Map(candidates.map((c) => [c.artistId, c]));
  const genres = profiles.map((p) => {
    const c = byId.get(p.candidateId);
    if (c?.genres?.length) {
      try {
        return normaliseGenre([c.genres[0]]);
      } catch {
        return c.genres[0];
      }
    }
    return 'unknown';
  });
  return computeBatchDiversity(genres);
}

export type LeapSurfacePolicy = 'strict' | 'allowNearFallback';

export interface BuildSurfaceOptions {
  /**
   * strict: leap bucket only from leap_seek (or natural high-distance fit).
   * allowNearFallback: last-resort widen after leap-seek refill failed.
   */
  leapPolicy?: LeapSurfacePolicy;
}

function isLeapSeek(c: Candidate): boolean {
  return c.retrievalPath === 'leap_seek' || c.retrieval_path === 'leap_seek';
}

/**
 * Build the full Recommendation Surface from a pre-scored candidate universe.
 * Exclusive primary bucket: each candidate appears in at most one bucket.
 * Leap widen policy is an explicit option — not a smuggled OCSEContext flag.
 */
export function buildRecommendationSurface(
  candidates: Candidate[],
  context: OCSEContext,
  readiness: ReadinessState,
  options: BuildSurfaceOptions = {},
): RecommendationSurface {
  const leapPolicy: LeapSurfacePolicy = options.leapPolicy ?? 'strict';
  const allowLeapWiden = leapPolicy === 'allowNearFallback';
  const generatedAt = new Date().toISOString();
  const baseProfiles = candidates.map((c) => evaluateCandidate(c, context));
  const profileById = new Map(baseProfiles.map((p) => [p.candidateId, p]));
  const candById = new Map(candidates.map((c) => [c.artistId, c]));

  const minPop = OcseConfig.minBucketPopulation;
  const steps = OcseConfig.bucketWidenSteps;

  type Scored = {
    id: string;
    bucket: ReadinessTier;
    score: number;
    distFit: number;
  };

  // Score every candidate for every bucket at tolerance 0 first
  const bestAssignment = new Map<string, Scored>();

  const scoreAll = (tolerance: number) => {
    for (const c of candidates) {
      const base = profileById.get(c.artistId);
      if (!base) continue;
      if ((base.cooldownMultiplier ?? 1) <= 0) continue; // integrated out

      // Leap-seek path: exclusive assignment to leap (no magic score pad)
      if (isLeapSeek(c)) {
        const distFit = bucketDistanceFit(
          c.distanceComponents,
          'leap',
          tolerance,
        );
        const score = scoreForBucket(
          c,
          base,
          'leap',
          readiness,
          OcseConfig.diversity.singletonDefault,
          tolerance,
        );
        bestAssignment.set(c.artistId, {
          id: c.artistId,
          bucket: 'leap',
          score,
          distFit,
        });
        continue;
      }

      let best: Scored | null = null;
      for (const bucket of ['comfort', 'expansion', 'leap'] as ReadinessTier[]) {
        // Provisional diversity = singleton until bucket formed
        const score = scoreForBucket(
          c,
          base,
          bucket,
          readiness,
          OcseConfig.diversity.singletonDefault,
          tolerance,
        );
        const distFit = bucketDistanceFit(
          c.distanceComponents,
          bucket,
          tolerance,
        );
        if (!best || score > best.score) {
          best = { id: c.artistId, bucket, score, distFit };
        }
      }
      if (best) {
        const prev = bestAssignment.get(c.artistId);
        if (!prev || best.score > prev.score) {
          bestAssignment.set(c.artistId, best);
        }
      }
    }
  };

  scoreAll(0);

  // Ensure min population by widening tolerance and re-assigning unfilled
  const buckets: Record<ReadinessTier, Scored[]> = {
    comfort: [],
    expansion: [],
    leap: [],
  };

  const assignFromMap = () => {
    buckets.comfort = [];
    buckets.expansion = [];
    buckets.leap = [];
    for (const s of bestAssignment.values()) {
      buckets[s.bucket].push(s);
    }
    for (const b of Object.keys(buckets) as ReadinessTier[]) {
      buckets[b].sort((a, c) => c.score - a.score);
    }
  };
  assignFromMap();

  let leapBucketFallback = false;

  for (const tol of steps) {
    const short = (['comfort', 'expansion', 'leap'] as ReadinessTier[]).filter(
      (b) => buckets[b].length < minPop,
    );
    if (short.length === 0) break;

    for (const c of candidates) {
      const base = profileById.get(c.artistId);
      if (!base || (base.cooldownMultiplier ?? 1) <= 0) continue;
      const current = bestAssignment.get(c.artistId);
      for (const bucket of short) {
        if (bucket === 'leap' && !allowLeapWiden && !isLeapSeek(c)) {
          continue;
        }
        const score = scoreForBucket(
          c,
          base,
          bucket,
          readiness,
          OcseConfig.diversity.singletonDefault,
          tol,
        );
        const distFit = bucketDistanceFit(c.distanceComponents, bucket, tol);
        if (
          !current ||
          (buckets[current.bucket].length > minPop && score > current.score * 0.95) ||
          (current.bucket === bucket && score > current.score)
        ) {
          if (buckets[bucket].length < minPop) {
            if (bucket === 'leap' && !isLeapSeek(c) && allowLeapWiden) {
              leapBucketFallback = true;
            }
            bestAssignment.set(c.artistId, {
              id: c.artistId,
              bucket,
              score,
              distFit,
            });
          }
        }
      }
    }
    assignFromMap();
  }

  const used = new Set(
    [...buckets.comfort, ...buckets.expansion, ...buckets.leap].map((s) => s.id),
  );
  for (const bucket of ['comfort', 'expansion', 'leap'] as ReadinessTier[]) {
    if (buckets[bucket].length >= minPop) continue;
    if (bucket === 'leap' && !allowLeapWiden) continue;
    const remaining = candidates
      .filter((c) => !used.has(c.artistId))
      .filter((c) => bucket !== 'leap' || allowLeapWiden || isLeapSeek(c))
      .map((c) => {
        const base = profileById.get(c.artistId)!;
        const score = scoreForBucket(
          c,
          base,
          bucket,
          readiness,
          OcseConfig.diversity.singletonDefault,
          0.6,
        );
        return {
          id: c.artistId,
          bucket,
          score,
          distFit: bucketDistanceFit(c.distanceComponents, bucket, 0.6),
          leapSeek: isLeapSeek(c),
        };
      })
      .sort((a, b) => b.score - a.score);
    for (const s of remaining) {
      if (buckets[bucket].length >= minPop) break;
      if (bucket === 'leap' && !s.leapSeek) {
        leapBucketFallback = true;
        console.warn(
          '[leap-seek] leap bucket fallback: non-leap_seek candidate',
          s.id,
        );
      }
      buckets[bucket].push(s);
      used.add(s.id);
      bestAssignment.set(s.id, s);
    }
  }

  if (buckets.leap.length < minPop && allowLeapWiden) {
    leapBucketFallback = true;
    console.warn(
      `[leap-seek] leap still short after fallback (${buckets.leap.length}/${minPop})`,
    );
  }

  // Re-rank each bucket with true within-bucket diversity
  const toProfiles = (scored: Scored[]): DecisionProfile[] => {
    const profiles: DecisionProfile[] = [];
    for (const s of scored) {
      const base = profileById.get(s.id);
      const cand = candById.get(s.id);
      if (!base || !cand) continue;
      profiles.push({
        ...base,
        readinessBucket: s.bucket,
        bucketDistanceFit: s.distFit,
        distanceComponents: cand.distanceComponents,
        expansionDistance:
          cand.expansionDistance ?? cand.distanceComponents?.composite,
        decisionConfidence: s.score,
        decisionScore: s.score,
      });
    }
    // Diversity re-weight: re-score with batch diversity of this set
    const div = diversifyGenres(profiles, candidates);
    return profiles
      .map((p) => {
        const cand = candById.get(p.candidateId)!;
        const score = scoreForBucket(
          cand,
          p,
          p.readinessBucket!,
          readiness,
          div,
          0,
        );
        return {
          ...p,
          decisionConfidence: score,
          decisionScore: score,
          batchDiversity: div,
        };
      })
      .sort((a, b) => (b.decisionScore ?? 0) - (a.decisionScore ?? 0));
  };

  const leapProfiles = toProfiles(buckets.leap);
  const leapSeekInLeapCount = leapProfiles.filter((p) => {
    const c = candById.get(p.candidateId);
    return c ? isLeapSeek(c) : false;
  }).length;

  return {
    comfort: toProfiles(buckets.comfort),
    expansion: toProfiles(buckets.expansion),
    leap: leapProfiles,
    readiness,
    generatedAt,
    leapBucketFallback,
    leapSeekInLeapCount,
  };
}

/** How many leap_seek candidates meet a basic leap bar (for refill decisions). */
export function countLeapSeekMeetingBar(candidates: Candidate[]): number {
  return candidates.filter((c) => {
    if (!isLeapSeek(c)) return false;
    const d = c.distanceComponents?.composite ?? c.expansionDistance ?? 0;
    return d >= 0.45;
  }).length;
}

/** Flat list for legacy callers: recommended tier first, then others. */
export function flattenRecommendationSurface(
  surface: RecommendationSurface,
): DecisionProfile[] {
  const order: ReadinessTier[] = ['comfort', 'expansion', 'leap'];
  const preferred = surface.readiness.recommendedTier;
  const sorted = [
    preferred,
    ...order.filter((t) => t !== preferred),
  ];
  const out: DecisionProfile[] = [];
  const seen = new Set<string>();
  for (const t of sorted) {
    for (const p of surface[t]) {
      if (seen.has(p.candidateId)) continue;
      seen.add(p.candidateId);
      out.push(p);
    }
  }
  return out;
}

export function surfaceBucketIds(
  surface: RecommendationSurface,
  tier: ReadinessTier,
): Set<string> {
  return new Set(surface[tier].map((p) => p.candidateId));
}
