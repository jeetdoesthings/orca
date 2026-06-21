import type { OrcaNode } from '@/lib/graph/types';
import { xyzToLatLng, normaliseGenre } from '@/lib/graph/genre-normaliser';

export interface PerimeterPoint {
  lat: number;
  lng: number;
}

interface Point2D {
  x: number; // lng
  y: number; // lat
}

/**
 * Computes a 2D convex hull using the Graham Scan algorithm
 */
function computeConvexHull(points: Point2D[]): Point2D[] {
  if (points.length < 3) return points;

  // 1. Find pivot (lowest y, then lowest x)
  let pivotIdx = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].y < points[pivotIdx].y || (points[i].y === points[pivotIdx].y && points[i].x < points[pivotIdx].x)) {
      pivotIdx = i;
    }
  }
  const pivot = points[pivotIdx];

  // 2. Filter out pivot and sort remaining points by polar angle relative to pivot
  const remaining = points.filter((_, idx) => idx !== pivotIdx);

  const getPolarAngle = (p: Point2D) => {
    return Math.atan2(p.y - pivot.y, p.x - pivot.x);
  };

  const getSquareDist = (p: Point2D) => {
    const dx = p.x - pivot.x;
    const dy = p.y - pivot.y;
    return dx * dx + dy * dy;
  };

  remaining.sort((a, b) => {
    const angleA = getPolarAngle(a);
    const angleB = getPolarAngle(b);
    if (Math.abs(angleA - angleB) < 1e-9) {
      return getSquareDist(a) - getSquareDist(b);
    }
    return angleA - angleB;
  });

  // 3. Graham Scan loop
  const crossProduct = (o: Point2D, a: Point2D, b: Point2D) => {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  };

  const stack: Point2D[] = [pivot, remaining[0]];

  for (let i = 1; i < remaining.length; i++) {
    const p = remaining[i];
    while (stack.length >= 2 && crossProduct(stack[stack.length - 2], stack[stack.length - 1], p) <= 0) {
      stack.pop();
    }
    stack.push(p);
  }

  return stack;
}

/**
 * Computes the expanded boundary perimeter for nodes belonging to a specific genre biome
 */
export function computeGenrePerimeter(
  exploredNodes: OrcaNode[],
  genre: string
): PerimeterPoint[] | null {
  // Filter nodes that match this primary normalized genre
  const genreNodes = exploredNodes.filter(n => normaliseGenre(n.genres) === genre);
  
  if (genreNodes.length < 3) return null; // Need at least 3 points to form a polygon hull

  // Convert 3D positions to 2D lat/lng points
  const points: Point2D[] = genreNodes.map(n => {
    const ll = xyzToLatLng(n.x ?? 0, n.y ?? 0, n.z ?? 0);
    return { x: ll.lng, y: ll.lat };
  });

  // Calculate convex hull
  const hull = computeConvexHull(points);
  if (hull.length < 3) return null;

  // Compute geometric centroid of the hull
  const centroid = {
    x: hull.reduce((s, p) => s + p.x, 0) / hull.length,
    y: hull.reduce((s, p) => s + p.y, 0) / hull.length,
  };

  // Expand the hull outward by 4 degrees to sit comfortably outside nodes
  const EXPAND = 4; // degrees
  
  const expanded: PerimeterPoint[] = hull.map(p => {
    const dx = p.x - centroid.x;
    const dy = p.y - centroid.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist === 0) return { lat: p.y, lng: p.x };

    const factor = (dist + EXPAND) / dist;
    
    // Constrain latitude between -85 and +85 degrees to avoid pole singularities
    const finalLat = Math.max(-85, Math.min(85, centroid.y + dy * factor));
    // Standard modular wrap for longitude
    let finalLng = centroid.x + dx * factor;
    if (finalLng > 180) finalLng -= 360;
    if (finalLng < -180) finalLng += 360;

    return {
      lat: finalLat,
      lng: finalLng,
    };
  });

  return expanded;
}
