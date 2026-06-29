/**
 * ORCA Taste Cultivation Engine (Backend Layer 8 Redesign)
 *
 * Implements the TCE familiarity models, processing fluency estimations,
 * adoption probabilities, and exposure scheduling rules.
 */

import { prisma } from '@/lib/prisma';
import { clamp01 as clamp } from '@/lib/math';
import type {
  UserTerritoryCultivationResult,
  AdoptionState,
  WeeklyExposureRule,
  ExposureSchedule,
} from './tce-types';

/**
 * Computes Layer 8 Taste Cultivation metrics for a user and persists them to the database.
 *
 * @param userId - Spotify ID of the target user
 * @returns Array of cultivation results
 */
export async function computeUserCultivation(userId: string): Promise<UserTerritoryCultivationResult[]> {
  console.log(`[Layer 8] Starting Taste Cultivation computations for user ${userId}...`);

  // 1. Fetch User Profile for overall readiness & data completeness
  const user = await prisma.user.findUnique({
    where: { spotifyId: userId },
    select: { profileData: true },
  });

  if (!user) {
    console.warn(`[Layer 8] User ${userId} not found.`);
    return [];
  }

  let overallReadiness = 0.5;
  let noveltyAppetite = 0.4;

  if (user.profileData) {
    try {
      const profile = JSON.parse(user.profileData);
      overallReadiness = profile.discoveryProfile?.overallReadiness ?? 0.5;
      noveltyAppetite = profile.discoveryProfile?.noveltyAppetite ?? 0.4;
    } catch {}
  }

  // 2. Fetch Layer 4 UserTerritoryAffinities
  const affinities = await prisma.userTerritoryAffinity.findMany({
    where: { userId },
  });
  const affinityMap = new Map(affinities.map((a) => [a.territoryId, a]));

  // 3. Fetch Layer 6 UserTerritoryRelationships
  const relationships = await prisma.userTerritoryRelationship.findMany({
    where: { userId },
  });
  const relationshipMap = new Map(relationships.map((r) => [r.territoryId, r]));

  // 4. Fetch Territory Familiarities (Layer 3 fallback)
  const dbFamiliarities = await prisma.territoryFamiliarity.findMany({
    where: { userId },
  });
  const dbFamiliarityMap = new Map(dbFamiliarities.map((f) => [f.territoryId, f.familiarityScore]));

  // 5. Fetch Layer 7 UserTerritoryInterventions
  const interventions = await prisma.userTerritoryIntervention.findMany({
    where: { userId },
  });

  // 6. Fetch previous cultivation states to check decays and execute running fluency averages
  const prevCultivations = await prisma.userTerritoryCultivation.findMany({
    where: { userId },
  });
  const prevCultivationMap = new Map(prevCultivations.map((c) => [c.territoryId, c]));

  // 7. Retrieve active version territories and memberships
  const maxVersionRecord = await prisma.territory.findFirst({
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const activeVersion = maxVersionRecord?.version || 1;

  const [territoryModels, memberships] = await Promise.all([
    prisma.territory.findMany({
      where: { version: activeVersion },
    }),
    prisma.territoryMembership.findMany({
      where: { territory: { version: activeVersion } },
    }),
  ]);

  // Map artist -> territory memberships
  const artistTerritoryMap = new Map<string, { territoryId: string; role: string }[]>();
  memberships.forEach((m) => {
    const list = artistTerritoryMap.get(m.artistId) || [];
    list.push({ territoryId: m.territoryId, role: m.role });
    artistTerritoryMap.set(m.artistId, list);
  });

  // 8. Retrieve user listening events
  const listeningEvents = await prisma.userListeningEvent.findMany({
    where: { userId },
  });

  // Fetch territory snapshots for adoption detection (divergence)
  const snapshots = await prisma.userTerritorySnapshot.findMany({
    where: { userId },
    orderBy: { timestamp: 'desc' },
  });

  const results: UserTerritoryCultivationResult[] = [];

  for (const territory of territoryModels) {
    const tId = territory.id;

    // Resolve Layer 4 Compatibility
    const affinity = affinityMap.get(tId) || { compatibilityScore: 0.5, accessibility: 0.5 };
    const compatibility = affinity.compatibilityScore;
    const accessibility = affinity.accessibility;

    // Resolve Layer 7 Intervention info
    const inter = interventions.find((i) => i.territoryId === tId);
    const selectedIntervention = inter?.interventionType || 'HOLD';
    const interventionScore = inter?.interventionScore || 0.0;
    const baseConfidence = inter?.confidence || 0.5;

    // Retrieve previous state
    const prevCult = prevCultivationMap.get(tId);

    // ─── A. FAMILIARITY MODEL ──────────────────────────────────────────

    // Filter listening events associated with this territory
    const territoryEvents = listeningEvents.filter((ev) => {
      if (ev.territoryId) return ev.territoryId === tId;
      const mems = artistTerritoryMap.get(ev.artistId) || [];
      return mems.some((m) => m.territoryId === tId);
    });

    let targetPlays = 0;
    let bridgePlays = 0;
    let completions = 0;
    let replays = 0;
    let saves = 0;
    let skips = 0;

    territoryEvents.forEach((ev) => {
      const type = ev.eventType;
      const mems = artistTerritoryMap.get(ev.artistId) || [];
      const mem = mems.find((m) => m.territoryId === tId);
      const isBridge = mem?.role === 'BRIDGE';

      if (isBridge) {
        bridgePlays++;
      } else {
        targetPlays++;
      }

      if (type === 'COMPLETE') completions++;
      else if (type === 'REPLAY') replays++;
      else if (type === 'SAVE' || type === 'PLAYLIST_ADD') saves++;
      else if (type === 'SKIP') skips++;
    });

    // Calculate Exposure Weight
    let exposureWeight =
      targetPlays * 1.0 +
      bridgePlays * 0.7 +
      completions * 0.5 +
      replays * 0.8 +
      saves * 1.2 -
      skips * 0.4;

    if (exposureWeight < 0.0) exposureWeight = 0.0;

    // Diminishing returns saturation curve
    const k = 0.15;
    let familiarity = 1.0 - Math.exp(-k * exposureWeight);

    // Fetch fallback pre-existing familiarity score
    const dbFamScore = dbFamiliarityMap.get(tId) ?? 0.0;
    familiarity = Math.max(familiarity, dbFamScore);

    // Apply Time Decay (forgetting model)
    let daysSinceExposure = 0;
    if (prevCult) {
      const msDiff = Date.now() - new Date(prevCult.lastExposureAt).getTime();
      daysSinceExposure = Math.max(0, Math.floor(msDiff / (1000 * 60 * 60 * 24)));
      const decayFactor = 0.05;
      familiarity = familiarity * Math.exp(-decayFactor * daysSinceExposure);
    }

    familiarity = clamp(familiarity);

    // ─── B. PROCESSING FLUENCY MODEL ───────────────────────────────────

    let fluency = 0.5;
    let completionRate = 0.0;
    let skipRate = 0.0;
    const totalPlays = targetPlays + bridgePlays;

    if (totalPlays > 0) {
      completionRate = completions / totalPlays;
      skipRate = skips / totalPlays;
      const saveRate = saves / totalPlays;
      const replayRate = replays / totalPlays;

      // Behavioral Fluency score: completion/saves add, skips subtract
      const behavioralFluency = clamp(
        (completionRate * 0.5 + saveRate * 0.3 + replayRate * 0.2 - skipRate * 0.4 + 0.4) / 1.4
      );

      if (prevCult) {
        // Smoothing exponential running average (Knowledge Tracing update)
        fluency = prevCult.fluencyScore * 0.7 + behavioralFluency * 0.3;
      } else {
        fluency = behavioralFluency;
      }
    } else {
      // Fallback initialization based on readiness and accessibility
      if (prevCult) {
        fluency = prevCult.fluencyScore;
      } else {
        fluency = clamp(overallReadiness * 0.4 + accessibility * 0.3 + compatibility * 0.3);
      }
    }

    fluency = clamp(fluency);

    // ─── C. ADOPTION PROBABILITY MODEL ─────────────────────────────────

    // w1=0.35, w2=0.20, w3=0.22, w4=0.23
    const adoptionProbability = clamp(
      0.35 * compatibility +
        0.2 * overallReadiness +
        0.22 * familiarity +
        0.23 * fluency
    );

    // ─── D. EXPOSURE SCHEDULER ─────────────────────────────────────────

    let cadence: 'BRIDGE_HEAVY' | 'MIXED' | 'TARGET_HEAVY' | 'ACCELERATED' | 'SLOW' = 'MIXED';
    let totalExposures = 5;

    if (overallReadiness < 0.3) {
      cadence = 'SLOW';
      totalExposures = 3;
    } else if (overallReadiness >= 0.7 && fluency >= 0.7) {
      cadence = 'ACCELERATED';
      totalExposures = 8;
    } else if (familiarity <= 0.3) {
      cadence = 'BRIDGE_HEAVY';
      totalExposures = 5;
    } else if (familiarity >= 0.7) {
      cadence = 'TARGET_HEAVY';
      totalExposures = 6;
    }

    let bridgeRatio = 0.5;
    let targetRatio = 0.5;

    if (cadence === 'BRIDGE_HEAVY') {
      bridgeRatio = 0.8;
      targetRatio = 0.2;
    } else if (cadence === 'TARGET_HEAVY') {
      bridgeRatio = 0.2;
      targetRatio = 0.8;
    } else if (cadence === 'ACCELERATED') {
      bridgeRatio = 0.1;
      targetRatio = 0.9;
    } else if (cadence === 'SLOW') {
      bridgeRatio = 0.7;
      targetRatio = 0.3;
    }

    const exposureSchedule: ExposureSchedule = [];
    for (let week = 1; week <= 4; week++) {
      exposureSchedule.push({
        weekIndex: week,
        bridgeExposureCount: Math.round(totalExposures * bridgeRatio),
        targetExposureCount: Math.round(totalExposures * targetRatio),
        focus: cadence,
      });
    }

    // ─── E. ADOPTION DETECTION ─────────────────────────────────────────

    let adoptionState: AdoptionState = 'UNEXPLORED';

    // Group snapshots by week to check entropy and divergence stability
    const snapshotGrouped = new Map<string, Record<string, number>>();
    snapshots.forEach((s) => {
      const dateStr = s.timestamp.toISOString().split('T')[0];
      const rec = snapshotGrouped.get(dateStr) || {};
      rec[s.territoryId] = s.occupancy;
      snapshotGrouped.set(dateStr, rec);
    });

    const uniqueWeeks = Array.from(snapshotGrouped.values());

    let shannonEntropy = 0.0;
    let jsDivergence = 0.5; // default moderate volatility

    if (uniqueWeeks.length > 0) {
      // Calculate Shannon Entropy of the most recent week's occupancy distribution
      const latestWeek = uniqueWeeks[0];
      const occList = Object.values(latestWeek);
      const totalOccSum = occList.reduce((acc, v) => acc + v, 0);

      if (totalOccSum > 0.0) {
        occList.forEach((val) => {
          const p = val / totalOccSum;
          if (p > 0.0) {
            shannonEntropy -= p * Math.log2(p);
          }
        });
      }

      // Calculate JS Divergence from previous week
      if (uniqueWeeks.length > 1) {
        const prevWeek = uniqueWeeks[1];
        // Calculate Kullback-Leibler divergence between latest and prev
        let klDiv = 0.0;
        const allKeys = new Set([...Object.keys(latestWeek), ...Object.keys(prevWeek)]);
        allKeys.forEach((key) => {
          const p = (latestWeek[key] || 0.001) / (totalOccSum || 1.0);
          const q = (prevWeek[key] || 0.001) / (Object.values(prevWeek).reduce((sum, v) => sum + v, 0) || 1.0);
          klDiv += p * Math.log2(p / q);
        });
        jsDivergence = clamp(Math.abs(klDiv));
      }
    }

    const relState = relationshipMap.get(tId)?.currentState || 'UNEXPLORED';

    if (familiarity < 0.1 && totalPlays === 0) {
      adoptionState = 'UNEXPLORED';
    } else if (familiarity >= 0.6 && fluency >= 0.6 && jsDivergence < 0.15) {
      adoptionState = 'ADOPTED';
    } else if (shannonEntropy > 1.2 && jsDivergence >= 0.3) {
      // Moratorium: exploration spike (high entropy and high divergence fluctuation)
      adoptionState = 'MORATORIUM';
    } else if (skips >= 5 && completionRate < 0.25) {
      adoptionState = 'DECLINED';
    } else {
      adoptionState = 'CULTIVATING';
    }

    const confidence = clamp(
      0.4 * baseConfidence +
        0.3 * (1.0 - Math.abs(familiarity - fluency)) +
        0.3 * (1.0 - jsDivergence)
    );

    results.push({
      userId,
      territoryId: tId,
      familiarityScore: familiarity,
      fluencyScore: fluency,
      adoptionProbability,
      exposureSchedule,
      adoptionState,
      confidence,
    });
  }

  // 9. Persist to Database inside a Transaction
  console.log(`[Layer 8] Saving TCE cultivation records to database...`);
  await prisma.$transaction(async (tx) => {
    for (const res of results) {
      await tx.userTerritoryCultivation.upsert({
        where: {
          userId_territoryId: {
            userId: res.userId,
            territoryId: res.territoryId,
          },
        },
        create: {
          userId: res.userId,
          territoryId: res.territoryId,
          familiarityScore: res.familiarityScore,
          fluencyScore: res.fluencyScore,
          adoptionProbability: res.adoptionProbability,
          exposureSchedule: JSON.stringify(res.exposureSchedule),
          adoptionState: res.adoptionState,
          confidence: res.confidence,
          lastExposureAt: new Date(),
        },
        update: {
          familiarityScore: res.familiarityScore,
          fluencyScore: res.fluencyScore,
          adoptionProbability: res.adoptionProbability,
          exposureSchedule: JSON.stringify(res.exposureSchedule),
          adoptionState: res.adoptionState,
          confidence: res.confidence,
          updatedAt: new Date(),
        },
      });
    }
  });

  console.log(`[Layer 8] Successfully saved ${results.length} cultivation states.`);
  return results;
}
