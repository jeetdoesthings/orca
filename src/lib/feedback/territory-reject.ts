/**
 * Territory-wide "not for me" (Backend Fix Part 11).
 *
 * Distinct from single-track skip / artist ignore.
 * - Suppresses recommendations from that territory for a cooldown window
 * - Feeds OCSE Readiness with severity territory_reject (sharp)
 * - Feeds GRE transition context (push toward REDISCOVER)
 */

import { prisma } from '@/lib/prisma';
import { OcseConfig } from '@/lib/config/ocse';
import { normaliseGenre } from '@/lib/graph/genre-normaliser';
import type { TerritoryRejection as OcseTerritoryRejection } from '@/lib/ocse/decision-score';

export interface RecordTerritoryRejectInput {
  userId: string;
  territoryKey: string;
  sourceArtistId?: string | null;
  cooldownDays?: number;
}

export interface ActiveTerritorySuppression {
  territoryKey: string;
  cooldownUntil: Date;
  createdAt: Date;
}

function normalizeTerritoryKey(key: string): string {
  try {
    return normaliseGenre([key]);
  } catch {
    return key.toLowerCase().trim();
  }
}

/**
 * Record an explicit territory-wide rejection. Creates a new cooldown window
 * (extends if already active).
 */
export async function recordTerritoryReject(
  input: RecordTerritoryRejectInput,
): Promise<{ id: string; territoryKey: string; cooldownUntil: Date }> {
  const territoryKey = normalizeTerritoryKey(input.territoryKey);
  const days = input.cooldownDays ?? OcseConfig.territoryRejectCooldownDays;
  const cooldownUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  // Resolve user id for FK (accept spotifyId)
  let userId = input.userId;
  const user = await prisma.user.findFirst({
    where: { OR: [{ id: input.userId }, { spotifyId: input.userId }] },
    select: { id: true },
  });
  if (user) userId = user.id;

  const row = await prisma.territoryRejection.create({
    data: {
      userId,
      territoryKey,
      cooldownUntil,
      sourceArtistId: input.sourceArtistId ?? null,
      severity: 'territory_reject',
    },
  });

  return {
    id: row.id,
    territoryKey,
    cooldownUntil: row.cooldownUntil,
  };
}

/**
 * Active suppressions (cooldown not expired).
 */
export async function getActiveTerritorySuppressions(
  userId: string,
  now: Date = new Date(),
): Promise<ActiveTerritorySuppression[]> {
  const user = await prisma.user.findFirst({
    where: { OR: [{ id: userId }, { spotifyId: userId }] },
    select: { id: true },
  });
  const uid = user?.id ?? userId;

  const rows = await prisma.territoryRejection.findMany({
    where: {
      userId: uid,
      cooldownUntil: { gt: now },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Dedupe by territoryKey — latest wins
  const map = new Map<string, ActiveTerritorySuppression>();
  for (const r of rows) {
    if (!map.has(r.territoryKey)) {
      map.set(r.territoryKey, {
        territoryKey: r.territoryKey,
        cooldownUntil: r.cooldownUntil,
        createdAt: r.createdAt,
      });
    }
  }
  return Array.from(map.values());
}

export function isTerritorySuppressed(
  suppressions: ActiveTerritorySuppression[],
  genres: string[],
): boolean {
  if (suppressions.length === 0 || genres.length === 0) return false;
  const keys = new Set(suppressions.map((s) => s.territoryKey));
  for (const g of genres) {
    const n = normalizeTerritoryKey(g);
    if (keys.has(n) || keys.has(g.toLowerCase())) return true;
  }
  return false;
}

/**
 * Load rejections for OCSE Readiness (includes expired for recovery curve,
 * but severity still applies via time decay).
 */
export async function loadTerritoryRejectionsForOcse(
  userId: string,
  limit = 50,
): Promise<OcseTerritoryRejection[]> {
  const user = await prisma.user.findFirst({
    where: { OR: [{ id: userId }, { spotifyId: userId }] },
    select: { id: true },
  });
  const uid = user?.id ?? userId;

  const rows = await prisma.territoryRejection.findMany({
    where: { userId: uid },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return rows.map((r: (typeof rows)[number]) => ({
    territoryKey: r.territoryKey,
    at: r.createdAt,
    severity: 'territory_reject' as const,
  }));
}

/**
 * Genres currently under territory-wide reject (for GRE transition context).
 */
export async function getTerritoryRejectFlags(
  userId: string,
): Promise<Set<string>> {
  const active = await getActiveTerritorySuppressions(userId);
  return new Set(active.map((s) => s.territoryKey));
}
