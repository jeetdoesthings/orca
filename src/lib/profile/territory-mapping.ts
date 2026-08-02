/**
 * ORCA User ↔ Territory Mapping System (Backend Layer 3)
 *
 * Maps users into the dynamic Taste Territories system based on their listening history.
 * Computes occupancy across short, medium, and long term time windows, measures
 * taste concentration/diversity, tracks territory momentum/drift, adoption, and familiarity,
 * and generates template-driven natural language explanations.
 */

import { prisma } from '@/lib/prisma';
import type { OrcaNode } from '@/lib/graph/types';
import type { UserProfile } from '@/lib/profile/types';
import { computeUserTerritoryAffinity } from './territory-affinity';

export interface UserTerritoryMappingResult {
  userId: string;
  occupancyShort: Record<string, number>;
  occupancyMedium: Record<string, number>;
  occupancyLong: Record<string, number>;
  diversityScore: number;
  concentrationScore: number;
  entropyScore: number;
  shortSummary: string;
  trajectoryExplanation: string;
}

/**
 * Computes the User-Territory Mapping and updates all metric tables and history snapshots.
 *
 * @param userId - Spotify ID of the user
 * @returns Object containing the computed profile details
 */
export async function computeUserTerritoryMapping(userId: string): Promise<UserTerritoryMappingResult | null> {
  // 1. Fetch User Record
  const user = await prisma.user.findUnique({
    where: { spotifyId: userId },
    select: {
      globeData: true,
      profileData: true,
    },
  });

  if (!user || !user.globeData) {
    console.warn(`[Territory Mapping] No globeData found for user ${userId}. Skipping.`);
    return null;
  }

  // 2. Parse Explored Artists
  let nodes: OrcaNode[] = [];
  try {
    const parsed = JSON.parse(user.globeData);
    nodes = parsed.nodes || [];
  } catch (e) {
    const err = e as Error;
    console.error(`[Territory Mapping] Failed to parse globeData for user ${userId}:`, err.message);
    return null;
  }

  const exploredNodes = nodes.filter((n) => n.state === 'explored');
  if (exploredNodes.length === 0) {
    console.warn(`[Territory Mapping] No explored nodes found for user ${userId}. Skipping.`);
    return null;
  }

  // 3. Resolve Active Territory Version
  const maxVersionRecord = await prisma.territory.findFirst({
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const activeVersion = maxVersionRecord?.version || 1;

  // 4. Fetch Territory Memberships
  const artistIds = exploredNodes.map((n: any) => n.id);
  const memberships = await prisma.territoryMembership.findMany({
    where: {
      artistId: { in: artistIds },
      territory: { version: activeVersion },
    },
  });

  // Group memberships by ArtistId
  const artistMembershipsMap = new Map<string, typeof memberships>();
  memberships.forEach((m: any) => {
    const list = artistMembershipsMap.get(m.artistId) || [];
    list.push(m);
    artistMembershipsMap.set(m.artistId, list);
  });

  // 5. Compute Raw Occupancies for each Time Window
  const rawShort = new Map<string, number>();
  const rawMedium = new Map<string, number>();
  const rawLong = new Map<string, number>();

  exploredNodes.forEach((node: any) => {
    const artistMems = artistMembershipsMap.get(node.id) || [];
    if (artistMems.length === 0) return;

    // Default weight components if missing (fallback for existing synced nodes)
    const wShort = node.weightShort ?? node.weight ?? 0.1;
    const wMedium = node.weightMedium ?? node.weight ?? 0.1;
    const wLong = node.weightLong ?? node.weight ?? 0.1;

    artistMems.forEach((m: any) => {
      const strength = m.membershipStrength;
      rawShort.set(m.territoryId, (rawShort.get(m.territoryId) || 0) + wShort * strength);
      rawMedium.set(m.territoryId, (rawMedium.get(m.territoryId) || 0) + wMedium * strength);
      rawLong.set(m.territoryId, (rawLong.get(m.territoryId) || 0) + wLong * strength);
    });
  });

  // 6. Normalize Occupancies
  const normalize = (raw: Map<string, number>): Map<string, number> => {
    const sum = Array.from(raw.values()).reduce((a, b) => a + b, 0);
    const normalized = new Map<string, number>();
    if (sum > 0) {
      raw.forEach((val: any, key: any) => normalized.set(key, val / sum));
    }
    return normalized;
  };

  const normShort = normalize(rawShort);
  const normMedium = normalize(rawMedium);
  const normLong = normalize(rawLong);

  // Convert to object maps for serialization
  const occupancyShort = Object.fromEntries(normShort);
  const occupancyMedium = Object.fromEntries(normMedium);
  const occupancyLong = Object.fromEntries(normLong);

  // 7. Calculate Concentration, Diversity, & Entropy (using Medium-Term occupancy as standard user profile)
  const pValues = Array.from(normMedium.values());
  
  // Concentration Score (HHI)
  const concentrationScore = pValues.reduce((sum, p) => sum + p * p, 0);
  
  // Diversity Score (Simpson Diversity)
  const diversityScore = Math.max(0.0, 1.0 - concentrationScore);

  // Shannon Entropy
  let entropy = 0;
  pValues.forEach((p: any) => {
    if (p > 0) entropy -= p * Math.log(p);
  });

  const totalTerritories = await prisma.territory.count({ where: { version: activeVersion } });
  const entropyScore = totalTerritories > 1 ? entropy / Math.log(totalTerritories) : 0.0;

  // 8. Fetch Previous User Territory Profile to Compute Drift/Velocity
  const prevProfile = await prisma.userTerritoryProfile.findUnique({
    where: { userId },
  });

  let prevMediumOccupancy: Record<string, number> = {};
  if (prevProfile) {
    try {
      const parsed = JSON.parse(prevProfile.occupancyVector);
      prevMediumOccupancy = parsed.mediumTerm || {};
    } catch {}
  }

  const timeDiffMs = prevProfile ? Date.now() - new Date(prevProfile.updatedAt).getTime() : 0;
  const daysElapsed = Math.max(1, timeDiffMs / (1000 * 60 * 60 * 24));

  // Determine all territory IDs with occupancy (current or past)
  const allTerritoryIds = new Set([
    ...Array.from(normMedium.keys()),
    ...Object.keys(prevMediumOccupancy),
  ]);

  // 9. Compute & Persist Territory Momentum
  for (const tId of allTerritoryIds) {
    const currentVal = normMedium.get(tId) || 0.0;
    const prevVal = prevMediumOccupancy[tId] || 0.0;
    const delta = currentVal - prevVal;
    const velocity = delta / daysElapsed;

    await prisma.territoryMomentum.upsert({
      where: { userId_territoryId: { userId, territoryId: tId } },
      create: { userId, territoryId: tId, previous: prevVal, current: currentVal, delta, velocity },
      update: { previous: prevVal, current: currentVal, delta, velocity },
    });
  }

  // 10. Compute & Persist Territory Adoption
  const exploredArtists = await prisma.exploredArtist.findMany({ where: { userId } });
  const exploredSourceMap = new Map<string, { source: string; lastExploredAt: Date }>();
  exploredArtists.forEach((ea: any) => exploredSourceMap.set(ea.artistId, { source: ea.source, lastExploredAt: ea.lastExploredAt }));

  for (const tId of normMedium.keys()) {
    const artistsInTerritory = exploredNodes.filter((node) =>
      memberships.some((m: any) => m.artistId === node.id && m.territoryId === tId)
    );

    // Filter to exploratory sources
    const exploredArtistsInTerritory = artistsInTerritory.filter((node) => {
      const data = exploredSourceMap.get(node.id);
      return data && (data.source === 'add-to-spotify' || data.source === 'mark-explored');
    });

    const explorationCount = exploredArtistsInTerritory.length;

    // Adoption Score: average long-term listening weight of explored artists in this territory
    const totalExploredWeight = exploredArtistsInTerritory.reduce((sum, n) => sum + (n.weightLong ?? 0.1), 0);
    const adoptionScore = explorationCount > 0 ? totalExploredWeight / explorationCount : 0.0;

    // Find latest activity date
    let lastActivity = new Date(0);
    exploredArtistsInTerritory.forEach((n: any) => {
      const info = exploredSourceMap.get(n.id);
      if (info && info.lastExploredAt > lastActivity) {
        lastActivity = info.lastExploredAt;
      }
    });
    if (lastActivity.getTime() === 0) {
      lastActivity = new Date();
    }

    await prisma.territoryAdoption.upsert({
      where: { userId_territoryId: { userId, territoryId: tId } },
      create: { userId, territoryId: tId, explorationCount, adoptionScore, lastActivity },
      update: { explorationCount, adoptionScore, lastActivity },
    });
  }

  // 11. Compute & Persist Territory Familiarity
  for (const tId of normMedium.keys()) {
    const artistsInTerritory = exploredNodes.filter((node) =>
      memberships.some((m: any) => m.artistId === node.id && m.territoryId === tId)
    );
    const uniqueArtistCount = artistsInTerritory.length;
    const totalWeight = artistsInTerritory.reduce((sum, n) => sum + (n.weightMedium ?? n.weight ?? 0.1), 0);

    // Familiarity score combining number of unique artists (max 10) & average weight
    const avgWeight = uniqueArtistCount > 0 ? totalWeight / uniqueArtistCount : 0.0;
    const familiarityScore = Math.min(1.0, (uniqueArtistCount / 10) * 0.4 + avgWeight * 0.6);

    // Confidence grows as we explore more unique artists (max 5)
    const confidence = Math.min(1.0, uniqueArtistCount / 5);

    await prisma.territoryFamiliarity.upsert({
      where: { userId_territoryId: { userId, territoryId: tId } },
      create: { userId, territoryId: tId, familiarityScore, confidence },
      update: { familiarityScore, confidence },
    });
  }

  // 12. Create Snapshots for occupied territories (threshold > 0.01)
  for (const [tId, occupancy] of normMedium.entries()) {
    if (occupancy >= 0.01) {
      await prisma.userTerritorySnapshot.create({
        data: {
          userId,
          territoryId: tId,
          occupancy,
        },
      });
    }
  }

  // 13. Persist Overall UserTerritoryProfile
  const occupancyVector = JSON.stringify({
    shortTerm: occupancyShort,
    mediumTerm: occupancyMedium,
    longTerm: occupancyLong,
  });

  await prisma.userTerritoryProfile.upsert({
    where: { userId },
    create: {
      userId,
      occupancyVector,
      diversityScore,
      concentrationScore,
      entropyScore,
    },
    update: {
      occupancyVector,
      diversityScore,
      concentrationScore,
      entropyScore,
    },
  });

  // 14. Explainability & Text Generation (Natural Language Narratives)
  const sortedOccupancies = Array.from(normMedium.entries()).sort((a, b) => b[1] - a[1]);
  const top2 = sortedOccupancies.slice(0, 2);
  const top2Ids = top2.map((t: any) => t[0]);

  const dbTerritories = await prisma.territory.findMany({
    where: { id: { in: top2Ids } },
  });

  const nameMap = new Map<string, string>();
  dbTerritories.forEach((t: any) => {
    try {
      const meta = JSON.parse(t.metadata || '{}');
      nameMap.set(t.id, meta.displayName || t.id);
    } catch {
      nameMap.set(t.id, t.id);
    }
  });

  const names = top2.map((t: any) => nameMap.get(t[0]) || t[0]);
  let shortSummary = 'Your taste profile is still forming — keep listening.';
  if (names.length === 1) {
    shortSummary = `Your taste is distinctly rooted in the "${names[0]}" territory.`;
  } else if (names.length > 1) {
    shortSummary = `Your taste primarily occupies the "${names[0]}" and "${names[1]}" territories.`;
  }

  // Trajectory narrative (Momentum drift)
  const topMomentum = await prisma.territoryMomentum.findFirst({
    where: { userId, velocity: { gt: 0 } },
    orderBy: { velocity: 'desc' },
  });

  let trajectoryExplanation = 'Your taste profile remains stable.';
  if (topMomentum) {
    const tRecord = await prisma.territory.findUnique({
      where: { id: topMomentum.territoryId },
    });
    let tName = topMomentum.territoryId;
    if (tRecord) {
      try {
        const meta = JSON.parse(tRecord.metadata || '{}');
        tName = meta.displayName || tName;
      } catch {}
    }
    trajectoryExplanation = `Your listening behavior is expanding toward "${tName}" territories (momentum +${(topMomentum.delta * 100).toFixed(1)}%).`;
  }

  // 15. Patch UserProfile payload if it exists
  if (user.profileData) {
    try {
      const profile: UserProfile = JSON.parse(user.profileData);
      
      // Update shortSummary and detailedSummary with territory details
      profile.explanations.shortSummary = shortSummary;
      
      let detailed = profile.explanations.detailedSummary;
      // Append territory insights to detailed summary if not already there
      if (!detailed.includes('primarily occupies')) {
        detailed = `${shortSummary} ${trajectoryExplanation} ${detailed}`;
      }
      profile.explanations.detailedSummary = detailed;
      profile.explanations.trajectoryExplanation = trajectoryExplanation;

      await prisma.user.update({
        where: { spotifyId: userId },
        data: {
          profileData: JSON.stringify(profile),
        },
      });
    } catch (err) {
      const error = err as Error;
      console.error(`[Territory Mapping] Failed to update user profile explanations:`, error.message);
    }
  }

  // Trigger Backend Layer 4: Territory Affinity Engine computation
  try {
    await computeUserTerritoryAffinity(userId);
  } catch (err) {
    const error = err as Error;
    console.error(`[Territory Mapping] Failed to run Layer 4 Territory Affinity:`, error.message);
  }

  return {
    userId,
    occupancyShort,
    occupancyMedium,
    occupancyLong,
    diversityScore,
    concentrationScore,
    entropyScore,
    shortSummary,
    trajectoryExplanation,
  };
}
