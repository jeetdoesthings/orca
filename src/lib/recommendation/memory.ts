import { prisma } from '@/lib/prisma';
import { resolveUserPk } from '@/lib/ocse/serve-log';

export type RecommendationMemoryStatus =
  | 'shown'
  | 'opened'
  | 'clicked'
  | 'played'
  | 'saved'
  | 'ignored'
  | 'hidden'
  | 'accepted'
  | 'replayed'
  | 'rejected';

const STATUS_DATE_FIELD: Record<RecommendationMemoryStatus, string> = {
  shown: 'shownAt',
  opened: 'openedAt',
  clicked: 'clickedAt',
  played: 'playedAt',
  saved: 'savedAt',
  ignored: 'ignoredAt',
  hidden: 'hiddenAt',
  accepted: 'acceptedAt',
  replayed: 'replayedAt',
  rejected: 'rejectedAt',
};

export async function recordRecommendationMemory(opts: {
  userId: string;
  artistId: string;
  status: RecommendationMemoryStatus;
  sourceSnapshot?: unknown;
}): Promise<void> {
  const userPk = await resolveUserPk(opts.userId);
  if (!userPk) return;
  const atField = STATUS_DATE_FIELD[opts.status];
  const sourceSnapshot =
    opts.sourceSnapshot === undefined
      ? undefined
      : typeof opts.sourceSnapshot === 'string'
        ? opts.sourceSnapshot
        : JSON.stringify(opts.sourceSnapshot);
  await prisma.recommendationMemory.upsert({
    where: { userId_artistId: { userId: userPk, artistId: opts.artistId } },
    create: {
      userId: userPk,
      artistId: opts.artistId,
      status: opts.status,
      [atField]: new Date(),
      ...(sourceSnapshot !== undefined ? { sourceSnapshot } : {}),
    },
    update: {
      status: opts.status,
      [atField]: new Date(),
      ...(sourceSnapshot !== undefined ? { sourceSnapshot } : {}),
    },
  });
}

