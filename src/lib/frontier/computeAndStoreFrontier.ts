import { prisma } from '@/lib/prisma';
import type { OrcaNode } from '@/lib/graph/types';
import { buildFrontierNodes } from './buildFrontierNodes';
import { computeGenrePerimeter } from './genrePerimeter';
import { computeAdventurousness } from '../metrics/adventurousness';

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
    const frontierNodes = await buildFrontierNodes(exploredNodes, accessToken);

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

    let history: any[] = [];
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
