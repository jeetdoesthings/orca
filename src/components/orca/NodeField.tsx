'use client';

/**
 * NodeField — instanced mesh rendering for all artist nodes on the globe surface.
 *
 * Architecture:
 * - Backface hiding: nodes facing away from the camera get scale → 0 (pure rendering, no state)
 * - Magnetic hover: nodes near cursor pull toward it via lat/lng displacement
 * - Displaced positions: written to a module-level Map (not Zustand) so EdgeField
 *   can read them without triggering React re-renders at 60fps
 * - Click-to-pin: detected via timing threshold on canvas pointerdown/pointerup
 */
import { useRef, useEffect, useMemo, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useOrcaStore } from '@/store/orca';
import { getGenreColor } from '@/lib/graph/genre-normaliser';
import { xyzToLatLng, latLngToXYZ } from '@/lib/graph/genre-normaliser';

// ── Shared displaced positions (read by EdgeField, written by NodeField) ──
// This avoids pushing to Zustand at 60fps which would trigger re-renders.
export const sharedDisplacedPositions = new Map<string, [number, number, number]>();
export let displacedPositionsVersion = 0;

const GENRE_COLORS_THREE: Record<string, THREE.Color> = {};

function genreToThreeColor(genres: string[]): THREE.Color {
  const genre = (genres[0] || '').toLowerCase();
  if (!GENRE_COLORS_THREE[genre]) {
    GENRE_COLORS_THREE[genre] = new THREE.Color(getGenreColor(genre));
  }
  return GENRE_COLORS_THREE[genre].clone();
}

function getNodeRadius(weight: number): number {
  if (weight > 0.8) return 0.028;
  if (weight > 0.5) return 0.022;
  if (weight > 0.2) return 0.016;
  return 0.013;
}

const MAX_NODES = 2000;
const R = 1.65;

// Magnetic hover constants
const MAGNET_RADIUS = 18;
const MAGNET_STRENGTH = 3.2;
const SNAP_SPEED = 0.08;

export function NodeField() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const hitSphereRef = useRef<THREE.Mesh>(null);
  const graph = useOrcaStore(s => s.graph);
  const positions = useOrcaStore(s => s.nodePositions);
  const setHoveredNode = useOrcaStore(s => s.setHoveredNode);
  const setPinnedNode = useOrcaStore(s => s.setPinnedNode);
  const { camera, raycaster, pointer, gl } = useThree();

  const geometry = useMemo(() => new THREE.CircleGeometry(1, 24), []);
  const material = useMemo(() => new THREE.MeshBasicMaterial({
    side: THREE.DoubleSide,
    depthWrite: false,
    transparent: true,
    opacity: 0.92,
    vertexColors: false,
  }), []);

  const _obj = useMemo(() => new THREE.Object3D(), []);
  const _outward = useMemo(() => new THREE.Vector3(), []);
  const _camDir = useMemo(() => new THREE.Vector3(), []);
  const _nodeDir = useMemo(() => new THREE.Vector3(), []);

  const frontierIndices = useRef<number[]>([]);
  const nodeCount = useRef(0);

  // Magnetic hover state (all refs — no React state)
  const originalLatLngs = useRef<Map<string, { lat: number; lng: number }>>(new Map());
  const currentLatLngs = useRef<Map<string, { lat: number; lng: number }>>(new Map());
  const mouseGlobeLatLng = useRef<{ lat: number; lng: number } | null>(null);
  const isHovering = useRef(false);
  const closestNodeRef = useRef<string | null>(null);

  // Click detection state
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null);
  const pointerDownTime = useRef(0);

  // Canvas-level click detection — doesn't interfere with OrbitControls
  useEffect(() => {
    const canvas = gl.domElement;
    const onDown = (e: PointerEvent) => {
      pointerDownPos.current = { x: e.clientX, y: e.clientY };
      pointerDownTime.current = Date.now();
    };
    const onUp = (e: PointerEvent) => {
      if (!pointerDownPos.current) return;
      const dx = e.clientX - pointerDownPos.current.x;
      const dy = e.clientY - pointerDownPos.current.y;
      const moved = Math.sqrt(dx * dx + dy * dy);
      const elapsed = Date.now() - pointerDownTime.current;
      // Tap = short press + minimal movement
      if (moved < 15 && elapsed < 250) {
        if (closestNodeRef.current) {
          const currentPinned = useOrcaStore.getState().pinnedNodeId;
          if (currentPinned === closestNodeRef.current) {
            setPinnedNode(null); // Toggle off if already pinned
          } else {
            setPinnedNode(closestNodeRef.current);
          }
        } else {
          setPinnedNode(null);
        }
      }
      pointerDownPos.current = null;
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
    };
  }, [gl.domElement, setPinnedNode]);

  // Snapshot original positions as lat/lng
  useEffect(() => {
    if (!graph || positions.size === 0) return;
    const origMap = new Map<string, { lat: number; lng: number }>();
    const curMap = new Map<string, { lat: number; lng: number }>();
    for (const node of graph.nodes) {
      const pos = positions.get(node.id);
      if (!pos) continue;
      const ll = xyzToLatLng(pos[0], pos[1], pos[2]);
      origMap.set(node.id, { ...ll });
      
      // Preserve existing current position so it smoothly glides to new orig
      const existingCur = currentLatLngs.current.get(node.id);
      if (existingCur) {
        curMap.set(node.id, { ...existingCur });
      } else {
        curMap.set(node.id, { ...ll });
      }
    }
    originalLatLngs.current = origMap;
    currentLatLngs.current = curMap;

    // Initialize shared displaced positions
    sharedDisplacedPositions.clear();
    for (const [id, pos] of positions) {
      sharedDisplacedPositions.set(id, [...pos]);
    }
    displacedPositionsVersion++;
  }, [graph, positions]);

  // Rebuild colors
  const updateColors = useCallback(() => {
    const mesh = meshRef.current;
    if (!mesh || !graph) return;
    const nodes = graph.nodes;
    const count = Math.min(nodes.length, MAX_NODES);
    mesh.count = count;
    nodeCount.current = count;
    const newFrontier: number[] = [];
    for (let i = 0; i < count; i++) {
      const node = nodes[i];
      const color = genreToThreeColor(node.genres);
      if (node.state === 'frontier') {
        color.lerp(new THREE.Color('#cccccc'), 0.35);
        newFrontier.push(i);
      }
      mesh.setColorAt(i, color);
    }
    frontierIndices.current = newFrontier;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [graph]);

  // Initial setup
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || !graph || positions.size === 0) return;
    const count = Math.min(graph.nodes.length, MAX_NODES);
    mesh.count = count;
    nodeCount.current = count;
    updateColors();
  }, [graph, positions, updateColors]);

  // ── Main frame loop ──
  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    const hitSphere = hitSphereRef.current;
    if (!mesh || !hitSphere || !graph) return;

    const nodes = graph.nodes;
    const count = Math.min(nodes.length, MAX_NODES);

    // ── Raycast for hover ──
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(hitSphere);
    if (hits.length > 0) {
      mouseGlobeLatLng.current = xyzToLatLng(hits[0].point.x, hits[0].point.y, hits[0].point.z);
      isHovering.current = true;
    } else {
      mouseGlobeLatLng.current = null;
      isHovering.current = false;
    }

    // ── Magnetic displacement ──
    let closestDist = Infinity;
    let closestNodeId: string | null = null;

    if (mouseGlobeLatLng.current) {
      for (const node of nodes) {
        const orig = originalLatLngs.current.get(node.id);
        if (!orig) continue;
        const dLat = mouseGlobeLatLng.current.lat - orig.lat;
        const dLng = mouseGlobeLatLng.current.lng - orig.lng;
        const dist = Math.sqrt(dLat * dLat + dLng * dLng);
        if (dist < closestDist) {
          closestDist = dist;
          closestNodeId = node.id;
        }
      }
    }

    for (const node of nodes) {
      const orig = originalLatLngs.current.get(node.id);
      const cur = currentLatLngs.current.get(node.id);
      if (!orig || !cur) continue;

      let targetLat = orig.lat;
      let targetLng = orig.lng;

      if (mouseGlobeLatLng.current) {
        const dLat = mouseGlobeLatLng.current.lat - orig.lat;
        const dLng = mouseGlobeLatLng.current.lng - orig.lng;
        const dist = Math.sqrt(dLat * dLat + dLng * dLng);

        if (dist < MAGNET_RADIUS && dist > 0.1) {
          const effect = MAGNET_STRENGTH * Math.pow(1 - dist / MAGNET_RADIUS, 2);
          if (node.id === closestNodeId && closestDist < 8) {
            // Single closest node snaps slightly to cursor
            targetLat = orig.lat + (dLat / dist) * (effect * 0.4);
            targetLng = orig.lng + (dLng / dist) * (effect * 0.4);
          } else {
            // Other nodes in radius are pushed AWAY to clear space and avoid collisions
            targetLat = orig.lat - (dLat / dist) * (effect * 0.75);
            targetLng = orig.lng - (dLng / dist) * (effect * 0.75);
          }
        }
      }

      cur.lat += (targetLat - cur.lat) * SNAP_SPEED;
      cur.lng += (targetLng - cur.lng) * SNAP_SPEED;
    }

    // Update hovered node (throttled — only when it changes)
    const newClosest = (isHovering.current && closestNodeId && closestDist < 8) ? closestNodeId : null;
    if (newClosest !== closestNodeRef.current) {
      closestNodeRef.current = newClosest;
      setHoveredNode(newClosest);
    }

    // ── Rebuild instance matrices (backface hiding + displacement) ──
    _camDir.copy(camera.position).normalize();
    const time = clock.getElapsedTime();
    const period = Math.PI * 2; // Perfect period loop boundary
    const t = time % period;
    const pulse = 0.94 + 0.08 * Math.sin(t);

    for (let i = 0; i < count; i++) {
      const node = nodes[i];
      const cur = currentLatLngs.current.get(node.id);
      if (!cur) continue;

      const [x, y, z] = latLngToXYZ(cur.lat, cur.lng, R * 1.008);

      // Write to shared map (EdgeField reads this)
      sharedDisplacedPositions.set(node.id, [x, y, z]);

      // Backface test
      _nodeDir.set(x, y, z).normalize();
      const facing = _nodeDir.dot(_camDir);
      const visibility = Math.max(0, Math.min(1, (facing + 0.05) / 0.3));

      let radius = getNodeRadius(node.weight) * visibility;
      // Frontier pulse
      if (node.state === 'frontier') radius *= pulse;

      _obj.position.set(x, y, z);
      _obj.scale.setScalar(radius);
      _outward.set(x, y, z).normalize().add(_obj.position);
      _obj.lookAt(_outward);
      _obj.updateMatrix();
      mesh.setMatrixAt(i, _obj.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
    displacedPositionsVersion++;
  });

  return (
    <group>
      <instancedMesh
        ref={meshRef}
        args={[geometry, material, MAX_NODES]}
        frustumCulled={false}
      />
      {/* Invisible hit sphere — no event handlers, pure raycasting target */}
      <mesh ref={hitSphereRef} visible={true}>
        <sphereGeometry args={[R * 1.05, 32, 16]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    </group>
  );
}
