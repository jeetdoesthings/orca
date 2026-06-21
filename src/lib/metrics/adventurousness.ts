import type { OrcaNode } from '@/lib/graph/types';
import { xyzToLatLng, normaliseGenre } from '@/lib/graph/genre-normaliser';

export interface AdventurousnessMetric {
  spread: number;         // 0.0 - 1.0
  genreCount: number;     // Number of distinct genre biomes with >= 3 nodes
  exploredCount: number;  // Total explored artists
  frontierCount: number;  // Current frontier nodes count
  label: string;          // Emotional vocabulary description
  trajectory: 'expanding' | 'stable' | 'focusing';
}

/**
 * Computes home region spread and centroid coordinates
 */
export function computeRegionSpread(nodes: OrcaNode[]): { centroidLat: number; centroidLng: number; spread: number } {
  if (nodes.length === 0) {
    return { centroidLat: 0, centroidLng: 0, spread: 0 };
  }

  let totalWeight = 0;
  let weightedLat = 0;
  let weightedLng = 0;

  nodes.forEach(node => {
    const w = node.weight * node.weight;
    totalWeight += w;

    const ll = xyzToLatLng(node.x ?? 0, node.y ?? 0, node.z ?? 0);
    weightedLat += ll.lat * w;
    weightedLng += ll.lng * w;
  });

  const centroidLat = weightedLat / totalWeight;
  const centroidLng = weightedLng / totalWeight;

  let totalDist = 0;
  nodes.forEach(node => {
    const ll = xyzToLatLng(node.x ?? 0, node.y ?? 0, node.z ?? 0);
    const dist = Math.sqrt(Math.pow(ll.lat - centroidLat, 2) + Math.pow(ll.lng - centroidLng, 2));
    totalDist += dist;
  });

  const avgDistance = totalDist / nodes.length;
  // Normalized spread value (0.0 to 1.0)
  const spread = Math.min(avgDistance / 60, 1.0);

  return {
    centroidLat,
    centroidLng,
    spread,
  };
}

/**
 * Calculates the user's taste adventurousness metrics and tracks spatial changes
 */
export function computeAdventurousness(
  exploredNodes: OrcaNode[],
  frontierNodes: OrcaNode[],
  previousHistory: AdventurousnessMetric[] | null
): AdventurousnessMetric {
  const { spread } = computeRegionSpread(exploredNodes);

  // Group explored nodes by primary genre and identify active genres with >= 3 nodes
  const genreCounts: Record<string, number> = {};
  exploredNodes.forEach(node => {
    const primary = normaliseGenre(node.genres);
    genreCounts[primary] = (genreCounts[primary] || 0) + 1;
  });
  
  const activeGenres = Object.values(genreCounts).filter(count => count >= 3).length;

  // Determine trajectory by comparing to the latest metric snapshot
  let trajectory: AdventurousnessMetric['trajectory'] = 'stable';
  if (previousHistory && previousHistory.length > 0) {
    const latestSnapshot = previousHistory[previousHistory.length - 1];
    const prevSpread = latestSnapshot.spread;
    if (spread > prevSpread + 0.02) {
      trajectory = 'expanding';
    } else if (spread < prevSpread - 0.02) {
      trajectory = 'focusing';
    }
  }

  // Emotional vocabulary description based on spread
  let label: string;
  if (spread < 0.20) {
    label = 'Deeply focused — every listen reinforces a specific world';
  } else if (spread < 0.35) {
    label = 'Rooted with curiosity at the edges';
  } else if (spread < 0.55) {
    label = 'Comfortably wide — familiar anchors with real range';
  } else if (spread < 0.70) {
    label = 'Genuinely adventurous — spanning multiple worlds';
  } else {
    label = 'Extraordinarily wide — few people range this far';
  }

  return {
    spread,
    genreCount: activeGenres,
    exploredCount: exploredNodes.length,
    frontierCount: frontierNodes.length,
    label,
    trajectory,
  };
}
