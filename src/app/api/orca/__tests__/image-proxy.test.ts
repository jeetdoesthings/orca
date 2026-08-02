/**
 * Audit fix M1 tests: image proxy validators.
 */
import { describe, it, expect } from 'vitest';
import {
  isAllowedDomain,
  isImageContentType,
  MAX_IMAGE_BYTES,
} from '@/app/api/orca/image-proxy/route';

describe('image proxy validators', () => {
  it('allows allow-listed image hosts and subdomains', () => {
    expect(isAllowedDomain('https://i.scdn.co/image/abc')).toBe(true);
    expect(isAllowedDomain('https://e-cdns-images.dzcdn.net/images/abc.jpg')).toBe(true);
    expect(isAllowedDomain('https://upload.wikimedia.org/wikipedia/commons/x.png')).toBe(true);
  });

  it('rejects non-allow-listed hosts', () => {
    expect(isAllowedDomain('https://evil.example.com/x.png')).toBe(false);
    expect(isAllowedDomain('https://i.scdn.co.evil.com/x.png')).toBe(false);
    expect(isAllowedDomain('not a url')).toBe(false);
  });

  it('accepts image content types only', () => {
    expect(isImageContentType('image/jpeg')).toBe(true);
    expect(isImageContentType('IMAGE/PNG')).toBe(true);
    expect(isImageContentType('image/svg+xml')).toBe(true);
    expect(isImageContentType('text/html')).toBe(false);
    expect(isImageContentType('application/json')).toBe(false);
    expect(isImageContentType('')).toBe(false);
    expect(isImageContentType(null)).toBe(false);
  });

  it('caps proxied images at 5MB', () => {
    expect(MAX_IMAGE_BYTES).toBe(5 * 1024 * 1024);
  });
});
