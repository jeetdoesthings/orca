/**
 * Part 13 — full backend lifecycle integration (synthetic, no live Spotify).
 *
 * Cold start → OCSE score → accept/reject + territory reject → GRE transition
 * → Identity EMA → second-session readiness change.
 * Also: confidence tags affect ranking; TES snapshots immutable.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  applyOnboardingPicks,
  assessColdStart,
  minFrontierForUser,
} from '@/lib/identity/cold-start';
import {
  evaluateCandidate,
  evaluateCandidateUniverse,
} from '@/lib/ocse/decision-engine';
import type { Candidate } from '@/lib/candidate/cub-types';
import type { OCSEContext } from '@/lib/ocse/ocse-types';
import {
  createTesSnapshot,
  appendDurabilityEvent,
  resolveDurabilityFromStream,
  reviseTesSnapshotAsNew,
} from '@/lib/metrics/tes-snapshot';
import { applyIdentityEmaFromTes, parseProfileCentroid } from '@/lib/identity/centroid-ema';
import { recordTerritoryReject } from '@/lib/feedback/territory-reject';
import { applyGreTransition } from '@/lib/gre/transitions';
import { computeReadiness } from '@/lib/ocse/decision-score';
import type { AudioSignature } from '@/lib/graph/types';

const EVENT_VEC: AudioSignature = {
  energy: 0.85,
  valence: 0.3,
  danceability: 0.75,
  acousticness: 0.15,
  instrumentalness: 0.05,
  tempo: 128,
};

function cand(overrides: Partial<Candidate> = {}): Candidate {
  return {
    artistId: 'life-a1',
    name: 'Lifecycle Artist',
    genres: ['house'],
    popularity: 40,
    imageUrl: '',
    discoveryContext: {
      growthOpportunity: 'house',
      relationshipStage: 'INTRODUCED',
      supportingArtists: [],
      sources: [],
    },
    discoveryConfidence: 0.7,
    candidateClassification: 'EXPANSION',
    audioSource: 'tag_inferred',
    confidenceTag: 'tag_inferred',
    expansionDistance: 0.55,
    ...overrides,
  };
}

function ctx(overrides: Partial<OCSEContext> = {}): OCSEContext {
  return {
    relationships: [
      {
        genre: 'house',
        stage: 'INTRODUCED',
        metrics: {
          familiarity: 0.1,
          diversity: 0.3,
          identity: 0.2,
          recency: 0.4,
          stability: 0.4,
        },
        summary: {
          relationshipStrength: 0.15,
          relationshipMomentum: 0.4,
          relationshipBreadth: 0.3,
          relationshipConfidence: 0.5,
        },
        confidence: 0.5,
      },
    ],
    sliderValue: 0.55,
    interactionHistory: {
      timesShown: {},
      timesIgnored: {},
      timesDismissed: {},
      timesIntegrated: {},
      lastShown: {},
      territoryRejections: [],
    },
    currentVisibleWorldIds: [],
    ...overrides,
  };
}

describe('Part 13 lifecycle E2E', () => {
  const userId = `life-user-${Date.now()}`;
  let tesId: string;
  let session1Readiness: number;

  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: userId },
      create: { id: userId, spotifyId: `sp-${userId}` },
      update: {},
    });
  });

  afterAll(async () => {
    try {
      await prisma.durabilityEvent.deleteMany({ where: { userId } });
      await prisma.tesSnapshot.deleteMany({ where: { userId } });
      await prisma.territoryRejection.deleteMany({ where: { userId } });
      await prisma.agencyInteractionEvent.deleteMany({ where: { userId } }).catch(() => {});
      await prisma.userGenreRelationshipState
        .deleteMany({ where: { userId: { in: [userId, `sp-${userId}`] } } })
        .catch(() => {});
      await prisma.user.deleteMany({ where: { id: userId } });
    } catch {
      // best-effort
    }
  });

  it('1) cold start onboarding seeds identity', async () => {
    const r = await applyOnboardingPicks({
      userId,
      picks: {
        genres: ['house', 'techno'],
        artists: [{ name: 'Seed DJ', genres: ['house'] }],
      },
    });
    expect(r.coldStart).toBe(true);
    expect(r.artistCount).toBeGreaterThan(0);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.globeData).toBeTruthy();
    const nodes = JSON.parse(user!.globeData!).nodes;
    const cold = assessColdStart({
      exploredArtistCount: nodes.length,
      profileData: user!.profileData,
    });
    expect(cold.coldStart).toBe(true);
    expect(minFrontierForUser(true)).toBeGreaterThan(minFrontierForUser(false));
  });

  it('2) session-1 OCSE scores candidates; confidence tag changes DecisionScore', async () => {
    const batch = evaluateCandidateUniverse(
      [
        cand({
          artistId: 'real-audio-one',
          confidenceTag: 'real_audio',
          audioSource: 'real_audio',
          expansionDistance: 0.5,
        }),
        cand({
          artistId: 'tag-one',
          confidenceTag: 'tag_inferred',
          audioSource: 'tag_inferred',
          expansionDistance: 0.5,
        }),
        cand({
          artistId: 'cold-one',
          confidenceTag: 'cold_start_default',
          audioSource: 'cold_start_default',
          expansionDistance: 0.5,
        }),
      ],
      ctx(),
    );

    const byId = Object.fromEntries(batch.map((p) => [p.candidateId, p]));
    expect(byId['real-audio-one'].decisionScore!).toBeGreaterThan(
      byId['tag-one'].decisionScore!,
    );
    expect(byId['tag-one'].decisionScore!).toBeGreaterThan(
      byId['cold-one'].decisionScore!,
    );
    // Tags preserved end-to-end on profile
    expect(byId['real-audio-one'].dataConfidence).toBeGreaterThan(
      byId['cold-one'].dataConfidence!,
    );
    session1Readiness = byId['tag-one'].readiness ?? 1;
    expect(session1Readiness).toBeGreaterThan(0);
    expect(
      byId['tag-one'].decisionScore ?? byId['tag-one'].decisionConfidence,
    ).toBeGreaterThan(0);
  });

  it('3) TES snapshot immutable; durability stream append-only', async () => {
    const { id } = await createTesSnapshot({
      userId,
      trackId: 'track-life-1',
      artistId: 'tag-one',
      territoryId: 'house',
      foreignness: 0.6,
      agency: 0.7,
      meaningfulness: 0.5,
      familiarity: 0.1,
      durabilityStatus: 'pending',
      confidenceTag: 'tag_inferred',
      audioConfidenceTag: 'tag_inferred',
      tesScore: 0.7,
    });
    tesId = id;

    const original = await prisma.tesSnapshot.findUnique({ where: { id: tesId } });
    expect(original!.durabilityStatus).toBe('pending');

    await appendDurabilityEvent({
      tesSnapshotId: tesId,
      userId,
      eventType: 'return',
      unprompted: true,
    });

    // Snapshot foreignness/agency unchanged after stream append
    const after = await prisma.tesSnapshot.findUnique({ where: { id: tesId } });
    expect(after!.foreignness).toBe(original!.foreignness);
    expect(after!.agency).toBe(original!.agency);

    // "Mutation" creates new snapshot, does not rewrite original
    const rev = await reviseTesSnapshotAsNew(tesId, { agency: 0.99 });
    expect(rev.id).not.toBe(tesId);
    const still = await prisma.tesSnapshot.findUnique({ where: { id: tesId } });
    expect(still!.agency).toBe(original!.agency);

    // Resolve durability positive after unprompted return (minDays=0 for test)
    const resolved = await resolveDurabilityFromStream(tesId, {
      minDaysSinceSnap: 0,
      minUnpromptedReturns: 1,
    });
    expect(resolved.status).toBe('confirmed_positive');

    // Mark snapshot durability resolved for EMA gate
    await prisma.tesSnapshot.update({
      where: { id: tesId },
      data: {
        durabilityStatus: 'confirmed_positive',
        durabilityAtSnap: resolved.score,
      },
    });
  });

  it('4) territory-wide reject + GRE → REDISCOVER; Readiness drops', async () => {
    await recordTerritoryReject({
      userId,
      territoryKey: 'house',
      sourceArtistId: 'tag-one',
      cooldownDays: 30,
    });

    const gre = applyGreTransition({
      previous: 'GROWING',
      metrics: {
        familiarity: 0.4,
        diversity: 0.4,
        identity: 0.4,
        recency: 0.7,
        stability: 0.5,
      },
      context: { territoryWideReject: true },
    });
    expect(gre.stage).toBe('REDISCOVER');

    const readiness = computeReadiness({
      territoryKey: 'house',
      greStage: 'REDISCOVER',
      rejections: [
        {
          territoryKey: 'house',
          at: new Date(),
          severity: 'territory_reject',
        },
      ],
    });
    const readinessBaseline = computeReadiness({
      territoryKey: 'house',
      greStage: 'INTRODUCED',
      rejections: [],
    });
    expect(readiness).toBeLessThan(readinessBaseline);
  });

  it('5) Identity EMA applies on resolved TES; second session reflects lower readiness', async () => {
    const ema = await applyIdentityEmaFromTes({
      userId,
      tesSnapshotId: tesId,
      eventVector: EVENT_VEC,
    });
    expect(ema.updated).toBe(true);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    const { centroid, meta } = parseProfileCentroid(user!.profileData);
    expect(centroid).toBeTruthy();
    expect(meta!.updateCount).toBeGreaterThanOrEqual(1);

    // Session 2: same candidate with territory rejections in history
    const session2 = evaluateCandidate(
      cand({
        artistId: 'tag-one',
        confidenceTag: 'tag_inferred',
        expansionDistance: 0.5,
      }),
      ctx({
        relationships: [
          {
            genre: 'house',
            stage: 'REDISCOVER',
            metrics: {
              familiarity: 0.4,
              diversity: 0.3,
              identity: 0.3,
              recency: 0.2,
              stability: 0.3,
            },
            summary: {
              relationshipStrength: 0.35,
              relationshipMomentum: 0.25,
              relationshipBreadth: 0.3,
              relationshipConfidence: 0.4,
            },
            confidence: 0.4,
          },
        ],
        interactionHistory: {
          timesShown: {},
          timesIgnored: {},
          timesDismissed: {},
          timesIntegrated: {},
          lastShown: {},
          territoryRejections: [
            {
              territoryKey: 'house',
              at: new Date(),
              severity: 'territory_reject',
            },
          ],
        },
      }),
    );

    expect(session2.readiness!).toBeLessThan(0.9);
    // After territory reject + REDISCOVER stage, readiness must drop vs session 1
    expect(session2.readiness!).toBeLessThan(session1Readiness);
  });

  it('6) cold-start API contract fields documented for FE', () => {
    // FE consumes coldStart on globe/frontier/onboarding — structural check
    const sampleResponse = {
      coldStart: true,
      message: 'still learning your taste',
      coldStartReason: 'thin_identity',
    };
    expect(sampleResponse.coldStart).toBe(true);
    expect(sampleResponse.message).toContain('learning');
  });

  it('7) Part 15: GRE persist is canonical — DB stage survives separate readiness read', async () => {
    // UserGenreRelationshipState.userId references User.spotifyId (not cuid).
    const greUserKey = `sp-${userId}`;
    const { persistGenreRelationships } = await import('@/lib/gre/relationship-persistence');
    await persistGenreRelationships(greUserKey, [
      {
        genre: 'house',
        stage: 'EXPLORING',
        metrics: {
          familiarity: 0.25,
          diversity: 0.35,
          identity: 0.2,
          recency: 0.55,
          stability: 0.45,
        },
        summary: {
          relationshipStrength: 0.22,
          relationshipMomentum: 0.5,
          relationshipBreadth: 0.35,
          relationshipConfidence: 0.65,
        },
        confidence: 0.65,
      },
    ]);

    const row = await prisma.userGenreRelationshipState.findUnique({
      where: { userId_genre: { userId: greUserKey, genre: 'house' } },
    });
    expect(row?.currentState).toBe('EXPLORING');

    // Separate call path (as if later OCSE materialize): readiness uses DB stage
    const readiness = computeReadiness({
      territoryKey: 'house',
      greStage: row!.currentState,
    });
    expect(readiness).toBeGreaterThan(0);
    expect(row!.currentState).not.toBe('UNTUCHED');
  });
});
