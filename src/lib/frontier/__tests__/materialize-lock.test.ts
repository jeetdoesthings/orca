/**
 * Audit fix H2 tests: materializeWorldDeduped dedupes concurrent runs and
 * honors the fresh-COMPUTING cross-instance guard.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const materializeWorld = vi.fn();
const readWorldState = vi.fn();
const userFindUnique = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => userFindUnique(...args),
    },
  },
}));

vi.mock('@/lib/frontier/pipeline-runner', () => ({
  materializeWorld: (...args: unknown[]) => materializeWorld(...args),
}));

vi.mock('@/lib/frontier/world-state-store', () => ({
  readWorldState: (...args: unknown[]) => readWorldState(...args),
}));

import { materializeWorldDeduped } from '@/lib/frontier/materialize-lock';

describe('materializeWorldDeduped', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dedupes concurrent runs for the same user', async () => {
    userFindUnique.mockResolvedValue({ frontierStatus: 'PENDING', updatedAt: new Date() });
    let resolveRun: (v: unknown) => void;
    materializeWorld.mockReturnValue(
      new Promise((res) => {
        resolveRun = res;
      }),
    );

    const p1 = materializeWorldDeduped('user-1', {});
    const p2 = materializeWorldDeduped('user-1', {});
    // Let the inner IIFE pass its prisma lookup and reach materializeWorld.
    await Promise.resolve();
    await Promise.resolve();
    expect(materializeWorld).toHaveBeenCalledTimes(1);

    resolveRun!({ frontierNodes: [], worldState: { snapshotVersion: 1 } });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual(r2);
  });

  it('returns the cached world when another instance is fresh-COMPUTING', async () => {
    const fresh = new Date(Date.now() - 30_000); // 30s ago
    userFindUnique.mockResolvedValue({ frontierStatus: 'COMPUTING', updatedAt: fresh });
    readWorldState.mockResolvedValue({
      lastNodes: [{ id: 'n1' }],
      snapshotVersion: 7,
    });

    const result = await materializeWorldDeduped('user-2', {});
    expect(result.worldState.snapshotVersion).toBe(7);
    expect(materializeWorld).not.toHaveBeenCalled();
  });

  it('starts a fresh run when COMPUTING is stale', async () => {
    const stale = new Date(Date.now() - 30 * 60 * 1000); // 30 min ago
    userFindUnique.mockResolvedValue({ frontierStatus: 'COMPUTING', updatedAt: stale });
    materializeWorld.mockResolvedValue({
      frontierNodes: [],
      worldState: { snapshotVersion: 8 },
    });

    const result = await materializeWorldDeduped('user-3', {});
    expect(materializeWorld).toHaveBeenCalledTimes(1);
    expect(result.worldState.snapshotVersion).toBe(8);
  });

  it('runs normally for a PENDING user', async () => {
    userFindUnique.mockResolvedValue({ frontierStatus: 'PENDING', updatedAt: new Date() });
    materializeWorld.mockResolvedValue({
      frontierNodes: [],
      worldState: { snapshotVersion: 9 },
    });

    const result = await materializeWorldDeduped('user-4', {});
    expect(materializeWorld).toHaveBeenCalledTimes(1);
    expect(result.worldState.snapshotVersion).toBe(9);
  });

  it('clears the in-flight entry after completion', async () => {
    userFindUnique.mockResolvedValue({ frontierStatus: 'PENDING', updatedAt: new Date() });
    materializeWorld.mockResolvedValue({
      frontierNodes: [],
      worldState: { snapshotVersion: 10 },
    });

    await materializeWorldDeduped('user-5', {});
    await materializeWorldDeduped('user-5', {});
    expect(materializeWorld).toHaveBeenCalledTimes(2);
  });
});
