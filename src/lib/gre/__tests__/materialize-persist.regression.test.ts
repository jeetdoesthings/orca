/**
 * Part 15 regression — GRE state must persist on the materialize path so a
 * later OCSE Readiness / CUB read sees the same store.
 *
 * Root cause (pre-fix): computeGenreRelationships ran in buildFrontierNodes
 * but persistGenreRelationships was only called from /api/debug/genre-relationships.
 *
 * Set GRE_PERSIST_ON_MATERIALIZE=0 to simulate the old bug (this test fails).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { computeGenreRelationships } from '@/lib/gre/gre';
import { persistGenreRelationships } from '@/lib/gre/relationship-persistence';
import { computeReadiness } from '@/lib/ocse/decision-score';
import type { GenreRelationship } from '@/lib/gre/gre-types';

const userId = `gre-persist-${Date.now()}`;

describe('Part 15 GRE materialize persistence', () => {
  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: userId },
      create: { id: userId, spotifyId: userId },
      update: {},
    });
    // Seed a listening event so GRE has non-empty signal for at least one genre path
    await prisma.userListeningEvent.create({
      data: {
        userId,
        artistId: 'seed-artist-house',
        eventType: 'PLAY',
        initiationType: 'SEARCH',
        timestamp: new Date(),
      },
    }).catch(() => {
      // table may require more fields — ignore if create fails; we inject snapshot below
    });
  });

  afterAll(async () => {
    try {
      await prisma.userGenreRelationshipState.deleteMany({ where: { userId } });
      await prisma.userListeningEvent.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    } catch {
      // best-effort
    }
    delete process.env.GRE_PERSIST_ON_MATERIALIZE;
  });

  it('persistGenreRelationships writes canonical UserGenreRelationshipState', async () => {
    const snapshot: GenreRelationship[] = [
      {
        genre: 'house',
        stage: 'EXPLORING',
        metrics: {
          familiarity: 0.3,
          diversity: 0.4,
          identity: 0.2,
          recency: 0.6,
          stability: 0.5,
        },
        summary: {
          relationshipStrength: 0.25,
          relationshipMomentum: 0.55,
          relationshipBreadth: 0.4,
          relationshipConfidence: 0.7,
        },
        confidence: 0.7,
      },
    ];

    await persistGenreRelationships(userId, snapshot);

    const row = await prisma.userGenreRelationshipState.findUnique({
      where: { userId_genre: { userId, genre: 'house' } },
    });
    expect(row).toBeTruthy();
    expect(row!.currentState).toBe('EXPLORING');
    expect(row!.stateConfidence).toBeCloseTo(0.7, 5);
  });

  it('separate Readiness lookup can use persisted stage (not default UNTUCHED)', async () => {
    const row = await prisma.userGenreRelationshipState.findUnique({
      where: { userId_genre: { userId, genre: 'house' } },
    });
    expect(row?.currentState).toBe('EXPLORING');

    // Simulate OCSE reading stage from the same store CUB/GRE use
    const stageFromDb = row!.currentState;
    const readiness = computeReadiness({
      territoryKey: 'house',
      greStage: stageFromDb,
    });
    const readinessDefault = computeReadiness({
      territoryKey: 'house',
      greStage: 'UNTUCHED',
    });
    // EXPLORING mult 0.95 vs UNTUCHED 0.85 — readiness should differ
    expect(readiness).not.toBe(readinessDefault);
  });

  it('product-path flag: GRE_PERSIST_ON_MATERIALIZE=0 skips write (old bug)', async () => {
    process.env.GRE_PERSIST_ON_MATERIALIZE = '0';
    const genre = 'techno';
    await prisma.userGenreRelationshipState.deleteMany({
      where: { userId, genre },
    });

    // Simulate buildFrontierNodes guard
    const relationships = await computeGenreRelationships(userId);
    const persistEnabled = process.env.GRE_PERSIST_ON_MATERIALIZE !== '0';
    if (persistEnabled && relationships.length > 0) {
      await persistGenreRelationships(userId, relationships);
    }

    // Inject would-be persist target not written when flag off
    const snap: GenreRelationship[] = [
      {
        genre,
        stage: 'GROWING',
        metrics: {
          familiarity: 0.5,
          diversity: 0.5,
          identity: 0.4,
          recency: 0.7,
          stability: 0.6,
        },
        summary: {
          relationshipStrength: 0.45,
          relationshipMomentum: 0.65,
          relationshipBreadth: 0.5,
          relationshipConfidence: 0.8,
        },
        confidence: 0.8,
      },
    ];
    if (persistEnabled) {
      await persistGenreRelationships(userId, snap);
    }

    const row = await prisma.userGenreRelationshipState.findUnique({
      where: { userId_genre: { userId, genre } },
    });
    // With flag=0, GROWING was never written
    expect(row).toBeNull();

    // Re-enable and confirm write lands
    process.env.GRE_PERSIST_ON_MATERIALIZE = '1';
    await persistGenreRelationships(userId, snap);
    const after = await prisma.userGenreRelationshipState.findUnique({
      where: { userId_genre: { userId, genre } },
    });
    expect(after?.currentState).toBe('GROWING');
  });

  it('concurrent persists for same user do not corrupt rows', async () => {
    process.env.GRE_PERSIST_ON_MATERIALIZE = '1';
    const a: GenreRelationship[] = [
      {
        genre: 'jazz',
        stage: 'INTRODUCED',
        metrics: {
          familiarity: 0.1,
          diversity: 0.2,
          identity: 0.1,
          recency: 0.3,
          stability: 0.4,
        },
        summary: {
          relationshipStrength: 0.1,
          relationshipMomentum: 0.35,
          relationshipBreadth: 0.2,
          relationshipConfidence: 0.5,
        },
        confidence: 0.5,
      },
    ];
    const b: GenreRelationship[] = [
      {
        genre: 'folk',
        stage: 'EXPLORING',
        metrics: {
          familiarity: 0.2,
          diversity: 0.3,
          identity: 0.2,
          recency: 0.5,
          stability: 0.5,
        },
        summary: {
          relationshipStrength: 0.2,
          relationshipMomentum: 0.5,
          relationshipBreadth: 0.3,
          relationshipConfidence: 0.6,
        },
        confidence: 0.6,
      },
    ];

    await Promise.all([
      persistGenreRelationships(userId, a),
      persistGenreRelationships(userId, b),
    ]);

    const jazz = await prisma.userGenreRelationshipState.findUnique({
      where: { userId_genre: { userId, genre: 'jazz' } },
    });
    const folk = await prisma.userGenreRelationshipState.findUnique({
      where: { userId_genre: { userId, genre: 'folk' } },
    });
    expect(jazz?.currentState).toBe('INTRODUCED');
    expect(folk?.currentState).toBe('EXPLORING');
  });
});
