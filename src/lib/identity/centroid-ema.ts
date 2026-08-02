/**
 * Identity centroid EMA feedback (Backend Fix Part 9).
 *
 *   new_centroid = centroid + (step_size * TES) * (event_vector - centroid)
 *
 * Rules:
 * - Incremental only — never recompute from full listening history.
 * - Only apply when TES durability is resolved (non-pending).
 * - High TES (durable expansion) moves centroid more; low TES barely moves.
 *
 * Storage: User.profileData JSON field `audioCentroid` (+ optional `audioCentroidMeta`).
 */

import { prisma } from '@/lib/prisma';
import type { AudioSignature } from '@/lib/graph/types';
import { IdentityConfig } from '@/lib/config/identity';
import {
  resolveDurabilityFromStream,
  isPendingDurability,
} from '@/lib/metrics/tes-snapshot';

export interface CentroidEmaMeta {
  version: number;
  lastTesSnapshotId?: string;
  lastUpdatedAt: string;
  /** Number of incremental EMA steps applied (not full-history rebuilds). */
  updateCount: number;
}

/**
 * Pure EMA step. Does not touch history arrays.
 */
export function emaUpdateCentroid(
  centroid: AudioSignature,
  eventVector: AudioSignature,
  tes: number,
  stepSize: number = IdentityConfig.centroidEmaStepSize,
): AudioSignature {
  const t = Math.max(0, Math.min(1, Number.isFinite(tes) ? tes : 0));
  const alpha = Math.max(0, Math.min(1, stepSize * t));

  const blend = (c: number, e: number) => c + alpha * (e - c);

  return {
    energy: blend(centroid.energy, eventVector.energy),
    valence: blend(centroid.valence, eventVector.valence),
    danceability: blend(centroid.danceability, eventVector.danceability),
    acousticness: blend(centroid.acousticness, eventVector.acousticness),
    instrumentalness: blend(centroid.instrumentalness, eventVector.instrumentalness),
    tempo: blend(centroid.tempo, eventVector.tempo),
  };
}

/**
 * Mean absolute component delta — for tests proving high TES moves more.
 */
export function centroidDelta(
  a: AudioSignature,
  b: AudioSignature,
): number {
  return (
    Math.abs(a.energy - b.energy) +
    Math.abs(a.valence - b.valence) +
    Math.abs(a.danceability - b.danceability) +
    Math.abs(a.acousticness - b.acousticness) +
    Math.abs(a.instrumentalness - b.instrumentalness) +
    Math.abs(a.tempo - b.tempo) / 200
  ) / 6;
}

export function parseProfileCentroid(
  profileData: string | null | undefined,
): { centroid: AudioSignature | null; meta: CentroidEmaMeta | null; raw: Record<string, unknown> } {
  if (!profileData) return { centroid: null, meta: null, raw: {} };
  try {
    const raw = JSON.parse(profileData) as Record<string, unknown>;
    const c = raw.audioCentroid as AudioSignature | undefined;
    const meta = (raw.audioCentroidMeta as CentroidEmaMeta | undefined) ?? null;
    if (c && typeof c.energy === 'number') {
      return { centroid: c, meta, raw };
    }
    return { centroid: null, meta, raw };
  } catch {
    return { centroid: null, meta: null, raw: {} };
  }
}

/**
 * Apply one EMA update from a TES snapshot if durability is resolved.
 * Returns updated:false when pending or snapshot missing — no history scan.
 */
export async function applyIdentityEmaFromTes(opts: {
  userId: string;
  tesSnapshotId: string;
  eventVector: AudioSignature;
  /** Optional seed centroid if profile has none (single vector, not full history). */
  seedCentroid?: AudioSignature | null;
  stepSize?: number;
}): Promise<{
  updated: boolean;
  reason: string;
  centroid?: AudioSignature;
  previous?: AudioSignature;
}> {
  const snap = await prisma.tesSnapshot.findUnique({
    where: { id: opts.tesSnapshotId },
  });
  if (!snap) {
    return { updated: false, reason: 'tes_snapshot_missing' };
  }

  // Gate on snapshot durability status (frozen authority).
  // Do not force-resolve stream with minDays=0 — that turns pending into zero.
  let durabilityStatus = snap.durabilityStatus;
  let tesScore = snap.tesScore;

  if (isPendingDurability(durabilityStatus)) {
    return { updated: false, reason: 'durability_pending' };
  }

  if (durabilityStatus === 'confirmed_zero') {
    // Confirmed not durable — tiny effective TES so Identity barely moves
    tesScore = Math.min(tesScore, 0.05);
  } else if (durabilityStatus === 'confirmed_positive') {
    // Optional: refine from stream when available (non-blocking for gate)
    try {
      const resolved = await resolveDurabilityFromStream(opts.tesSnapshotId, {
        minDaysSinceSnap: 0,
      });
      if (resolved.status === 'confirmed_positive' && resolved.score != null) {
        // Keep snapshot tesScore; stream confirms durability only
        void resolved;
      }
    } catch {
      // snapshot status already sufficient
    }
  }

  // Load user profile by id or spotifyId
  const user =
    (await prisma.user.findUnique({ where: { id: opts.userId } })) ??
    (await prisma.user.findUnique({ where: { spotifyId: opts.userId } }));
  if (!user) {
    return { updated: false, reason: 'user_missing' };
  }

  const { centroid: stored, meta, raw } = parseProfileCentroid(user.profileData);
  const previous =
    stored ??
    opts.seedCentroid ??
    ({
      energy: 0.5,
      valence: 0.5,
      danceability: 0.5,
      acousticness: 0.5,
      instrumentalness: 0.1,
      tempo: 120,
    } satisfies AudioSignature);

  const next = emaUpdateCentroid(
    previous,
    opts.eventVector,
    tesScore,
    opts.stepSize ?? IdentityConfig.centroidEmaStepSize,
  );

  const nextMeta: CentroidEmaMeta = {
    version: (meta?.version ?? 0) + 1,
    lastTesSnapshotId: opts.tesSnapshotId,
    lastUpdatedAt: new Date().toISOString(),
    updateCount: (meta?.updateCount ?? 0) + 1,
  };

  const newProfile = {
    ...raw,
    audioCentroid: next,
    audioCentroidMeta: nextMeta,
  };

  await prisma.user.update({
    where: { id: user.id },
    data: { profileData: JSON.stringify(newProfile) },
  });

  return {
    updated: true,
    reason: 'ema_applied',
    centroid: next,
    previous,
  };
}
