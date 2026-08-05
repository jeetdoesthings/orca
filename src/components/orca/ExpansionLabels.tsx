'use client';

/**
 * ExpansionLabels — floating visual labels for expansion candidate artist nodes on the globe.
 * Displays the artist name alongside a delicate, dynamically role-translated tag capsule.
 * Employs premium styling and camera-facing occlusion for maximum visual excellence and 60fps performance.
 */
import { useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useOrcaStore } from '@/store/orca';
import { getGenreColor, normaliseGenre } from '@/lib/graph/genre-normaliser';
import { sharedDisplacedPositions } from './NodeField';

export function ExpansionLabels() {
  // TODO: Migrate Zustand store property frontierNodes to expansionNodes in a future cleanup.
  const frontierNodes = useOrcaStore(s => s.frontierNodes);
  const focusedNodeId = useOrcaStore(s => s.focusedNodeId);
  const setPinnedNode = useOrcaStore(s => s.setPinnedNode);
  const setFocusedNode = useOrcaStore(s => s.setFocusedNode);
  
  const { camera } = useThree();
  const labelsRef = useRef<Map<string, HTMLDivElement>>(new Map());

  // Offset the nodes slightly outward from R=1.65 to float elegantly above the sphere surface
  const labelsData = useMemo(() => {
    const R = 1.65;
    const floatRadius = R * 1.035;

    return frontierNodes
      .filter(node => node.reachable === true)
      .map(node => {
        // Calculate normal direction
        const normal = new THREE.Vector3(node.x, node.y, node.z).normalize();
        
        const primaryGenre = normaliseGenre(node.genres);
        const genreColor = getGenreColor(primaryGenre);

        return {
          id: node.id,
          name: node.name,
          // Default outward position
          position: [
            normal.x * floatRadius,
            normal.y * floatRadius,
            normal.z * floatRadius,
          ] as [number, number, number],
          normal,
          genreColor,
          semanticRole: node.semanticRole,
        };
      });
  }, [frontierNodes]);

  // Dynamically manage visibility, backface-hiding, and hover offsets
  useFrame(() => {
    const camDir = camera.position.clone().normalize();

    for (const [id, el] of labelsRef.current) {
      const label = labelsData.find(l => l.id === id);
      if (!label) continue;

      // 1. Position tracking sync with magnetic displacement
      const displaced = sharedDisplacedPositions.get(id);
      if (displaced && el.parentElement) {
        // Offset the displaced node slightly outward along its normal
        const floatOffset = 0.05;
        const lx = displaced[0] + label.normal.x * floatOffset;
        const ly = displaced[1] + label.normal.y * floatOffset;
        const lz = displaced[2] + label.normal.z * floatOffset;
      }

      // 2. Camera occlusion & backface hiding
      const facing = label.normal.dot(camDir);

      // Smooth transition: visible when facing > 0.08, completely hidden when < -0.05
      let baseOpacity = Math.max(0, Math.min(1.0, (facing + 0.05) / 0.13));

      // Zoom visibility gating: only show expansion labels when zoomed in (camera distance < 5.2)
      // or if it's the currently focused node
      const camDistance = camera.position.length();
      const isZoomedIn = camDistance < 5.2;
      if (!isZoomedIn && focusedNodeId !== id) {
        baseOpacity = 0.0;
      }

      // 3. Focus isolation dampening: fade out all other labels when another node is focused
      if (focusedNodeId) {
        if (focusedNodeId === id) {
          baseOpacity = 1.0;
        } else {
          baseOpacity *= 0.15; // heavily dim others to preserve clarity
        }
      }

      el.style.opacity = String(baseOpacity);

      // 4. Dynamic scaling for premium feel
      const scale = focusedNodeId === id ? 'scale(1.08)' : 'scale(1)';
      el.style.transform = `translate(-50%, -50%) ${scale}`;
      el.style.pointerEvents = baseOpacity > 0.1 ? 'auto' : 'none';
    }
  });

  if (frontierNodes.length === 0) return null;

  return (
    <group>
      {labelsData.map(label => {
        return (
          <Html
            key={label.id}
            position={label.position}
            style={{
              pointerEvents: 'none',
              userSelect: 'none',
              whiteSpace: 'nowrap',
            }}
            occlude={false}
            zIndexRange={[25, 10]}
          >
            <div
              ref={(el) => {
                if (el) labelsRef.current.set(label.id, el);
                else labelsRef.current.delete(label.id);
              }}
              onClick={(e) => {
                e.stopPropagation();
                setPinnedNode(label.id);
                setFocusedNode(label.id);
              }}
              style={{
                fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
                fontSize: '10px',
                fontWeight: 600,
                color: '#1a1a24',
                background: 'rgba(255, 255, 255, 0.86)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                border: '1px solid rgba(0, 0, 0, 0.06)',
                borderRadius: '6px',
                padding: '3px 8px',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.04), 0 2px 4px rgba(0, 0, 0, 0.02)',
                display: 'flex',
                alignItems: 'center',
                cursor: 'pointer',
                opacity: 0,
                transform: 'translate(-50%, -50%) scale(1)',
                transition: 'opacity 0.2s ease, transform 0.2s ease, background-color 0.2s',
                pointerEvents: 'auto',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#ffffff';
                e.currentTarget.style.borderColor = 'rgba(0, 0, 0, 0.15)';
                e.currentTarget.style.boxShadow = '0 6px 16px rgba(0, 0, 0, 0.06), 0 3px 6px rgba(0, 0, 0, 0.03)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.86)';
                e.currentTarget.style.borderColor = 'rgba(0, 0, 0, 0.06)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.04), 0 2px 4px rgba(0, 0, 0, 0.02)';
              }}
            >
              {/* Artist name */}
              <span style={{ marginRight: '6px' }}>{label.name}</span>

              {/* Premium role-translated tag capsule */}
              <span
                style={{
                  fontSize: '8px',
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  color: '#22c55e',
                  background: '#22c55e12', // opacity background
                  border: '1px solid #22c55e33', // opacity border
                  borderRadius: '100px',
                  padding: '1.5px 5px',
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
              >
                ↳ Explore
              </span>
            </div>
          </Html>
        );
      })}
    </group>
  );
}
