'use client';

/**
 * GenreClouds — soft atmospheric genre regions on the globe surface.
 * Overlapping translucent spheres create the sense of gravitational fields.
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import { useOrcaStore } from '@/store/orca';

export function GenreClouds() {
  const graph = useOrcaStore(s => s.graph);
  const positions = useOrcaStore(s => s.nodePositions);

  // Compute genre cloud data
  const clouds = useMemo(() => {
    if (!graph || positions.size === 0) return [];

    return graph.genres
      .filter(g => g.nodeCount >= 3) // Only show clouds for genres with 3+ artists
      .slice(0, 20) // Max 20 genre clouds
      .map(genre => {
        // Compute centroid from actual node positions
        let cx = 0, cy = 0, cz = 0, count = 0;
        for (const nodeId of genre.nodeIds) {
          const pos = positions.get(nodeId);
          if (pos) {
            cx += pos[0]; cy += pos[1]; cz += pos[2];
            count++;
          }
        }
        if (count === 0) return null;
        cx /= count; cy /= count; cz /= count;

        // Radius proportional to sqrt(node count)
        const radius = Math.sqrt(genre.nodeCount) * 0.075;

        return {
          id: genre.id,
          position: [cx, cy, cz] as [number, number, number],
          radius,
          color: genre.color,
        };
      })
      .filter(Boolean) as { id: string; position: [number, number, number]; radius: number; color: string }[];
  }, [graph, positions]);

  return (
    <group>
      {clouds.map(cloud => (
        <mesh key={cloud.id} position={cloud.position}>
          <sphereGeometry args={[cloud.radius, 16, 12]} />
          <meshBasicMaterial
            color={cloud.color}
            transparent
            opacity={0.018}
            depthWrite={false}
            blending={THREE.NormalBlending}
          />
        </mesh>
      ))}
    </group>
  );
}
