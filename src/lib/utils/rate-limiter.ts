export class TokenBucketLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private maxTokens: number,
    private refillRate: number, // tokens per second
    private refillInterval: number = 1000 // ms
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  /**
   * Acquire a token, waiting if necessary.
   * @param timeoutMs - Max wait time. Pass undefined to block indefinitely.
   *                   Pass 0 for non-blocking (returns false).
   * @returns true if token acquired, false if timed out (when timeoutMs=0).
   * @throws Error if waited longer than timeoutMs.
   */
  async acquire(timeoutMs?: number): Promise<boolean> {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }

    // Non-blocking mode
    if (timeoutMs === 0) {
      return false;
    }

    const waitMs = ((1 - this.tokens) / this.refillRate) * 1000;
    if (timeoutMs != null && waitMs > timeoutMs) {
      throw new Error(`Rate limit wait (${Math.round(waitMs)}ms) exceeds timeout (${timeoutMs}ms)`);
    }

    await new Promise(resolve => setTimeout(resolve, waitMs));
    return timeoutMs != null
      ? this.acquire(timeoutMs - waitMs)
      : this.acquire();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}

/**
 * Round-robin rate limiter across multiple identical token buckets.
 * With N buckets at 1 rps each, effective throughput is N rps.
 */
export class MultiKeyLimiter {
  private buckets: TokenBucketLimiter[];
  private next = 0;

  constructor(count: number, rps: number) {
    this.buckets = Array.from({ length: count }, () => new TokenBucketLimiter(1, rps));
  }

  /** Acquire a token from the next bucket in round-robin order. */
  async acquire(timeoutMs?: number): Promise<boolean> {
    const idx = this.next;
    this.next = (this.next + 1) % this.buckets.length;
    return this.buckets[idx].acquire(timeoutMs);
  }

  get bucketCount(): number {
    return this.buckets.length;
  }
}

/** Return configured MusicBrainz API keys. Empty array = anonymous (1 rps). */
export function getMusicBrainzApiKeys(): string[] {
  return [
    process.env.MUSICBRAINZ_API_KEY_1,
    process.env.MUSICBRAINZ_API_KEY_2,
    process.env.MUSICBRAINZ_API_KEY_3,
    process.env.MUSICBRAINZ_API_KEY_4,
  ].filter((k): k is string => Boolean(k));
}

function createMusicBrainzLimiter(): MultiKeyLimiter {
  return new MultiKeyLimiter(getMusicBrainzApiKeys().length || 1, 1);
}

// Instantiate rate limiters in accordance with Section 6 of Production technical specs
export const spotifyLimiter = new TokenBucketLimiter(3, 3);
export const lastfmLimiter = new TokenBucketLimiter(5, 5);
/** MusicBrainz multi-key round-robin: use up to 4 API keys for 4 rps effective throughput. */
export const musicbrainzLimiter = createMusicBrainzLimiter();
export const discogsLimiter = new TokenBucketLimiter(1, 1);
/** Deezer public API — conservative bucket (no official hard limit documented). */
export const deezerLimiter = new TokenBucketLimiter(5, 5);
/** Wikipedia/Wikidata API — keep it polite (1 rps; no documented strict limit). */
export const wikipediaLimiter = new TokenBucketLimiter(1, 1);