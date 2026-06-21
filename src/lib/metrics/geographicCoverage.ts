import type { OrcaNode } from '@/lib/graph/types';
import type { InternalGenre } from '@/lib/graph/genre-normaliser';
import { normaliseGenre, GENRE_ANCHORS, GENRE_LABELS } from '@/lib/graph/genre-normaliser';

export interface GeoGap {
  region: string; // Genre biome label, e.g. "JAZZ" or "AMBIENT"
  gapType: 'continent' | 'scene';
  anchorLat: number;
  anchorLng: number;
  representative: OrcaNode[]; // 2-3 frontier nodes that fill this gap
}

// 10 contrasting musical genre regions to monitor on the globe
const GENRE_REGIONS: Array<{ id: string; genre: string }> = [
  { id: 'ambient',       genre: 'ambient' },
  { id: 'classical',     genre: 'classical' },
  { id: 'jazz',          genre: 'jazz' },
  { id: 'techno',        genre: 'techno' },
  { id: 'metal',         genre: 'metal' },
  { id: 'latin',         genre: 'latin' },
  { id: 'hip-hop',       genre: 'hip-hop' },
  { id: 'folk',          genre: 'folk' },
  { id: 'funk',          genre: 'funk' },
  { id: 'drum-and-bass', genre: 'drum-and-bass' },
];

/**
 * Detects genre region gaps where the user has not explored any music.
 * Classifies globe surface regions into musical biomes rather than physical lands.
 */
export function detectGeographicGaps(
  exploredNodes: OrcaNode[],
  frontierNodes: OrcaNode[]
): GeoGap[] {
  const gaps: GeoGap[] = [];

  for (const region of GENRE_REGIONS) {
    const genreKey = region.genre;
    
    // Check if the user has explored nodes in this genre biome (count < 1)
    const hasInGenre = exploredNodes.some(n => {
      const primary = normaliseGenre(n.genres);
      return primary === genreKey;
    });

    if (!hasInGenre) {
      // Find frontier nodes belonging to this unexplored genre region
      const nearbyFrontier = frontierNodes
        .filter(n => {
          const primary = normaliseGenre(n.genres);
          return primary === genreKey;
        })
        .slice(0, 3); // Take top 3 representative nodes to display inside HUD card

      if (nearbyFrontier.length > 0) {
        const anchor = GENRE_ANCHORS[genreKey as InternalGenre] || { lat: 0, lng: 0 };
        const label = GENRE_LABELS[genreKey as InternalGenre] || genreKey.toUpperCase();
        
        gaps.push({
          region: label,
          gapType: 'scene',
          anchorLat: anchor.lat,
          anchorLng: anchor.lng,
          representative: nearbyFrontier,
        });
      }
    }
  }

  // Return at most 5 gap indicators to keep HUD and globe visual balanced
  return gaps.slice(0, 5);
}
