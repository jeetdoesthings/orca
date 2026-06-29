import { prisma } from '@/lib/prisma';
import { clamp01 as clamp } from '@/lib/math';
import { computeUserCultivation } from './tce-engine';

export type InterventionType =
  | 'INTRODUCE'
  | 'BRIDGE'
  | 'REINFORCE'
  | 'REINTRODUCE'
  | 'ACCELERATE'
  | 'EXPAND_OUTWARD'
  | 'HOLD';

export interface InterventionScoreBreakdownResult {
  introScore: number;
  bridgeScore: number;
  reinforceScore: number;
  reintroduceScore: number;
  accelerateScore: number;
  expandOutwardScore: number;
  holdScore: number;
}

export interface PolicyDecision {
  intervention: InterventionType;
  expectedValue: number;
  expectedTEMGain: number;
  expectedMemoryGain: number;
  expectedRetentionGain: number;
  expectedIdentityGain: number;
  expectedRejection: number;
  expectedFatigue: number;
  confidence: number;
  reasoning: string[];
  featureContributions: {
    compatibility: number;
    readiness: number;
    relationshipStrength: number;
    memory: number;
    expansionIntent: number;
    lofl: number;
  };
}

export interface UserTerritoryInterventionResult {
  userId: string;
  territoryId: string;
  selectedIntervention: InterventionType;
  interventionScore: number;
  confidence: number;
  expectedAdoptionImpact: number;
  expectedRejectionRisk: number;
  sourceTerritoryId: string | null;
  bridgeTerritoryId: string | null;
  scoreBreakdown: InterventionScoreBreakdownResult;
  explanation: {
    summary: string;
    primaryDrivers: string[];
    reasons: string[];
    policyDecision: PolicyDecision;
  };
}

/**
 * Computes Layer 7 interventions (CPDE) for all active territories for a user.
 *
 * @param userId - Spotify ID of the target user
 * @returns Array of intervention results
 */
export async function computeUserInterventions(userId: string): Promise<UserTerritoryInterventionResult[]> {
  console.log(`[Layer 7] Starting CPDE intervention computations for user ${userId}...`);

  // 1. Fetch User Profile
  const user = await prisma.user.findUnique({
    where: { spotifyId: userId },
    select: { profileData: true },
  });

  if (!user) {
    console.warn(`[Layer 7] User ${userId} not found.`);
    return [];
  }

  let overallReadiness = 0.5;
  let dataCompleteness = 0.5;
  let expansionIntent = 0.5;

  if (user.profileData) {
    try {
      const profile = JSON.parse(user.profileData);
      overallReadiness = profile.discoveryProfile?.overallReadiness ?? 0.5;
      expansionIntent = profile.discoveryProfile?.expansionIntent ?? 0.5;
      dataCompleteness = profile.confidenceProfile?.dataCompleteness ?? 0.5;
    } catch {}
  }

  // 2. Fetch Layer 6 UserTerritoryRelationships
  const relationships = await prisma.userTerritoryRelationship.findMany({
    where: { userId },
  });

  if (relationships.length === 0) {
    console.warn(`[Layer 7] No relationship states found for user ${userId}. Run Layer 6 first.`);
    return [];
  }

  // 3. Fetch Layer 4 UserTerritoryAffinities
  const affinities = await prisma.userTerritoryAffinity.findMany({
    where: { userId },
  });
  const affinityMap = new Map(affinities.map((a) => [a.territoryId, a]));

  // 4. Fetch User Territory Profile (Occupancies)
  const utProfile = await prisma.userTerritoryProfile.findUnique({
    where: { userId },
  });

  let occupancyMediumMap: Record<string, number> = {};
  if (utProfile) {
    try {
      const parsed = JSON.parse(utProfile.occupancyVector);
      occupancyMediumMap = parsed.mediumTerm || {};
    } catch {}
  }

  // 5. Fetch Taste Memory (TME)
  const memories = await prisma.userTerritoryMemory.findMany({
    where: { userId }
  });
  const memoryMap = new Map(memories.map((m) => [m.territoryId, m]));

  // 6. Fetch LOFL / Past Interventions
  const interventionOutcomes = await prisma.interventionOutcome.findMany({
    where: { userId }
  });

  // 7. Fetch similarities and bridges for routing
  const maxVersionRecord = await prisma.territory.findFirst({
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const activeVersion = maxVersionRecord?.version || 1;

  const [similarities, bridges, territories] = await Promise.all([
    prisma.territorySimilarity.findMany({
      where: {
        territoryA: { version: activeVersion },
        territoryB: { version: activeVersion },
      },
    }),
    prisma.territoryBridge.findMany({
      where: {
        territoryA: { version: activeVersion },
        territoryB: { version: activeVersion },
      },
    }),
    prisma.territory.findMany({
      where: { version: activeVersion },
    }),
  ]);

  const territoryMetadataMap = new Map<string, any>();
  territories.forEach((t) => {
    try {
      territoryMetadataMap.set(t.id, JSON.parse(t.metadata || '{}'));
    } catch {
      territoryMetadataMap.set(t.id, { displayName: t.id });
    }
  });

  const getDisplayName = (tId: string) => territoryMetadataMap.get(tId)?.displayName || tId;

  const results: UserTerritoryInterventionResult[] = [];

  for (const rel of relationships) {
    const tId = rel.territoryId;
    const dispName = getDisplayName(tId);

    // Resolve Contextual Inputs
    const affinity = affinityMap.get(tId) || {
      compatibilityScore: 0.1, accessibility: 0.5, hiddenPotential: 0.0, confidence: 0.5
    } as any;
    const memory = memoryMap.get(tId) || { memoryStrength: 0.0 };

    const comp = affinity.compatibilityScore;
    const access = affinity.accessibility;
    const read = overallReadiness;
    const expIntent = expansionIntent;
    const memStr = memory.memoryStrength;
    const hPot = affinity.hiddenPotential;

    const S_res = rel.residenceStrength;
    const S_exp = rel.explorationStrength;
    const S_cur = rel.curiosityStrength;
    const S_resist = rel.resistanceStrength;
    const S_dorm = rel.dormancyStrength;
    const S_ret = rel.returnStrength;
    const S_em = rel.emergenceStrength;
    const maxStrength = Math.max(S_res, S_exp, S_cur, S_resist, S_dorm, S_ret, S_em);

    // LOFL Heuristic
    const outcomesForT = interventionOutcomes.filter(o => o.territoryId === tId);
    let loflBonus = 0;
    if (outcomesForT.length > 0) {
      const recent = outcomesForT[0];
      if (recent.outcomeLabel === 'ADOPTED' || recent.adoptionChange > 0) loflBonus = 0.15;
      if (recent.outcomeLabel === 'REJECTED' || recent.rejectionChange > 0) loflBonus = -0.15;
    }

    // --- CPDE Policy Evaluation (Expected Utility) ---
    const evals: Array<{
      type: InterventionType;
      expectedTEMGain: number;
      expectedMemoryGain: number;
      expectedRetentionGain: number;
      expectedIdentityGain: number;
      expectedRejection: number;
      expectedFatigue: number;
      expectedValue: number;
      reasoning: string[];
    }> = [];

    const baseIdentity = comp * 0.5 + hPot * 0.5;

    // 1. INTRODUCE
    {
      const expectedTEMGain = clamp(0.5 * S_cur + 0.3 * read + 0.2 * expIntent);
      const expectedMemoryGain = clamp(0.4 * comp + 0.6 * access);
      const expectedRetentionGain = clamp(0.3 * baseIdentity + 0.7 * S_cur);
      const expectedIdentityGain = clamp(expectedTEMGain * 0.5 + expectedRetentionGain * 0.5);
      const expectedRejection = clamp(0.6 * S_resist + 0.4 * (1.0 - access));
      const expectedFatigue = clamp(0.3 * (1.0 - read) + 0.2);
      const ev = clamp(
        (0.3 * expectedTEMGain) + (0.2 * expectedMemoryGain) + (0.2 * expectedRetentionGain) +
        (0.1 * hPot) + loflBonus - (0.4 * expectedRejection) - (0.1 * expectedFatigue)
      );
      evals.push({
        type: 'INTRODUCE', expectedTEMGain, expectedMemoryGain, expectedRetentionGain, expectedIdentityGain, expectedRejection, expectedFatigue, expectedValue: ev,
        reasoning: [`Curiosity (${S_cur.toFixed(2)}) and readiness (${read.toFixed(2)}) drive TEM potential.`, `Rejection risk is tied to resistance (${S_resist.toFixed(2)}).`]
      });
    }

    // 2. BRIDGE
    {
      const expectedTEMGain = clamp(0.3 * S_cur + 0.4 * comp + 0.3 * expIntent);
      const expectedMemoryGain = clamp(0.6 * comp + 0.4 * (1.0 - access));
      const expectedRetentionGain = clamp(0.5 * S_resist + 0.5 * comp); 
      const expectedIdentityGain = clamp(expectedTEMGain * 0.6 + expectedRetentionGain * 0.4);
      const expectedRejection = clamp(0.3 * S_resist + 0.2 * (1.0 - access));
      const expectedFatigue = clamp(0.2 * (1.0 - read) + 0.1);
      const ev = clamp(
        (0.3 * expectedTEMGain) + (0.2 * expectedMemoryGain) + (0.2 * expectedRetentionGain) +
        (0.1 * hPot) + loflBonus - (0.4 * expectedRejection) - (0.1 * expectedFatigue)
      );
      evals.push({
        type: 'BRIDGE', expectedTEMGain, expectedMemoryGain, expectedRetentionGain, expectedIdentityGain, expectedRejection, expectedFatigue, expectedValue: ev,
        reasoning: [`Bridging minimizes rejection by leveraging compatibility (${comp.toFixed(2)}).`, `Effective when resistance is present (${S_resist.toFixed(2)}).`]
      });
    }

    // 3. REINFORCE
    {
      const expectedTEMGain = clamp(0.2 * S_exp + 0.2 * expIntent);
      const expectedMemoryGain = clamp(0.7 * S_exp + 0.3 * memStr);
      const expectedRetentionGain = clamp(0.6 * S_exp + 0.4 * comp);
      const expectedIdentityGain = clamp(0.4 * S_res + 0.6 * comp);
      const expectedRejection = clamp(0.1 * S_resist);
      const expectedFatigue = clamp(0.4 * (1.0 - read) + 0.2); 
      const ev = clamp(
        (0.2 * expectedTEMGain) + (0.4 * expectedMemoryGain) + (0.3 * expectedRetentionGain) +
        (0.0 * hPot) + loflBonus - (0.2 * expectedRejection) - (0.2 * expectedFatigue)
      );
      evals.push({
        type: 'REINFORCE', expectedTEMGain, expectedMemoryGain, expectedRetentionGain, expectedIdentityGain, expectedRejection, expectedFatigue, expectedValue: ev,
        reasoning: [`Exploration strength (${S_exp.toFixed(2)}) drives memory consolidation.`, `Focuses on solidifying existing gains.`]
      });
    }

    // 4. REINTRODUCE
    {
      const expectedTEMGain = clamp(0.4 * S_dorm + 0.3 * S_ret + 0.3 * comp);
      const expectedMemoryGain = clamp(0.5 * S_dorm + 0.5 * memStr);
      const expectedRetentionGain = clamp(0.7 * S_ret + 0.3 * comp);
      const expectedIdentityGain = clamp(expectedTEMGain * 0.5 + expectedRetentionGain * 0.5);
      const expectedRejection = clamp(0.5 * S_resist + 0.3 * (1.0 - read));
      const expectedFatigue = clamp(0.2 * (1.0 - read));
      const ev = clamp(
        (0.2 * expectedTEMGain) + (0.3 * expectedMemoryGain) + (0.2 * expectedRetentionGain) +
        (0.1 * hPot) + loflBonus - (0.3 * expectedRejection) - (0.1 * expectedFatigue)
      );
      evals.push({
        type: 'REINTRODUCE', expectedTEMGain, expectedMemoryGain, expectedRetentionGain, expectedIdentityGain, expectedRejection, expectedFatigue, expectedValue: ev,
        reasoning: [`Capitalizes on returning momentum (${S_ret.toFixed(2)}) and past memory (${memStr.toFixed(2)}).`]
      });
    }

    // 5. ACCELERATE
    {
      const expectedTEMGain = clamp(0.7 * S_em + 0.3 * expIntent);
      const expectedMemoryGain = clamp(0.4 * S_em + 0.6 * memStr);
      const expectedRetentionGain = clamp(0.5 * S_em + 0.5 * comp);
      const expectedIdentityGain = clamp(0.8 * S_em + 0.2 * comp);
      const expectedRejection = clamp(0.3 * S_resist + 0.3 * (1.0 - access));
      const expectedFatigue = clamp(0.5 * (1.0 - read)); 
      const ev = clamp(
        (0.4 * expectedTEMGain) + (0.1 * expectedMemoryGain) + (0.2 * expectedRetentionGain) +
        (0.1 * hPot) + loflBonus - (0.3 * expectedRejection) - (0.3 * expectedFatigue)
      );
      evals.push({
        type: 'ACCELERATE', expectedTEMGain, expectedMemoryGain, expectedRetentionGain, expectedIdentityGain, expectedRejection, expectedFatigue, expectedValue: ev,
        reasoning: [`Emergence strength (${S_em.toFixed(2)}) allows for rapid identity growth.`, `Fatigue risk is high if bandwidth is exceeded.`]
      });
    }

    // 6. EXPAND_OUTWARD
    {
      const expectedTEMGain = clamp(0.6 * S_res + 0.4 * expIntent);
      const expectedMemoryGain = clamp(0.2 * memStr + 0.8 * S_res);
      const expectedRetentionGain = clamp(0.4 * S_res + 0.6 * comp);
      const expectedIdentityGain = clamp(0.7 * expIntent + 0.3 * S_res);
      const expectedRejection = clamp(0.2 * S_resist + 0.2 * (1.0 - read));
      const expectedFatigue = clamp(0.3 * (1.0 - read) + 0.1);
      const ev = clamp(
        (0.4 * expectedTEMGain) + (0.1 * expectedMemoryGain) + (0.3 * expectedRetentionGain) +
        (0.2 * hPot) + loflBonus - (0.2 * expectedRejection) - (0.2 * expectedFatigue)
      );
      evals.push({
        type: 'EXPAND_OUTWARD', expectedTEMGain, expectedMemoryGain, expectedRetentionGain, expectedIdentityGain, expectedRejection, expectedFatigue, expectedValue: ev,
        reasoning: [`Residence strength (${S_res.toFixed(2)}) acts as a stable anchor for expansion.`, `Leverages expansion intent (${expIntent.toFixed(2)}).`]
      });
    }

    // 7. HOLD
    {
      const expectedTEMGain = 0.0;
      const expectedMemoryGain = clamp(0.1 * memStr);
      const expectedRetentionGain = clamp(0.2 * S_res);
      const expectedIdentityGain = 0.0;
      const expectedRejection = 0.0;
      const expectedFatigue = -0.5; // HOLD reduces fatigue
      const ev = clamp(
        (0.0 * expectedTEMGain) + (0.0 * expectedMemoryGain) + (0.0 * expectedRetentionGain) +
        (0.0 * hPot) + loflBonus - (0.5 * expectedRejection) - (0.5 * expectedFatigue)
      );
      evals.push({
        type: 'HOLD', expectedTEMGain, expectedMemoryGain, expectedRetentionGain, expectedIdentityGain, expectedRejection, expectedFatigue, expectedValue: ev,
        reasoning: [`Prevents fatigue and preserves novelty budget.`, `Defers immediate expansion to reduce rejection risk.`]
      });
    }

    // Sort and select the highest Expected Value
    evals.sort((a, b) => b.expectedValue - a.expectedValue);
    const bestEval = evals[0];
    const selectedIntervention = bestEval.type;
    const maxScore = bestEval.expectedValue;

    const scoreBreakdown: InterventionScoreBreakdownResult = {
      introScore: evals.find(e => e.type === 'INTRODUCE')?.expectedValue || 0,
      bridgeScore: evals.find(e => e.type === 'BRIDGE')?.expectedValue || 0,
      reinforceScore: evals.find(e => e.type === 'REINFORCE')?.expectedValue || 0,
      reintroduceScore: evals.find(e => e.type === 'REINTRODUCE')?.expectedValue || 0,
      accelerateScore: evals.find(e => e.type === 'ACCELERATE')?.expectedValue || 0,
      expandOutwardScore: evals.find(e => e.type === 'EXPAND_OUTWARD')?.expectedValue || 0,
      holdScore: evals.find(e => e.type === 'HOLD')?.expectedValue || 0,
    };

    const featureContributions = {
      compatibility: comp,
      readiness: read,
      relationshipStrength: maxStrength,
      memory: memStr,
      expansionIntent: expIntent,
      lofl: loflBonus,
    };

    const policyDecision: PolicyDecision = {
      intervention: bestEval.type,
      expectedValue: bestEval.expectedValue,
      expectedTEMGain: bestEval.expectedTEMGain,
      expectedMemoryGain: bestEval.expectedMemoryGain,
      expectedRetentionGain: bestEval.expectedRetentionGain,
      expectedIdentityGain: bestEval.expectedIdentityGain,
      expectedRejection: bestEval.expectedRejection,
      expectedFatigue: bestEval.expectedFatigue,
      confidence: clamp(0.5 * maxStrength + 0.3 * (affinity.confidence || 0.5) + 0.2 * dataCompleteness),
      reasoning: bestEval.reasoning,
      featureContributions,
    };

    // --- Resolve Source and Bridge Territories ---
    let sourceTerritoryId: string | null = null;
    let bridgeTerritoryId: string | null = null;

    if (selectedIntervention === 'BRIDGE') {
      const activeTerritoryIds = relationships
        .filter((r) => r.currentState === 'RESIDENT' || r.currentState === 'STABILIZED' || r.currentState === 'EXPLORING' || (occupancyMediumMap[r.territoryId] || 0) >= 0.03)
        .map((r) => r.territoryId);

      if (activeTerritoryIds.length > 0) {
        let bestBridgeStrength = -1;
        let bestSourceId: string | null = null;
        bridges.forEach((b) => {
          if (b.territoryAId === tId && activeTerritoryIds.includes(b.territoryBId)) {
            if (b.bridgeStrength > bestBridgeStrength) {
              bestBridgeStrength = b.bridgeStrength;
              bestSourceId = b.territoryBId;
            }
          } else if (b.territoryBId === tId && activeTerritoryIds.includes(b.territoryAId)) {
            if (b.bridgeStrength > bestBridgeStrength) {
              bestBridgeStrength = b.bridgeStrength;
              bestSourceId = b.territoryAId;
            }
          }
        });
        if (bestSourceId) {
          sourceTerritoryId = bestSourceId;
          bridgeTerritoryId = bestSourceId; 
        } else {
          let bestSim = -1;
          similarities.forEach((s) => {
            if (s.territoryAId === tId && activeTerritoryIds.includes(s.territoryBId)) {
              if (s.similarity > bestSim) {
                bestSim = s.similarity;
                bestSourceId = s.territoryBId;
              }
            } else if (s.territoryBId === tId && activeTerritoryIds.includes(s.territoryAId)) {
              if (s.similarity > bestSim) {
                bestSim = s.similarity;
                bestSourceId = s.territoryAId;
              }
            }
          });
          sourceTerritoryId = bestSourceId;
          bridgeTerritoryId = bestSourceId;
        }
      }
    } else if (selectedIntervention === 'EXPAND_OUTWARD') {
      sourceTerritoryId = tId;
      let bestSim = -1;
      let bestDestId: string | null = null;
      similarities.forEach((s) => {
        const otherId = s.territoryAId === tId ? s.territoryBId : s.territoryBId === tId ? s.territoryAId : null;
        if (otherId) {
          const occ = occupancyMediumMap[otherId] || 0.0;
          if (occ < 0.02) {
            if (s.similarity > bestSim) {
              bestSim = s.similarity;
              bestDestId = otherId;
            }
          }
        }
      });
      bridgeTerritoryId = bestDestId;
    }

    // Generate Natural Language Summary
    let summary = `Selected ${selectedIntervention} based on highest Expected Utility (${maxScore.toFixed(2)}).`;
    if (selectedIntervention === 'BRIDGE' && sourceTerritoryId) {
      summary = `Create a bridge connection from "${getDisplayName(sourceTerritoryId)}" to ease your entry into "${dispName}".`;
    }

    results.push({
      userId,
      territoryId: tId,
      selectedIntervention,
      interventionScore: maxScore,
      confidence: policyDecision.confidence,
      expectedAdoptionImpact: bestEval.expectedIdentityGain,
      expectedRejectionRisk: bestEval.expectedRejection,
      sourceTerritoryId,
      bridgeTerritoryId,
      scoreBreakdown,
      explanation: {
        summary,
        primaryDrivers: ['Expected Utility', 'Long-term Identity Growth'],
        reasons: bestEval.reasoning,
        policyDecision
      },
    });
  }

  // 7. Persist to Database inside a transaction
  console.log(`[Layer 7] Saving CPDE intervention records for user ${userId} to database...`);
  await prisma.$transaction(async (tx) => {
    for (const res of results) {
      await tx.userTerritoryIntervention.upsert({
        where: { userId_territoryId: { userId: res.userId, territoryId: res.territoryId } },
        create: {
          userId: res.userId, territoryId: res.territoryId,
          interventionType: res.selectedIntervention, interventionScore: res.interventionScore,
          confidence: res.confidence, expectedAdoptionImpact: res.expectedAdoptionImpact,
          expectedRejectionRisk: res.expectedRejectionRisk,
        },
        update: {
          interventionType: res.selectedIntervention, interventionScore: res.interventionScore,
          confidence: res.confidence, expectedAdoptionImpact: res.expectedAdoptionImpact,
          expectedRejectionRisk: res.expectedRejectionRisk, createdAt: new Date(),
        },
      });

      await tx.interventionScoreBreakdown.upsert({
        where: { userId_territoryId: { userId: res.userId, territoryId: res.territoryId } },
        create: {
          userId: res.userId, territoryId: res.territoryId,
          introScore: res.scoreBreakdown.introScore, bridgeScore: res.scoreBreakdown.bridgeScore,
          reinforceScore: res.scoreBreakdown.reinforceScore, reintroduceScore: res.scoreBreakdown.reintroduceScore,
          accelerateScore: res.scoreBreakdown.accelerateScore, expandOutwardScore: res.scoreBreakdown.expandOutwardScore,
          holdScore: res.scoreBreakdown.holdScore,
        },
        update: {
          introScore: res.scoreBreakdown.introScore, bridgeScore: res.scoreBreakdown.bridgeScore,
          reinforceScore: res.scoreBreakdown.reinforceScore, reintroduceScore: res.scoreBreakdown.reintroduceScore,
          accelerateScore: res.scoreBreakdown.accelerateScore, expandOutwardScore: res.scoreBreakdown.expandOutwardScore,
          holdScore: res.scoreBreakdown.holdScore,
        },
      });

      await tx.interventionExplanation.upsert({
        where: { userId_territoryId: { userId: res.userId, territoryId: res.territoryId } },
        create: {
          userId: res.userId, territoryId: res.territoryId,
          explanationPayload: JSON.stringify(res.explanation),
        },
        update: {
          explanationPayload: JSON.stringify(res.explanation),
          updatedAt: new Date(),
        },
      });
    }
  });

  console.log(`[Layer 7] Successfully computed and saved interventions for ${results.length} territories.`);

  // Trigger Layer 8 Taste Cultivation Engine computations
  try {
    await computeUserCultivation(userId);
  } catch (err) {
    const error = err as Error;
    console.error(`[Layer 7] Failed to run Layer 8 TCE:`, error.message);
  }

  return results;
}
