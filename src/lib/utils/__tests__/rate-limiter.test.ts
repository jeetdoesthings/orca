/**
 * Audit fix H3 tests: token bucket limiter throttles and refills correctly.
 */
import { describe, it, expect } from 'vitest';
import { TokenBucketLimiter } from '@/lib/utils/rate-limiter';

function tick(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('TokenBucketLimiter', () => {
  it('allows burst up to maxTokens then throttles', async () => {
    const limiter = new TokenBucketLimiter(3, 3, 1000); // 3 tokens, refill 3/s
    const started = Date.now();
    // 5 acquires: 3 immediate, then 2 must wait for refill (~666ms).
    await Promise.all([0, 1, 2, 3, 4].map(() => limiter.acquire()));
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(600);
  });

  it('refills tokens over time', async () => {
    const limiter = new TokenBucketLimiter(1, 1, 1000);
    await limiter.acquire();
    // Exhausted — this must block ~1s for a refill.
    const started = Date.now();
    await limiter.acquire();
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  });

  it('never exceeds maxTokens after idle refill', async () => {
    const limiter = new TokenBucketLimiter(2, 10, 1000);
    await tick(300);
    // Long idle should cap at maxTokens = 2.
    const started = Date.now();
    await limiter.acquire();
    await limiter.acquire();
    // Third acquire after 2 immediate ones needs a refill (~100ms at 10/s).
    await limiter.acquire();
    expect(Date.now() - started).toBeGreaterThanOrEqual(80);
  });
});
