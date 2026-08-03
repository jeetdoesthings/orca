import { Observation } from './types';

/**
 * In-memory observation store (serverless-safe).
 * Previously used filesystem (.gemini/observations_<userId>.json), which breaks
 * on Vercel serverless (ephemeral filesystem, multi-instance divergence).
 *
 * Observations are transient — they have TTL and are recomputed from genre/node
 * state on each globe load. In-memory storage is sufficient for per-request
 * evaluation and short warm-instance lifetimes. Cross-instance persistence would
 * require a DB table, but the current design recomputes everything from scratch
 * each time anyway, so persistence only avoids duplicates within a session.
 */

const store = new Map<string, Observation[]>();

export function readObservations(userId: string): Observation[] {
  return store.get(userId) ?? [];
}

export function writeObservations(userId: string, items: Observation[]) {
  // Cap at 200 observations per user to prevent unbounded memory growth.
  const capped = items.slice(-200);
  store.set(userId, capped);
}

/** Clear observations for a user (useful for testing). */
export function clearObservations(userId: string): void {
  store.delete(userId);
}