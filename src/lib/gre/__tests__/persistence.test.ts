/**
 * INV-1 (single writer per field) — GRE persistence layer.
 *
 * Phase 2 P0-2 (Option C.ii) retargets GRE persistence from
 * `userTerritoryRelationship` (now owned solely by Layer 6) to the new
 * `userGenreRelationshipState` table. These tests pin that retarget so a
 * future regression can't silently reintroduce vocabulary contamination.
 *
 * The mock prisma records every model call; the tests assert:
 *   1. `userTerritoryRelationship` is NEVER written (no upsert/create/update).
 *   2. `relationshipTransition` and `relationshipExplanation` are NEVER written
 *      by GRE (they are now Layer-6-only shared tables).
 *   3. `userGenreRelationshipState` IS upserted, keyed by raw genre, once per
 *      snapshot entry — and carries GRE's 7-state vocabulary.
 *
 * No real database is touched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Build a recording mock of the prisma surface this module touches.
// Each model gets an object of spies; calls are recorded in `calls`.
function makeRecordingPrisma() {
  const calls: Array<{ model: string; op: string; args: any }> = [];
  const modelNames = [
    'userGenreRelationshipState',
    'userTerritoryRelationship',
    'relationshipTransition',
    'relationshipExplanation',
  ];
  const prisma: any = {
    calls,
    $transaction: async (fn: any) => fn(txProxy),
  };
  const txProxy: any = {};
  for (const m of modelNames) {
    const recorder = {
      upsert: vi.fn((args: any) => { calls.push({ model: m, op: 'upsert', args }); return Promise.resolve({}); }),
      create: vi.fn((args: any) => { calls.push({ model: m, op: 'create', args }); return Promise.resolve({}); }),
      update: vi.fn((args: any) => { calls.push({ model: m, op: 'update', args }); return Promise.resolve({}); }),
      deleteMany: vi.fn((args: any) => { calls.push({ model: m, op: 'deleteMany', args }); return Promise.resolve({ count: 0 }); }),
      findMany: vi.fn((args: any) => { calls.push({ model: m, op: 'findMany', args }); return Promise.resolve([]); }),
    };
    prisma[m] = recorder;
    txProxy[m] = recorder;
  }
  return prisma;
}

vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return (globalThis as any).__recordingPrisma;
  },
}));

// Import AFTER the mock is registered.
import { persistGenreRelationships } from '@/lib/gre/relationship-persistence';
import type { GenreRelationship } from '@/lib/gre/gre-types';

function makeRel(overrides: Partial<GenreRelationship> = {}): GenreRelationship {
  return {
    genre: 'house',
    stage: 'EXPLORING',
    metrics: { familiarity: 0.4, diversity: 0.6, identity: 0.5, recency: 0.7, stability: 0.3 },
    summary: { relationshipStrength: 0.5, relationshipMomentum: 0.5, relationshipBreadth: 0.6, relationshipConfidence: 0.6 },
    confidence: 0.55,
    ...overrides,
  };
}

describe('persistGenreRelationships — INV-1 single writer (P0-2)', () => {
  beforeEach(() => {
    (globalThis as any).__recordingPrisma = makeRecordingPrisma();
  });

  it('writes ONLY to userGenreRelationshipState, never userTerritoryRelationship', async () => {
    await persistGenreRelationships('user-1', [makeRel({ genre: 'house' }), makeRel({ genre: 'techno', stage: 'GROWING' })]);

    const prisma = (globalThis as any).__recordingPrisma;
    const writes = prisma.calls.filter((c: any) => ['upsert', 'create', 'update'].includes(c.op));

    const territoryWrites = writes.filter((c: any) => c.model === 'userTerritoryRelationship');
    const genreWrites = writes.filter((c: any) => c.model === 'userGenreRelationshipState');

    expect(territoryWrites).toHaveLength(0);
    expect(genreWrites.length).toBe(2);
  });

  it('never writes relationshipTransition or relationshipExplanation', async () => {
    // Pre-P0-2, GRE wrote both of these shared tables. They are now Layer-6-only.
    await persistGenreRelationships('user-1', [makeRel()]);

    const prisma = (globalThis as any).__recordingPrisma;
    const writes = prisma.calls.filter((c: any) =>
      ['relationshipTransition', 'relationshipExplanation'].includes(c.model) &&
      ['upsert', 'create', 'update'].includes(c.op),
    );
    expect(writes).toHaveLength(0);
  });

  it('upserts userGenreRelationshipState keyed by (userId, genre) with GRE vocabulary', async () => {
    await persistGenreRelationships('user-1', [makeRel({ genre: 'techno', stage: 'INTEGRATED', confidence: 0.9 })]);

    const prisma = (globalThis as any).__recordingPrisma;
    const genreUpserts = prisma.calls.filter(
      (c: any) => c.model === 'userGenreRelationshipState' && c.op === 'upsert',
    );
    expect(genreUpserts).toHaveLength(1);

    const upsert = genreUpserts[0].args;
    // The where-clause uses Prisma's compound unique key name userId_genre.
    expect(upsert.where.userId_genre).toEqual({ userId: 'user-1', genre: 'techno' });
    expect(upsert.create.currentState).toBe('INTEGRATED'); // GRE 7-state, not Layer 6's 10-state
    expect(upsert.create.stateConfidence).toBe(0.9);
    expect(upsert.create.genre).toBe('techno');
  });

  it('reads existing state from userGenreRelationshipState, not userTerritoryRelationship', async () => {
    await persistGenreRelationships('user-1', [makeRel()]);

    const prisma = (globalThis as any).__recordingPrisma;
    const reads = prisma.calls.filter((c: any) => c.op === 'findMany');
    const genreRead = reads.find((c: any) => c.model === 'userGenreRelationshipState');
    const territoryRead = reads.find((c: any) => c.model === 'userTerritoryRelationship');

    expect(genreRead).toBeDefined();
    expect(territoryRead).toBeUndefined();
  });

  it('records previousStage from existing rows for transition detection', async () => {
    // Seed the findMany mock to return a prior state.
    const prisma = makeRecordingPrisma();
    prisma.userGenreRelationshipState.findMany.mockResolvedValue([
      { genre: 'house', currentState: 'INTRODUCED', lastUpdatedAt: new Date('2026-01-01') },
    ]);
    (globalThis as any).__recordingPrisma = prisma;

    await persistGenreRelationships('user-1', [makeRel({ genre: 'house', stage: 'GROWING' })]);

    const upsert = prisma.calls.find(
      (c: any) => c.model === 'userGenreRelationshipState' && c.op === 'upsert',
    ).args;
    expect(upsert.create.previousStage).toBe('INTRODUCED');
    expect(upsert.update.previousStage).toBe('INTRODUCED');
  });
});
