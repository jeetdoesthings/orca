/**
 * Audit fix H1 tests: demo resolution must never fall back to a real user and
 * must be gated behind ENABLE_DEMO.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from '@/lib/prisma';
import {
  isDemoEnabled,
  isDemoScopedUserId,
  resolveDemoUser,
} from '@/lib/auth/demo-user';

const findFirstMock = prisma.user.findFirst as ReturnType<typeof vi.fn>;

describe('demo-user gate', () => {
  const original = process.env.ENABLE_DEMO;

  beforeEach(() => {
    findFirstMock.mockReset();
    if (original === undefined) delete process.env.ENABLE_DEMO;
    else process.env.ENABLE_DEMO = original;
  });

  it('isDemoEnabled is true only when ENABLE_DEMO=1', () => {
    process.env.ENABLE_DEMO = '1';
    expect(isDemoEnabled()).toBe(true);
    process.env.ENABLE_DEMO = '0';
    expect(isDemoEnabled()).toBe(false);
    delete process.env.ENABLE_DEMO;
    expect(isDemoEnabled()).toBe(false);
  });

  it('resolveDemoUser returns null when demo is disabled and never queries', async () => {
    process.env.ENABLE_DEMO = '0';
    expect(await resolveDemoUser()).toBeNull();
    expect(findFirstMock).not.toHaveBeenCalled();
  });

  it('resolveDemoUser returns the demo-user spotifyId when present and complete', async () => {
    process.env.ENABLE_DEMO = '1';
    findFirstMock.mockResolvedValue({ spotifyId: 'demo-user' });
    expect(await resolveDemoUser()).toBe('demo-user');
    expect(findFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ spotifyId: 'demo-user' }),
      }),
    );
  });

  it('resolveDemoUser returns null when demo-user is missing or not complete', async () => {
    process.env.ENABLE_DEMO = '1';
    findFirstMock.mockResolvedValue(null);
    expect(await resolveDemoUser()).toBeNull();
  });

  it('isDemoScopedUserId accepts only demo keys', () => {
    expect(isDemoScopedUserId('demo-user')).toBe(true);
    expect(isDemoScopedUserId('onboard-demo-123')).toBe(true);
    expect(isDemoScopedUserId('onboard-someuser')).toBe(true);
    expect(isDemoScopedUserId('spotify-abc123realuser')).toBe(false);
    expect(isDemoScopedUserId('clx1234realcuid')).toBe(false);
  });
});
