'use client';

/**
 * NodeLabels — subtle genre region labels on the globe surface.
 * Shows genre names (ELECTRONIC, ROCK, JAZZ, etc.) positioned at each
 * genre cluster's centroid. Very subtle opacity — present but not in your face.
 * Dynamically hides labels on the back side of the globe.
 */
import { useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useOrcaStore } from '@/store/orca';
import { GENRE_LABELS, GENRE_COLORS } from '@/lib/graph/genre-normaliser';
import type { InternalGenre } from '@/lib/graph/genre-normaliser';
import { useRef } from 'react';

interface GenreLabelData {
  id: string;
  name: string;
  position: [number, number, number];
  color: string;
  nodeCount: number;
}

export function NodeLabels() {
  const graph = useOrcaStore(s => s.graph);
  const positions = useOrcaStore(s => s.nodePositions);
  const { camera } = useThree();
  const labelsRef = useRef<Map<string, HTMLDivElement>>(new Map());

  // Compute genre label positions from node centroids
  const genreLabels = useMemo(() => {
    if (!graph || positions.size === 0) return [];

    const genreGroups = new Map<string, { positions: [number, number, number][]; count: number }>();

    for (const node of graph.nodes) {
      const genre = node.genres[0]?.toLowerCase() || '';
      if (!genre) continue;

      const pos = positions.get(node.id);
      if (!pos) continue;

      if (!genreGroups.has(genre)) {
        genreGroups.set(genre, { positions: [], count: 0 });
      }
      const group = genreGroups.get(genre)!;
      group.positions.push(pos);
      group.count++;
    }

    const labels: GenreLabelData[] = [];

    for (const [genre, group] of genreGroups) {
      if (group.count < 2) continue;

      let cx = 0, cy = 0, cz = 0;
      for (const pos of group.positions) {
        cx += pos[0]; cy += pos[1]; cz += pos[2];
      }
      cx /= group.count; cy /= group.count; cz /= group.count;

      const normal = new THREE.Vector3(cx, cy, cz).normalize();
      const R = 1.65;
      const radius = R * 1.05;

      const displayName = GENRE_LABELS[genre as InternalGenre] || genre.toUpperCase();
      const color = GENRE_COLORS[genre as InternalGenre] || '#888888';

      labels.push({
        id: genre,
        name: displayName,
        position: [
          normal.x * radius,
          normal.y * radius,
          normal.z * radius,
        ],
        color,
        nodeCount: group.count,
      });
    }

    return labels;
  }, [graph, positions]);

  // Dynamically hide labels on the back side of the globe
  useFrame(() => {
    const camDir = camera.position.clone().normalize();
    for (const [id, el] of labelsRef.current) {
      const label = genreLabels.find(l => l.id === id);
      if (!label) continue;
      const labelDir = new THREE.Vector3(...label.position).normalize();
      const facing = labelDir.dot(camDir);
      // Smooth transition: visible when facing > 0.05, hidden when < -0.1
      const opacity = Math.max(0, Math.min(0.35, (facing + 0.1) / 0.15 * 0.35));
      el.style.opacity = String(opacity);
    }
  });

  return (
    <group>
      {genreLabels.map(label => (
        <Html
          key={label.id}
          position={label.position}
          style={{
            pointerEvents: 'none',
            userSelect: 'none',
            whiteSpace: 'nowrap',
          }}
          occlude={false}
          zIndexRange={[10, 0]}
        >
          <div
            ref={(el) => {
              if (el) labelsRef.current.set(label.id, el);
              else labelsRef.current.delete(label.id);
            }}
            style={{
              fontFamily: "'Inter', system-ui, sans-serif",
              fontSize: '9px',
              fontWeight: 600,
              letterSpacing: '0.14em',
              color: label.color,
              opacity: 0.35,
              textTransform: 'uppercase' as const,
              transform: 'translate(-50%, -50%)',
              textShadow: '0 0 8px rgba(255,255,255,0.6)',
              transition: 'opacity 0.15s ease',
            }}>
            {label.name}
          </div>
        </Html>
      ))}
    </group>
  );
}
