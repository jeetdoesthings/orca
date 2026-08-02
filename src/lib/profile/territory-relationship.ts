/**
 * ORCA Taste Relationship States (Backend Layer 6)
 *
 * Classifies and tracks the evolving relationship state between a user and every territory.
 * State machine transition rules are based on occupancy, momentum, adoption, familiarity,
 * affinity, and session readiness/receptivity.
 */

import { prisma } from '@/lib/prisma';
import { clamp01 as clamp } from '@/lib/math';
import { computeUserInterventions } from './intervention-engine';

export interface RelationshipStrengths {
  residenceStrength: number;
  explorationStrength: number;
  curiosityStrength: number;
  resistanceStrength: number;
  dormancyStrength: number;
  returnStrength: number;
  emergenceStrength: number;
}

export type RelationshipState =
  | 'UNEXPLORED'
  | 'CURIOUS'
  | 'EXPLORING'
  | 'RESIDENT'
  | 'DORMANT'
  | 'RETURNING'
  | 'REJECTED'
  | 'RESISTANT'
  | 'STABILIZED'
  | 'EMERGING';

export interface UserTerritoryRelationshipResult {
  userId: string;
  territoryId: string;
  currentState: RelationshipState;
  stateConfidence: number;
  strengths: RelationshipStrengths;
  explanation: {
    summary: string;
    primaryDrivers: string[];
    reasons: string[];
  };
}



/**
 * Computes relationship states and strengths for every active territory for a user.
 *
 * @param userId - Spotify ID of the user
 * @returns Array of relationship result objects
 */
export async function computeUserTerritoryRelationships(userId: string): Promise<UserTerritoryRelationshipResult[]> {
  console.log(`[Layer 6] Starting relationship computations for user ${userId}...`);

  // 1. Fetch User profile (to get overall readiness)
  const user = await prisma.user.findUnique({
    where: { spotifyId: userId },
    select: { profileData: true },
  });

  if (!user) {
    console.warn(`[Layer 6] User ${userId} not found.`);
    return [];
  }

  let overallReadiness = 0.5; // fallback
  if (user.profileData) {
    try {
      const profile = JSON.parse(user.profileData);
      overallReadiness = profile.discoveryProfile?.overallReadiness ?? 0.5;
    } catch {}
  }

  // 2. Fetch active version territories
  const maxVersionRecord = await prisma.territory.findFirst({
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const activeVersion = maxVersionRecord?.version || 1;

  const territories = await prisma.territory.findMany({
    where: { version: activeVersion },
    select: { id: true, metadata: true },
  });

  if (territories.length === 0) {
    console.warn(`[Layer 6] No territories found for version ${activeVersion}.`);
    return [];
  }

  // 3. Fetch User Territory Profile (occupancies)
  const utProfile = await prisma.userTerritoryProfile.findUnique({
    where: { userId },
  });

  let occupancyShortMap: Record<string, number> = {};
  let occupancyMediumMap: Record<string, number> = {};
  let occupancyLongMap: Record<string, number> = {};

  if (utProfile) {
    try {
      const parsed = JSON.parse(utProfile.occupancyVector);
      occupancyShortMap = parsed.shortTerm || {};
      occupancyMediumMap = parsed.mediumTerm || {};
      occupancyLongMap = parsed.longTerm || {};
    } catch {}
  }

  // 4. Fetch related metrics: Momentum, Adoption, Familiarity, Affinities
  const momentums = await prisma.territoryMomentum.findMany({ where: { userId } });
  const adoptions = await prisma.territoryAdoption.findMany({ where: { userId } });
  const familiarities = await prisma.territoryFamiliarity.findMany({ where: { userId } });
  const affinities = await prisma.userTerritoryAffinity.findMany({ where: { userId } });
  const existingRelationships = await prisma.userTerritoryRelationship.findMany({ where: { userId } });

  // Map for fast lookups
  const momentumMap = new Map<string, any>(momentums.map((m: any) => [m.territoryId, m]));
  const adoptionMap = new Map<string, any>(adoptions.map((a: any) => [a.territoryId, a]));
  const familiarityMap = new Map<string, any>(familiarities.map((f: any) => [f.territoryId, f]));
  const affinityMap = new Map<string, any>(affinities.map((a: any) => [a.territoryId, a]));
  const relMap = new Map<string, any>(existingRelationships.map((r: any) => [r.territoryId, r]));

  const results: UserTerritoryRelationshipResult[] = [];

  for (const T of territories) {
    const tId = T.id;
    const displayName = (() => {
      try {
        const meta = JSON.parse(T.metadata || '{}');
        return meta.displayName || tId;
      } catch {
        return tId;
      }
    })();

    // Resolve inputs
    const occShort = occupancyShortMap[tId] || 0.0;
    const occMedium = occupancyMediumMap[tId] || 0.0;
    const occLong = occupancyLongMap[tId] || 0.0;

    const momentum = momentumMap.get(tId) || { delta: 0.0, velocity: 0.0 };
    const adoption = adoptionMap.get(tId) || { explorationCount: 0, adoptionScore: 0.0, lastActivity: new Date(0) };
    const familiarity = familiarityMap.get(tId) || { familiarityScore: 0.0, confidence: 0.0 };
    const affinity = affinityMap.get(tId) || { compatibilityScore: 0.0, accessibility: 0.5, confidence: 0.5 };

    const lastActivity = adoption.lastActivity;
    const daysSinceLastActivity = lastActivity && lastActivity.getTime() > 0
      ? (Date.now() - lastActivity.getTime()) / (1000 * 60 * 60 * 24)
      : Infinity;

    const recencyScore = daysSinceLastActivity < Infinity
      ? clamp(1.0 - daysSinceLastActivity / 30)
      : 0.0;

    const ageScore = daysSinceLastActivity < Infinity
      ? clamp(daysSinceLastActivity / 14)
      : 1.0;

    // ─── Mathematical Strengths ──────────────────────────────────────

    // 1. Residence Strength: stable part of taste identity
    const residenceStrength = clamp(
      0.3 * occLong +
      0.4 * familiarity.familiarityScore +
      0.3 * adoption.adoptionScore
    );

    // 2. Exploration Strength: actively trying/experimental listening
    const normExplorationCount = clamp(adoption.explorationCount / 5);
    const explorationStrength = clamp(
      0.4 * normExplorationCount +
      0.3 * occShort +
      0.3 * recencyScore
    );

    // 3. Curiosity Strength: potential interest and accessibility but low residence
    const curiosityStrength = clamp(
      (0.4 * affinity.compatibilityScore +
       0.3 * affinity.accessibility +
       0.3 * overallReadiness) *
      (1.0 - residenceStrength)
    );

    // 4. Resistance Strength: user bounces off despite suitability
    const resistanceStrength = clamp(
      clamp(affinity.compatibilityScore - residenceStrength) *
      clamp(adoption.explorationCount / 2) *
      (1.0 - occShort) *
      (1.0 - recencyScore)
    );

    // 5. Dormancy Strength: used to listen, now inactive
    const pastDormancyStrength = clamp(
      0.7 * familiarity.familiarityScore +
      0.3 * adoption.adoptionScore
    );

    const dormancyStrength = clamp(
      pastDormancyStrength *
      (1.0 - occShort) *
      ageScore
    );

    // 6. Return Strength: dormant territory resurfacing with positive signs
    const returnStrength = clamp(
      pastDormancyStrength *
      clamp(momentum.delta * 5.0) *
      recencyScore
    );

    // 7. Emergence Strength: rapid growth from a low baseline
    const emergenceStrength = clamp(
      clamp(momentum.velocity * 10) *
      (1.0 - occLong)
    );

    // ─── State Machine Classification ────────────────────────────────

    let state: RelationshipState = 'UNEXPLORED';

    if (occMedium === 0 && adoption.explorationCount === 0 && curiosityStrength <= 0.4) {
      state = 'UNEXPLORED';
    } else if (occMedium <= 0.05 && adoption.explorationCount === 0 && curiosityStrength > 0.4 && emergenceStrength < 0.4) {
      state = 'CURIOUS';
    } else if (resistanceStrength > 0.5 && occShort === 0 && adoption.explorationCount > 0) {
      state = 'REJECTED';
    } else if (resistanceStrength > 0.3 && occShort > 0 && adoption.explorationCount > 0) {
      state = 'RESISTANT';
    } else if (dormancyStrength > 0.5 && returnStrength <= 0.2 && occShort < 0.02) {
      state = 'DORMANT';
    } else if (pastDormancyStrength > 0.3 && returnStrength > 0.15 && occShort >= 0.02) {
      state = 'RETURNING';
    } else if (residenceStrength > 0.5) {
      // If resident and stable, classify as STABILIZED
      if (residenceStrength > 0.65 && Math.abs(momentum.velocity) < 0.02 && daysSinceLastActivity < 7) {
        state = 'STABILIZED';
      } else {
        state = 'RESIDENT';
      }
    } else if (emergenceStrength >= 0.4 && residenceStrength <= 0.5) {
      state = 'EMERGING';
    } else if (adoption.explorationCount > 0 || occShort > 0) {
      state = 'EXPLORING';
    } else {
      // Fallback
      state = curiosityStrength > 0.4 ? 'CURIOUS' : 'UNEXPLORED';
    }

    // State Confidence
    const stateConfidence = clamp(
      0.5 * affinity.confidence +
      0.5 * (1.0 - Math.abs(occShort - occLong))
    );

    // ─── Explanations & Reasons ──────────────────────────────────────

    let summary = '';
    const primaryDrivers: string[] = [];
    const reasons: string[] = [];

    switch (state) {
      case 'UNEXPLORED':
        summary = `You have not yet discovered the "${displayName}" territory.`;
        primaryDrivers.push('No History');
        reasons.push('No listening history or explored artists have been recorded for this territory.');
        break;
      case 'CURIOUS':
        summary = `You show high potential interest in the "${displayName}" territory but haven't explored it yet.`;
        primaryDrivers.push('Latent Compatibility', 'Accessibility');
        reasons.push(`High latent compatibility (${affinity.compatibilityScore.toFixed(2)}) and accessibility (${affinity.accessibility.toFixed(2)}) indicate potential resonance.`);
        reasons.push('Current occupancy remains at zero.');
        break;
      case 'EXPLORING':
        summary = `You are actively diving into the "${displayName}" territory to see if it resonates.`;
        primaryDrivers.push('New Discovery', 'Recent Listening');
        reasons.push(`You have explored ${adoption.explorationCount} new artist(s) in this territory.`);
        reasons.push(`Short-term occupancy is active at ${(occShort * 100).toFixed(1)}%.`);
        break;
      case 'RESIDENT':
        summary = `The "${displayName}" territory is a central part of your regular musical footprint.`;
        primaryDrivers.push('Sustained Listening', 'Familiarity');
        reasons.push(`You have a strong familiarity score (${familiarity.familiarityScore.toFixed(2)}) built on active listening.`);
        reasons.push(`Medium-term occupancy is steady at ${(occMedium * 100).toFixed(1)}%.`);
        break;
      case 'STABILIZED':
        summary = `The "${displayName}" territory has become a durable, stable pillar of your musical identity.`;
        primaryDrivers.push('Durable Identity', 'Taste Anchoring');
        reasons.push(`Long-term occupancy is high (${(occLong * 100).toFixed(1)}%) with extremely low listening drift (velocity: ${(momentum.velocity * 100).toFixed(2)}%/day).`);
        break;
      case 'DORMANT':
        summary = `You used to listen to the "${displayName}" territory, but it has gone quiet lately.`;
        primaryDrivers.push('Time Decay', 'Zero Recent Playbacks');
        reasons.push(`Your last activity in this territory was ${daysSinceLastActivity.toFixed(0)} days ago.`);
        reasons.push(`Short-term listening has dropped below 2%.`);
        break;
      case 'RETURNING':
        summary = `You are rediscovering your past interest in the "${displayName}" territory.`;
        primaryDrivers.push('Recent Revival', 'Positive Momentum');
        reasons.push(`After a period of dormancy, your occupancy is rising again with delta +${(momentum.delta * 100).toFixed(1)}%.`);
        break;
      case 'REJECTED':
        summary = `You tried exploring the "${displayName}" territory but decided it was not for you.`;
        primaryDrivers.push('Low Adoption', 'Bounce Signals');
        reasons.push(`You explored ${adoption.explorationCount} artist(s) here, but listening dropped to zero.`);
        break;
      case 'RESISTANT':
        summary = `The "${displayName}" territory matches your compatibility profile, but your listening trials remain low.`;
        primaryDrivers.push('Friction', 'Low Adoption');
        reasons.push(`Despite high compatibility (${affinity.compatibilityScore.toFixed(2)}), exploration attempts did not stick.`);
        break;
      case 'EMERGING':
        summary = `Your interest in the "${displayName}" territory is growing at a rapid pace.`;
        primaryDrivers.push('High Velocity', 'Rapid Growth');
        reasons.push(`Listening occupancy is expanding rapidly with a positive velocity of +${(momentum.velocity * 100).toFixed(2)}%/day.`);
        break;
    }

    results.push({
      userId,
      territoryId: tId,
      currentState: state,
      stateConfidence,
      strengths: {
        residenceStrength,
        explorationStrength,
        curiosityStrength,
        resistanceStrength,
        dormancyStrength,
        returnStrength,
        emergenceStrength,
      },
      explanation: {
        summary,
        primaryDrivers,
        reasons,
      },
    });
  }

  // 5. Database Transactions & Persistence
  console.log(`[Layer 6] Saving relationship results to database...`);
  await prisma.$transaction(async (tx: any) => {
    for (const res of results) {
      // Fetch previous state to detect transition
      const prevRel = relMap.get(res.territoryId);
      const prevState = prevRel ? prevRel.currentState : null;

      // Update/Upsert relationship
      await tx.userTerritoryRelationship.upsert({
        where: {
          userId_territoryId: {
            userId: res.userId,
            territoryId: res.territoryId,
          },
        },
        create: {
          userId: res.userId,
          territoryId: res.territoryId,
          currentState: res.currentState,
          stateConfidence: res.stateConfidence,
          residenceStrength: res.strengths.residenceStrength,
          explorationStrength: res.strengths.explorationStrength,
          curiosityStrength: res.strengths.curiosityStrength,
          resistanceStrength: res.strengths.resistanceStrength,
          dormancyStrength: res.strengths.dormancyStrength,
          returnStrength: res.strengths.returnStrength,
          emergenceStrength: res.strengths.emergenceStrength,
        },
        update: {
          currentState: res.currentState,
          stateConfidence: res.stateConfidence,
          residenceStrength: res.strengths.residenceStrength,
          explorationStrength: res.strengths.explorationStrength,
          curiosityStrength: res.strengths.curiosityStrength,
          resistanceStrength: res.strengths.resistanceStrength,
          dormancyStrength: res.strengths.dormancyStrength,
          returnStrength: res.strengths.returnStrength,
          emergenceStrength: res.strengths.emergenceStrength,
          lastUpdatedAt: new Date(),
        },
      });

      // Log Transition if state changed
      if (prevState && prevState !== res.currentState) {
        const reasonCodes: string[] = [];
        if (res.currentState === 'RESIDENT' || res.currentState === 'STABILIZED') {
          reasonCodes.push('FAMILIARITY_ESTABLISHED', 'HIGH_SUSTAINED_OCCUPANCY');
        } else if (res.currentState === 'DORMANT') {
          reasonCodes.push('ACTIVITY_RECENCY_DECAY', 'OCCUPANCY_DROP');
        } else if (res.currentState === 'RETURNING') {
          reasonCodes.push('ACTIVITY_RESURGENCE', 'POSITIVE_MOMENTUM');
        } else if (res.currentState === 'EXPLORING') {
          reasonCodes.push('NEW_EXPLORATION_ACTIVITY');
        } else if (res.currentState === 'CURIOUS') {
          reasonCodes.push('HIGH_COMPATIBILITY_INTEREST');
        } else if (res.currentState === 'REJECTED' || res.currentState === 'RESISTANT') {
          reasonCodes.push('BOUNCE_OFF_TERRITORY', 'LOW_ADOPTION_DESPITE_COMPATIBILITY');
        } else if (res.currentState === 'EMERGING') {
          reasonCodes.push('RAPID_OCCUPANCY_GROWTH', 'HIGH_VELOCITY');
        } else {
          reasonCodes.push('STATE_SHIFT_UNDERLYING_METRICS');
        }

        await tx.relationshipTransition.create({
          data: {
            userId: res.userId,
            territoryId: res.territoryId,
            previousState: prevState,
            currentState: res.currentState,
            reasonCodes: JSON.stringify(reasonCodes),
          },
        });
      }

      // Upsert Explanation
      await tx.relationshipExplanation.upsert({
        where: {
          userId_territoryId: {
            userId: res.userId,
            territoryId: res.territoryId,
          },
        },
        create: {
          userId: res.userId,
          territoryId: res.territoryId,
          explanationPayload: JSON.stringify(res.explanation),
        },
        update: {
          explanationPayload: JSON.stringify(res.explanation),
          updatedAt: new Date(),
        },
      });

      // Write snapshot if state is meaningful (not unexplored, or high compatibility)
      const affinity = affinityMap.get(res.territoryId);
      const isMeaningful = res.currentState !== 'UNEXPLORED' || (affinity && affinity.compatibilityScore >= 0.15);
      if (isMeaningful) {
        await tx.userTerritoryRelationshipSnapshot.create({
          data: {
            userId: res.userId,
            territoryId: res.territoryId,
            state: res.currentState,
            stateConfidence: res.stateConfidence,
            componentScores: JSON.stringify({
              residenceStrength: res.strengths.residenceStrength,
              explorationStrength: res.strengths.explorationStrength,
              curiosityStrength: res.strengths.curiosityStrength,
              resistanceStrength: res.strengths.resistanceStrength,
              dormancyStrength: res.strengths.dormancyStrength,
              returnStrength: res.strengths.returnStrength,
              emergenceStrength: res.strengths.emergenceStrength,
            }),
          },
        });
      }
    }
  });

  console.log(`[Layer 6] Completed relationship computations. Persisted results for ${results.length} territories.`);

  // Trigger Layer 7 Taste Expansion Intervention computations
  try {
    await computeUserInterventions(userId);
  } catch (err) {
    const error = err as Error;
    console.error(`[Layer 6] Failed to run Layer 7 Interventions:`, error.message);
  }

  return results;
}

/**
 * Computes relationship status for a territory.
 * Supports synchronous in-memory lookup via UserContext.
 */
export async function calculateRelationship(territoryId: string, userId: string, context?: any): Promise<string> {
  const GENRE_TO_TERRITORY: Record<string, string> = {
    'hip-hop': 'Territory_v2_001',
    'rock': 'Territory_v2_002',
    'electronic': 'Territory_v2_003',
    'pop': 'Territory_v2_004',
    'jazz': 'Territory_v2_005'
  };
  const tId = GENRE_TO_TERRITORY[territoryId] || territoryId;

  if (context && context.relationshipMap) {
    const rel = context.relationshipMap.get(tId) ?? context.relationshipMap.get(territoryId);
    return rel?.currentState || 'UNEXPLORED';
  }
  const { prisma } = await import('@/lib/prisma');
  const rel = await prisma.userTerritoryRelationship.findFirst({
    where: { userId, territoryId: tId },
    select: { currentState: true }
  });
  return rel?.currentState || 'UNEXPLORED';
}

/**
 * Computes longitudinal confidence score for a relationship.
 * Supports synchronous in-memory lookup via UserContext.
 */
export async function calculateLongitudinalConfidence(territoryId: string, userId: string, context?: any): Promise<number> {
  const GENRE_TO_TERRITORY: Record<string, string> = {
    'hip-hop': 'Territory_v2_001',
    'rock': 'Territory_v2_002',
    'electronic': 'Territory_v2_003',
    'pop': 'Territory_v2_004',
    'jazz': 'Territory_v2_005'
  };
  const tId = GENRE_TO_TERRITORY[territoryId] || territoryId;

  if (context && context.relationshipMap) {
    const rel = context.relationshipMap.get(tId) ?? context.relationshipMap.get(territoryId);
    return rel ? Math.round((rel.stateConfidence ?? 0.8) * 100) : 80;
  }
  const { prisma } = await import('@/lib/prisma');
  const rel = await prisma.userTerritoryRelationship.findFirst({
    where: { userId, territoryId: tId },
    select: { stateConfidence: true }
  });
  return rel ? Math.round((rel.stateConfidence ?? 0.8) * 100) : 80;
}

/**
 * Computes momentum score for a territory.
 * Supports synchronous in-memory lookup via UserContext.
 */
export async function calculateMomentumScore(territoryId: string, userId: string, context?: any): Promise<number> {
  const GENRE_TO_TERRITORY: Record<string, string> = {
    'hip-hop': 'Territory_v2_001',
    'rock': 'Territory_v2_002',
    'electronic': 'Territory_v2_003',
    'pop': 'Territory_v2_004',
    'jazz': 'Territory_v2_005'
  };
  const tId = GENRE_TO_TERRITORY[territoryId] || territoryId;

  if (context && context.momentumsMap) {
    return context.momentumsMap.get(tId) ?? context.momentumsMap.get(territoryId) ?? 0;
  }
  const { prisma } = await import('@/lib/prisma');
  const mom = await prisma.territoryMomentum.findFirst({
    where: { userId, territoryId: tId },
    select: { current: true }
  });
  return mom ? Math.round(mom.current * 100) : 0;
}

