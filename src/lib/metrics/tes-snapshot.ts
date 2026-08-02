/**
 * Immutable TES snapshots + Durability event stream (Backend Fix Part 6).
 *
 * Familiarity: frozen pre-recommendation (Part 2 prior incidental exposure).
 * Foreignness: frozen ONCE at recommendation snapshot time.
 * Durability: append-only DurabilityEvent rows FK'd to TesSnapshot.
 *   pending | confirmed_positive | confirmed_zero — never conflate pending with 0.
 *
 * Zero durability means "measured and confirmed not durable".
 * Pending means "insufficient time / not measured yet".
 *
 * TES snapshots are never updated in place. Later knowledge → createNewTesSnapshot
 * with previousSnapshotId, or append DurabilityEvent only.
 */

import { prisma } from '@/lib/prisma';
import type { ConfidenceTag } from '@/lib/audio/confidence-tags';

export type DurabilityStatus = 'pending' | 'confirmed_positive' | 'confirmed_zero';

export interface TesComponentBreakdown {
  foreignness: number;
  durabilityAtSnap: number | null;
  durabilityStatus: DurabilityStatus;
  agency: number;
  meaningfulness: number | null;
  familiarity: number | null;
  tesScore: number;
  confidenceTag?: ConfidenceTag | string | null;
  audioConfidenceTag?: ConfidenceTag | string | null;
  extra?: Record<string, unknown>;
}

export interface CreateTesSnapshotInput {
  userId: string;
  trackId?: string | null;
  artistId?: string | null;
  territoryId?: string | null;
  foreignness: number;
  agency: number;
  meaningfulness?: number | null;
  familiarity?: number | null;
  /** At create time durability is usually pending — do not pass 0 for "unknown". */
  durabilityAtSnap?: number | null;
  durabilityStatus?: DurabilityStatus;
  tesScore?: number;
  confidenceTag?: string | null;
  audioConfidenceTag?: string | null;
  components?: Record<string, unknown>;
  previousSnapshotId?: string | null;
}

/**
 * Create an immutable TES snapshot. No update API for component fields.
 */
export async function createTesSnapshot(input: CreateTesSnapshotInput): Promise<{ id: string }> {
  const durabilityStatus: DurabilityStatus = input.durabilityStatus ?? 'pending';
  // Pending must not store as measured-zero; leave durabilityAtSnap null when pending.
  const durabilityAtSnap =
    durabilityStatus === 'pending'
      ? null
      : (input.durabilityAtSnap ?? (durabilityStatus === 'confirmed_zero' ? 0 : input.durabilityAtSnap ?? null));

  const agency = input.agency;
  const foreignness = input.foreignness;
  const meaningfulness = input.meaningfulness ?? null;
  const dForScore =
    durabilityStatus === 'pending' ? 1 : durabilityAtSnap ?? 0; // neutral identity for pending composite
  const m = meaningfulness ?? 1;
  const tesScore =
    input.tesScore ??
    foreignness * dForScore * agency * m;

  const componentsJson = JSON.stringify({
    foreignness,
    durabilityAtSnap,
    durabilityStatus,
    agency,
    meaningfulness,
    familiarity: input.familiarity ?? null,
    tesScore,
    confidenceTag: input.confidenceTag ?? null,
    audioConfidenceTag: input.audioConfidenceTag ?? null,
    ...(input.components ?? {}),
  } satisfies TesComponentBreakdown & Record<string, unknown>);

  const row = await prisma.tesSnapshot.create({
    data: {
      userId: input.userId,
      trackId: input.trackId ?? null,
      artistId: input.artistId ?? null,
      territoryId: input.territoryId ?? null,
      foreignness,
      durabilityAtSnap,
      durabilityStatus,
      agency,
      meaningfulness,
      tesScore,
      familiarity: input.familiarity ?? null,
      confidenceTag: input.confidenceTag ?? null,
      audioConfidenceTag: input.audioConfidenceTag ?? null,
      componentsJson,
      previousSnapshotId: input.previousSnapshotId ?? null,
    },
  });
  return { id: row.id };
}

/**
 * Reject in-place mutation of TES component fields.
 * Callers that need a revision must create a NEW snapshot.
 */
export async function assertTesSnapshotImmutable(snapshotId: string): Promise<void> {
  // No update path exported for components. This throws if code tries the anti-pattern helper.
  void snapshotId;
  throw new Error(
    'TesSnapshot is immutable. Create a new snapshot with previousSnapshotId; append DurabilityEvent for later listens.',
  );
}

/**
 * Explicit anti-mutation: any attempt to "update" a snapshot is routed to a new row.
 */
export async function reviseTesSnapshotAsNew(
  previousSnapshotId: string,
  patch: Partial<CreateTesSnapshotInput>,
): Promise<{ id: string; previousSnapshotId: string }> {
  const prev = await prisma.tesSnapshot.findUnique({ where: { id: previousSnapshotId } });
  if (!prev) throw new Error(`TesSnapshot not found: ${previousSnapshotId}`);

  const created = await createTesSnapshot({
    userId: patch.userId ?? prev.userId,
    trackId: patch.trackId !== undefined ? patch.trackId : prev.trackId,
    artistId: patch.artistId !== undefined ? patch.artistId : prev.artistId,
    territoryId: patch.territoryId !== undefined ? patch.territoryId : prev.territoryId,
    foreignness: patch.foreignness ?? prev.foreignness, // Foreignness stays frozen unless explicit new
    agency: patch.agency ?? prev.agency,
    meaningfulness: patch.meaningfulness !== undefined ? patch.meaningfulness : prev.meaningfulness,
    familiarity: patch.familiarity !== undefined ? patch.familiarity : prev.familiarity,
    durabilityAtSnap: patch.durabilityAtSnap !== undefined ? patch.durabilityAtSnap : prev.durabilityAtSnap,
    durabilityStatus: (patch.durabilityStatus as DurabilityStatus) ?? (prev.durabilityStatus as DurabilityStatus),
    tesScore: patch.tesScore,
    confidenceTag: patch.confidenceTag !== undefined ? patch.confidenceTag : prev.confidenceTag,
    audioConfidenceTag:
      patch.audioConfidenceTag !== undefined ? patch.audioConfidenceTag : prev.audioConfidenceTag,
    previousSnapshotId,
  });
  return { id: created.id, previousSnapshotId };
}

export interface AppendDurabilityEventInput {
  tesSnapshotId: string;
  userId: string;
  eventType: string;
  trackId?: string | null;
  artistId?: string | null;
  unprompted?: boolean;
  timestamp?: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Append-only durability stream. Never mutates TesSnapshot rows.
 */
export async function appendDurabilityEvent(
  input: AppendDurabilityEventInput,
): Promise<{ id: string }> {
  const snap = await prisma.tesSnapshot.findUnique({ where: { id: input.tesSnapshotId } });
  if (!snap) throw new Error(`TesSnapshot not found: ${input.tesSnapshotId}`);

  const row = await prisma.durabilityEvent.create({
    data: {
      tesSnapshotId: input.tesSnapshotId,
      userId: input.userId,
      trackId: input.trackId ?? snap.trackId,
      artistId: input.artistId ?? snap.artistId,
      eventType: input.eventType,
      unprompted: input.unprompted ?? false,
      timestamp: input.timestamp ?? new Date(),
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  });
  return { id: row.id };
}

export interface ResolvedDurability {
  status: DurabilityStatus;
  /** null when pending — never treat as 0 */
  score: number | null;
  eventCount: number;
  unpromptedReturns: number;
}

/**
 * Query durability from the event stream + time gate.
 * Does not write to TesSnapshot.
 *
 * Defaults: pending until minDaysSinceSnap elapsed; then
 *   confirmed_positive if unprompted returns >= minUnprompted
 *   confirmed_zero otherwise
 */
export async function resolveDurabilityFromStream(
  tesSnapshotId: string,
  opts?: {
    minDaysSinceSnap?: number;
    minUnpromptedReturns?: number;
    now?: Date;
  },
): Promise<ResolvedDurability> {
  const minDays = opts?.minDaysSinceSnap ?? 7;
  const minUnprompted = opts?.minUnpromptedReturns ?? 1;
  const now = opts?.now ?? new Date();

  const snap = await prisma.tesSnapshot.findUnique({ where: { id: tesSnapshotId } });
  if (!snap) throw new Error(`TesSnapshot not found: ${tesSnapshotId}`);

  const events = await prisma.durabilityEvent.findMany({
    where: { tesSnapshotId },
    orderBy: { timestamp: 'asc' },
  });

  const daysSince =
    (now.getTime() - snap.createdAt.getTime()) / (1000 * 60 * 60 * 24);

  const unpromptedReturns = events.filter(
    (e: (typeof events)[number]) =>
      e.unprompted &&
      (e.eventType === 'return' ||
        e.eventType === 'unprompted_replay' ||
        e.eventType === 'listen'),
  ).length;

  if (daysSince < minDays) {
    return {
      status: 'pending',
      score: null,
      eventCount: events.length,
      unpromptedReturns,
    };
  }

  if (unpromptedReturns >= minUnprompted) {
    // Intensity: more returns → higher score, capped 1
    const score = Math.min(1, 0.4 + unpromptedReturns * 0.2);
    return {
      status: 'confirmed_positive',
      score,
      eventCount: events.length,
      unpromptedReturns,
    };
  }

  return {
    status: 'confirmed_zero',
    score: 0,
    eventCount: events.length,
    unpromptedReturns,
  };
}

/**
 * Sync DurabilityOutcome (Part 5 Agency join) from stream resolution.
 * Does not mutate TesSnapshot.
 */
export async function syncDurabilityOutcomeFromStream(
  tesSnapshotId: string,
  durabilityOutcomeId: string,
  opts?: Parameters<typeof resolveDurabilityFromStream>[1],
): Promise<ResolvedDurability> {
  const resolved = await resolveDurabilityFromStream(tesSnapshotId, opts);
  await prisma.durabilityOutcome.update({
    where: { id: durabilityOutcomeId },
    data: {
      status: resolved.status,
      score: resolved.score,
      measuredAt: resolved.status === 'pending' ? null : new Date(),
    },
  });
  return resolved;
}

export function isPendingDurability(status: DurabilityStatus | string): boolean {
  return status === 'pending';
}

/**
 * Safe numeric for downstream: pending → null (caller must not treat as 0).
 */
export function durabilityScoreOrNull(resolved: ResolvedDurability): number | null {
  if (resolved.status === 'pending') return null;
  return resolved.score;
}
