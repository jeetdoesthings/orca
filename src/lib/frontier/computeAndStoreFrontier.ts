import { prisma } from '@/lib/prisma';
import type { OrcaNode } from '@/lib/graph/types';
import { buildFrontierNodes } from './buildFrontierNodes';
import { computeGenrePerimeter } from './genrePerimeter';
import { computeAdventurousness } from '../metrics/adventurousness';
import type { AdventurousnessMetric } from '../metrics/adventurousness';
import { computeUserProfile } from '../profile/profile-engine';
import { computeDiscoveryProfile } from '../profile/discovery-readiness';
import { generateExplanations } from '../profile/explainer';
import type { UserProfile } from '../profile/types';
import { computeUserTerritoryMapping } from '../profile/territory-mapping';

// List of all normalized biomes
const GLOBE_BIOMES = [
  'hip-hop', 'trap', 'drill', 'edm', 'house', 'techno', 'trance',
  'drum-and-bass', 'pop', 'dance-pop', 'rock', 'alternative-rock',
  'indie-rock', 'punk', 'metal', 'rnb', 'soul', 'funk', 'folk',
  'country', 'ambient', 'classical', 'jazz', 'latin', 'world-music'
];

/**
 * Computes frontier nodes, boundaries, and adventurousness, and persists to DB.
 */
export async function computeAndStoreFrontier(
  userId: string,
  exploredNodes: OrcaNode[],
  accessToken: string
): Promise<void> {
  // 1. Mark status as COMPUTING
  await prisma.user.update({
    where: { spotifyId: userId },
    data: { frontierStatus: 'COMPUTING' },
  });

  try {
    console.log(`[Frontier Background] Starting computation for user ${userId}...`);
    
    // 2. Fetch related artists and build frontier nodes
    const frontierNodes = await buildFrontierNodes(exploredNodes, accessToken, userId);

    // 3. Compute perimeters for all biomes with enough nodes (>= 3)
    const perimeters = GLOBE_BIOMES.map(genre => {
      const points = computeGenrePerimeter(exploredNodes, genre);
      if (points && points.length >= 3) {
        return {
          genre,
          points,
          color: getGenreColorHex(genre),
        };
      }
      return null;
    }).filter(Boolean);

    // 4. Load adventurousness history and append a new snapshot
    const user = await prisma.user.findUnique({
      where: { spotifyId: userId },
      select: { adventurousnessHistory: true },
    });

    let history: AdventurousnessMetric[] = [];
    if (user?.adventurousnessHistory) {
      try {
        history = JSON.parse(user.adventurousnessHistory);
      } catch {
        history = [];
      }
    }

    const currentMetric = computeAdventurousness(exploredNodes, frontierNodes, history);
    
    // Stave off unbounded growth of history array — cap at latest 50 entries
    history.push(currentMetric);
    if (history.length > 50) {
      history = history.slice(history.length - 50);
    }

    // 5. Update user record with successfully computed data
    await prisma.user.update({
      where: { spotifyId: userId },
      data: {
        frontierData: JSON.stringify(frontierNodes),
        perimeterData: JSON.stringify(perimeters),
        adventurousnessHistory: JSON.stringify(history),
        frontierStatus: 'COMPLETE',
        frontierComputedAt: new Date(),
      },
    });

    // 6. Update user profile with the new frontier count and recalculate discovery metrics
    try {
      const userRecord = await prisma.user.findUnique({
        where: { spotifyId: userId },
        select: { profileData: true, globeData: true, lastSyncAt: true },
      });

      if (userRecord?.profileData) {
        let exploredNodes: OrcaNode[] = [];
        if (userRecord.globeData) {
          exploredNodes = JSON.parse(userRecord.globeData).nodes || [];
        }

        const currentProfile: UserProfile = JSON.parse(userRecord.profileData);

        // Determine if we are doing a post-sync patch (where profile was computed very recently during sync)
        // or a post-explore run (where explored nodes actually changed).
        const isPostSyncPatch = userRecord.lastSyncAt &&
          Math.abs(new Date(userRecord.lastSyncAt).getTime() - new Date(currentProfile.updatedAt).getTime()) < 10 * 60 * 1000;

        if (isPostSyncPatch) {
          // Post-sync patch: only update the discovery profile and explanations to keep the sync-interval trends intact.
          const updatedDiscovery = computeDiscoveryProfile(
            exploredNodes,
            frontierNodes.length,
            currentProfile.discoveryProfile,
          );
          const updatedExplanations = generateExplanations(
            currentProfile.sonicProfile,
            currentProfile.traitProfile,
            updatedDiscovery,
            currentProfile.trajectoryProfile,
            currentProfile.confidenceProfile,
          );

          currentProfile.discoveryProfile = updatedDiscovery;
          currentProfile.explanations = updatedExplanations;
          currentProfile.updatedAt = new Date().toISOString();

          await prisma.user.update({
            where: { spotifyId: userId },
            data: {
              profileData: JSON.stringify(currentProfile),
              profileComputedAt: new Date(),
            },
          });
        } else {
          // Post-explore or manual update: compute the entire profile, treating currentProfile as the previous step.
          const updatedProfile = computeUserProfile(
            userId,
            exploredNodes,
            frontierNodes.length,
            currentProfile,
          );
          await prisma.user.update({
            where: { spotifyId: userId },
            data: {
              profileData: JSON.stringify(updatedProfile),
              profileComputedAt: new Date(),
              profileVersion: updatedProfile.version,
            },
          });
        }

        try {
          console.log(`[Frontier Background] Computing user territory mapping for ${userId}...`);
          await computeUserTerritoryMapping(userId);
        } catch (territoryErr) {
          console.error(
            `[Frontier Background] Failed to compute territory mapping:`,
            territoryErr instanceof Error ? territoryErr.message : String(territoryErr)
          );
        }
      }
    } catch (profileErr) {
      console.error(`[Frontier Background] Failed to update user profile post-frontier for user ${userId}:`, profileErr);
    }

    console.log(`[Frontier Background] Completed computation successfully for user ${userId}.`);
  } catch (error) {
    console.error(`[Frontier Background] Failed for user ${userId}:`, error);
    await prisma.user.update({
      where: { spotifyId: userId },
      data: { frontierStatus: 'FAILED' },
    });
  }
}

// Fallback helper to retrieve genre colors for boundary outlines
function getGenreColorHex(genre: string): string {
  // Simple map based on standard genre-normaliser palette
  const colors: Record<string, string> = {
    'hip-hop':          '#C95C8A',
    'trap':             '#D46B8A',
    'drill':            '#A85C6B',
    'edm':              '#6BC7D9',
    'house':            '#5FB5D4',
    'techno':           '#8B9FD4',
    'trance':           '#5FC4C4',
    'drum-and-bass':    '#3EAEB1',
    'pop':              '#B7A8D6',
    'dance-pop':        '#D4A8D6',
    'rock':             '#D17A5C',
    'alternative-rock': '#E88C74',
    'indie-rock':       '#7FAFCF',
    'punk':             '#D45F5F',
    'metal':            '#8E4A57',
    'rnb':              '#B97BBF',
    'soul':             '#9E67A5',
    'funk':             '#7851A9',
    'folk':             '#91A78B',
    'country':          '#C4A86B',
    'ambient':          '#A89BEF',
    'classical':        '#D8BE72',
    'jazz':             '#D99A6C',
    'latin':            '#E8766A',
    'world-music':      '#C9A85F',
  };
  return colors[genre] || '#B7A8D6';
}
