/**
 * Audit fix tests: timing-safe admin auth comparison.
 */
import { describe, it, expect } from 'vitest';
import { safeEqual } from '@/lib/auth/admin-auth';

describe('safeEqual', () => {
  it('returns true for identical strings', () => {
    expect(safeEqual('secret-token', 'secret-token')).toBe(true);
  });

  it('returns false for different strings', () => {
    expect(safeEqual('secret-token', 'other-token')).toBe(false);
  });

  it('returns false for different lengths without throwing', () => {
    expect(safeEqual('a', 'a-much-longer-token')).toBe(false);
    expect(safeEqual('', 'x')).toBe(false);
  });

  it('handles empty strings', () => {
    expect(safeEqual('', '')).toBe(true);
  });
});
