import { prisma } from '@/lib/prisma';

/**
 * Demo mode gate + resolution (audit fix H1).
 *
 * Demo endpoints used to resolve the user as
 * `prisma.user.findFirst({ where: { syncStatus: 'COMPLETE' } })`, which — via a
 * Prisma `$extends` interceptor — could fall back to the FIRST REAL SYNCED USER
 * when no `demo-user` row existed. That let unauthenticated requests read and
 * mutate a real user's taste graph, frontier, and territory state.
 *
 * This module is the single gated path:
 * - Demo access requires `ENABLE_DEMO=1` (dev default, never production).
 * - It resolves ONLY the explicit `demo-user` row (spotifyId = 'demo-user').
 * - It never falls back to any real user.
 */

export function isDemoEnabled(): boolean {
  return process.env.ENABLE_DEMO === '1';
}

/**
 * Resolve the demo user's spotifyId, or null when demo mode is not enabled or
 * the demo-user row does not exist / is not synced. Never returns a real user.
 */
export async function resolveDemoUser(): Promise<string | null> {
  if (!isDemoEnabled()) return null;
  const demoUser = await prisma.user.findFirst({
    where: { spotifyId: 'demo-user', syncStatus: 'COMPLETE' },
    select: { spotifyId: true },
  });
  return demoUser?.spotifyId ?? null;
}

/**
 * True when a userId may be used by the unauthenticated onboarding demo branch.
 * Restricts arbitrary userId injection to demo-scoped keys only.
 */
export function isDemoScopedUserId(userId: string): boolean {
  return userId === 'demo-user' || userId.startsWith('onboard-');
}
