/**
 * Part 16 — concurrent write smoke (runs on current DATABASE_URL / SQLite or PG).
 * Parallel DurabilityEvent appends + GRE persists must not throw or lose rows.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { createTesSnapshot, appendDurabilityEvent } from '@/lib/metrics/tes-snapshot';
import { persistGenreRelationships } from '@/lib/gre/relationship-persistence';
import type { GenreRelationship } from '@/lib/gre/gre-types';

describe('concurrent writes smoke', () => {
  const users = Array.from({ length: 4 }, (_, i) => `conc-user-${Date.now()}-${i}`);

  beforeAll(async () => {
    for (const id of users) {
      await prisma.user.upsert({
        where: { id },
        create: { id, spotifyId: id },
        update: {},
      });
    }
  });

  afterAll(async () => {
    for (const id of users) {
      try {
        await prisma.durabilityEvent.deleteMany({ where: { userId: id } });
        await prisma.tesSnapshot.deleteMany({ where: { userId: id } });
        await prisma.userGenreRelationshipState.deleteMany({ where: { userId: id } });
        await prisma.user.deleteMany({ where: { id } });
      } catch {
        // best-effort
      }
    }
  });

  it('parallel DurabilityEvent appends for different users', async () => {
    const snaps = await Promise.all(
      users.map((userId) =>
        createTesSnapshot({
          userId,
          artistId: `a-${userId}`,
          foreignness: 0.5,
          agency: 0.5,
          tesScore: 0.4,
        }),
      ),
    );

    await Promise.all(
      snaps.map((s, i) =>
        Promise.all([
          appendDurabilityEvent({
            tesSnapshotId: s.id,
            userId: users[i],
            eventType: 'listen',
            unprompted: true,
          }),
          appendDurabilityEvent({
            tesSnapshotId: s.id,
            userId: users[i],
            eventType: 'return',
            unprompted: true,
          }),
        ]),
      ),
    );

    for (let i = 0; i < users.length; i++) {
      const n = await prisma.durabilityEvent.count({
        where: { tesSnapshotId: snaps[i].id },
      });
      expect(n).toBe(2);
    }
  });

  it('parallel GRE persists same user different genres', async () => {
    const userId = users[0];
    const mk = (genre: string, stage: string): GenreRelationship[] => [
      {
        genre,
        stage: stage as GenreRelationship['stage'],
        metrics: {
          familiarity: 0.2,
          diversity: 0.2,
          identity: 0.2,
          recency: 0.3,
          stability: 0.4,
        },
        summary: {
          relationshipStrength: 0.2,
          relationshipMomentum: 0.35,
          relationshipBreadth: 0.2,
          relationshipConfidence: 0.5,
        },
        confidence: 0.5,
      },
    ];

    await Promise.all([
      persistGenreRelationships(userId, mk('house', 'EXPLORING')),
      persistGenreRelationships(userId, mk('techno', 'INTRODUCED')),
      persistGenreRelationships(userId, mk('jazz', 'GROWING')),
    ]);

    const rows = await prisma.userGenreRelationshipState.findMany({
      where: { userId, genre: { in: ['house', 'techno', 'jazz'] } },
    });
    expect(rows.length).toBe(3);
    const byG = Object.fromEntries(rows.map((r: { genre: string; currentState: string }) => [r.genre, r.currentState]));
    expect(byG.house).toBe('EXPLORING');
    expect(byG.techno).toBe('INTRODUCED');
    expect(byG.jazz).toBe('GROWING');
  });
});
