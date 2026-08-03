/**
 * Lightweight per-user rate limiting for expensive pipeline endpoints.
 *
 * Serverless-safe: in-memory fixed window per instance. Not a substitute for
 * a real distributed limiter (Vercel KV / Upstash), but blocks the common
 * client double-fire and accidental hammering cases. Each instance enforces
 * its own window, so the real ceiling is instances × limit — acceptable for
 * the current deployment.
 */

const windows = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60 * 1000;
const MAX_WINDOW_ENTRIES = 5000;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec: number;
}

export function checkRateLimit(
  key: string,
  maxPerMinute: number,
  now: number = Date.now(),
): RateLimitResult {
  // Evict expired entries opportunistically to bound memory.
  if (windows.size > MAX_WINDOW_ENTRIES) {
    for (const [k, v] of windows) {
      if (v.resetAt <= now) windows.delete(k);
      if (windows.size <= MAX_WINDOW_ENTRIES / 2) break;
    }
  }

  const entry = windows.get(key);
  if (!entry || entry.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfterSec: 0 };
  }

  if (entry.count >= maxPerMinute) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  }

  entry.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

/** Clear all windows (tests). */
export function clearRateLimits(): void {
  windows.clear();
}
