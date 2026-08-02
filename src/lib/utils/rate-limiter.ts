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

  async acquire(): Promise<void> {
    this.refill();

    if (this.tokens < 1) {
      const waitMs = ((1 - this.tokens) / this.refillRate) * 1000;
      await new Promise(resolve => setTimeout(resolve, waitMs));
      return this.acquire();
    }

    this.tokens -= 1;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}

// Instantiate rate limiters in accordance with Section 6 of Production technical specs
export const spotifyLimiter = new TokenBucketLimiter(3, 3);
export const lastfmLimiter = new TokenBucketLimiter(5, 5);
export const musicbrainzLimiter = new TokenBucketLimiter(1, 1);
export const discogsLimiter = new TokenBucketLimiter(1, 1);
/** Deezer public API — conservative bucket (no official hard limit documented). */
export const deezerLimiter = new TokenBucketLimiter(5, 5);
/** Wikipedia/Wikidata API — keep it polite (1 rps; no documented strict limit). */
export const wikipediaLimiter = new TokenBucketLimiter(1, 1);
