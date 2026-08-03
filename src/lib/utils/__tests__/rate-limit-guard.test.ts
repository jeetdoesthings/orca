import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit, clearRateLimits } from '@/lib/utils/rate-limit-guard';

describe('rate-limit-guard', () => {
  beforeEach(() => clearRateLimits());

  it('allows requests under the limit', () => {
    expect(checkRateLimit('user:a', 3, 1000).allowed).toBe(true);
    expect(checkRateLimit('user:a', 3, 1000).allowed).toBe(true);
    expect(checkRateLimit('user:a', 3, 1000).allowed).toBe(true);
  });

  it('rejects over the limit with retry-after', () => {
    checkRateLimit('user:b', 2, 1000);
    checkRateLimit('user:b', 2, 1000);
    const third = checkRateLimit('user:b', 2, 1000);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSec).toBeGreaterThan(0);
  });

  it('resets after the window elapses', () => {
    checkRateLimit('user:c', 1, 1000);
    expect(checkRateLimit('user:c', 1, 1000).allowed).toBe(false);
    // 61s later the window resets.
    expect(checkRateLimit('user:c', 1, 1000 + 61_000).allowed).toBe(true);
  });

  it('keys are isolated per user', () => {
    checkRateLimit('user:d', 1, 1000);
    expect(checkRateLimit('user:e', 1, 1000).allowed).toBe(true);
  });
});
