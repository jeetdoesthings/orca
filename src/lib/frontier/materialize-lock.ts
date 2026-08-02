import { prisma } from '@/lib/prisma';
import {
  materializeWorld,
  type MaterializeWorldOptions,
  type MaterializeWorldResult,
} from './pipeline-runner';
import { readWorldState } from './world-state-store';

/**
 * Per-user materialization guard (audit fix H2).
 *
 * Background materializations used to be fire-and-forget: the route returned
 * immediately and the long pipeline ran detached. On serverless platforms the
 * function is frozen once the response is sent, so the job died mid-flight.
 * This wrapper makes callers await the run while still protecting against
 * duplicate concurrent runs:
 *
 * - In-process: a second call for the same user returns the in-flight promise.
 * - Cross-instance (best effort): a fresh `frontierStatus=COMPUTING` row is
 *   treated as an active computation and the cached world is returned instead
 *   of starting a second run.
 * - A stuck COMPUTING (crashed process) older than STALE_COMPUTING_MS is
 *   allowed through so the world can recover.
 */

const STALE_COMPUTING_MS = 10 * 60 * 1000;

const inflight = new Map<string, Promise<MaterializeWorldResult>>();

export async function materializeWorldDeduped(
  userId: string,
  options: MaterializeWorldOptions = {},
): Promise<MaterializeWorldResult> {
  const existing = inflight.get(userId);
  if (existing) return existing;

  const p = (async () => {
    const active = await prisma.user.findUnique({
      where: { spotifyId: userId },
      select: { frontierStatus: true, updatedAt: true },
    });
    if (active?.frontierStatus === 'COMPUTING') {
      const ageMs = Date.now() - new Date(active.updatedAt).getTime();
      if (ageMs < STALE_COMPUTING_MS) {
        console.log(
          `[MaterializeLock] ${userId} already COMPUTING (${Math.round(ageMs / 1000)}s ago) — returning cached world`,
        );
        const ws = await readWorldState(userId);
        return { frontierNodes: ws.lastNodes, worldState: ws };
      }
      console.warn(
        `[MaterializeLock] ${userId} COMPUTING but stale (${Math.round(ageMs / 60000)}min) — starting a fresh run`,
      );
    }
    return materializeWorld(userId, options);
  })();

  // Register synchronously so concurrent callers observe the in-flight run.
  inflight.set(userId, p);
  p.finally(() => inflight.delete(userId)).catch(() => {
    /* original rejection is delivered to the awaiting caller */
  });

  return p;
}
