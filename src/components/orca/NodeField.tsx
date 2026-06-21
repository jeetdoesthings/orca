'use client';

/**
 * NodeField — instanced mesh rendering for all artist nodes (explored & frontier) on the globe.
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
import { getGenreColor, xyzToLatLng, latLngToXYZ } from '@/lib/graph/genre-normaliser';
// Audio preview disabled

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

const MAX_NODES = 2500;
const R = 1.65;

// Magnetic hover constants
const MAGNET_RADIUS = 18;
const MAGNET_STRENGTH = 3.2;
const SNAP_SPEED = 0.08;

export function NodeField() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const hitSphereRef = useRef<THREE.Mesh>(null);
  
  const graph = useOrcaStore(s => s.graph);
  const frontierNodes = useOrcaStore(s => s.frontierNodes);
  const expansionEvent = useOrcaStore(s => s.expansionEvent);
  
  const positions = useOrcaStore(s => s.nodePositions);
  const setHoveredNode = useOrcaStore(s => s.setHoveredNode);
  const setPinnedNode = useOrcaStore(s => s.setPinnedNode);
  const setFocusedNode = useOrcaStore(s => s.setFocusedNode);
  const pinnedNodeId = useOrcaStore(s => s.pinnedNodeId);
  const focusedNodeId = useOrcaStore(s => s.focusedNodeId);
  
  const { camera, raycaster, pointer, gl } = useThree();

  const geometry = useMemo(() => {
    const geo = new THREE.CircleGeometry(1, 24);
    const dummyColors = new Float32Array(geo.attributes.position.count * 3).fill(1.0);
    geo.setAttribute('color', new THREE.BufferAttribute(dummyColors, 3));
    return geo;
  }, []);
  const material = useMemo(() => {
    const mat = new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide,
      depthWrite: false,
      transparent: true,
      opacity: 0.92,
      vertexColors: true,
    });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = `
        attribute float instanceOpacity;
        varying float vOpacity;
      ` + shader.vertexShader;

      shader.vertexShader = shader.vertexShader.replace(
        'void main() {',
        `
        void main() {
          vOpacity = instanceOpacity;
        `
      );

      shader.fragmentShader = `
        varying float vOpacity;
      ` + shader.fragmentShader;

      shader.fragmentShader = shader.fragmentShader.replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        'vec4 diffuseColor = vec4( diffuse, opacity * vOpacity );'
      );
    };
    return mat;
  }, []);

  const opacityAttrRef = useRef<THREE.InstancedBufferAttribute | null>(null);

  useEffect(() => {
    if (!geometry) return;
    const opacities = new Float32Array(MAX_NODES).fill(1.0);
    const attr = new THREE.InstancedBufferAttribute(opacities, 1);
    geometry.setAttribute('instanceOpacity', attr);
    opacityAttrRef.current = attr;
  }, [geometry]);

  const _obj = useMemo(() => new THREE.Object3D(), []);
  const _outward = useMemo(() => new THREE.Vector3(), []);
  const _camDir = useMemo(() => new THREE.Vector3(), []);
  const _nodeDir = useMemo(() => new THREE.Vector3(), []);

  const nodeCount = useRef(0);

  // Magnetic hover state (all refs — no React state)
  const originalLatLngs = useRef<Map<string, { lat: number; lng: number }>>(new Map());
  const currentLatLngs = useRef<Map<string, { lat: number; lng: number }>>(new Map());
  const mouseGlobeLatLng = useRef<{ lat: number; lng: number } | null>(null);
  const isHovering = useRef(false);
  const closestNodeRef = useRef<string | null>(null);
  const nodeScales = useRef<Map<string, number>>(new Map()); // Smooth scaling progress for focused node transition

  // Click detection state
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null);
  const pointerDownTime = useRef(0);

  // Combine graph nodes and frontier nodes
  const allNodes = useMemo(() => {
    if (!graph) return [];
    return [...graph.nodes, ...frontierNodes];
  }, [graph, frontierNodes]);

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
            setFocusedNode(null); // Clear focus too
          } else {
            setPinnedNode(closestNodeRef.current);
            setFocusedNode(closestNodeRef.current); // Set camera focus
          }
        } else {
          setPinnedNode(null);
          setFocusedNode(null); // Clear focus on clicking empty space
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
  }, [gl.domElement, setPinnedNode, setFocusedNode]);

  // Snapshot original positions as lat/lng
  useEffect(() => {
    if (!graph || positions.size === 0) return;
    const origMap = new Map<string, { lat: number; lng: number }>();
    const curMap = new Map<string, { lat: number; lng: number }>();
    
    for (const node of allNodes) {
      let pos = positions.get(node.id);
      if (!pos && node.x !== undefined && node.y !== undefined && node.z !== undefined) {
        pos = [node.x, node.y, node.z];
      }
      if (!pos) continue;

      const ll = xyzToLatLng(pos[0], pos[1], pos[2]);
      origMap.set(node.id, { ...ll });
      
      // Preserve existing current position so it smoothly glides
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
    for (const node of allNodes) {
      let pos = positions.get(node.id);
      if (!pos && node.x !== undefined && node.y !== undefined && node.z !== undefined) {
        pos = [node.x, node.y, node.z];
      }
      if (pos) {
        sharedDisplacedPositions.set(node.id, [...pos]);
      }
    }
    displacedPositionsVersion++;

    // Reset opacities to 1.0 when graph or positions changes
    const attr = opacityAttrRef.current;
    if (attr) {
      attr.array.fill(1.0);
      attr.needsUpdate = true;
    }
  }, [graph, positions, allNodes]);

  // Rebuild colors
  const updateColors = useCallback(() => {
    const mesh = meshRef.current;
    if (!mesh || allNodes.length === 0) return;

    const count = Math.min(allNodes.length, MAX_NODES);
    mesh.count = count;
    nodeCount.current = count;

    if (!mesh.instanceColor || mesh.instanceColor.count < MAX_NODES) {
      const colors = new Float32Array(MAX_NODES * 3).fill(1.0);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    }

    for (let i = 0; i < count; i++) {
      const node = allNodes[i];
      const color = genreToThreeColor(node.genres);
      mesh.setColorAt(i, color);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [allNodes]);

  // Colors setup
  useEffect(() => {
    updateColors();
  }, [allNodes, updateColors]);

  // ── Main frame loop ──
  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    const hitSphere = hitSphereRef.current;
    if (!mesh || !hitSphere || allNodes.length === 0) return;

    const count = Math.min(allNodes.length, MAX_NODES);

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
      for (const node of allNodes) {
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

    for (const node of allNodes) {
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
            // Single closest snaps to cursor
            targetLat = orig.lat + (dLat / dist) * (effect * 0.4);
            targetLng = orig.lng + (dLng / dist) * (effect * 0.4);
          } else {
            // Pushed away to clear space
            targetLat = orig.lat - (dLat / dist) * (effect * 0.75);
            targetLng = orig.lng - (dLng / dist) * (effect * 0.75);
          }
        }
      }

      cur.lat += (targetLat - cur.lat) * SNAP_SPEED;
      cur.lng += (targetLng - cur.lng) * SNAP_SPEED;
    }

    // Update hovered node (throttled)
    const newClosest = (isHovering.current && closestNodeId && closestDist < 8) ? closestNodeId : null;
    if (newClosest !== closestNodeRef.current) {
      closestNodeRef.current = newClosest;
      setHoveredNode(newClosest);
    }

    // ── Collect neighbors if pinned ──
    const directNeighbors = new Set<string>();
    const secondaryNeighbors = new Set<string>();

    if (pinnedNodeId && graph) {
      for (const edge of graph.edges) {
        const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
        const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
        if (sourceId === pinnedNodeId) {
          directNeighbors.add(targetId);
        } else if (targetId === pinnedNodeId) {
          directNeighbors.add(sourceId);
        }
      }
      for (const edge of graph.edges) {
        const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
        const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
        if (sourceId === pinnedNodeId || targetId === pinnedNodeId) continue;
        if (directNeighbors.has(sourceId) && !directNeighbors.has(targetId)) {
          secondaryNeighbors.add(targetId);
        } else if (directNeighbors.has(targetId) && !directNeighbors.has(sourceId)) {
          secondaryNeighbors.add(sourceId);
        }
      }
    }

    // ── Rebuild instance matrices ──
    _camDir.copy(camera.position).normalize();
    
    // Smooth out-of-phase staggered pulsing math
    const time = clock.getElapsedTime();

    const attr = opacityAttrRef.current;
    let colorNeedsUpdate = false;

    for (let i = 0; i < count; i++) {
      const node = allNodes[i];
      const cur = currentLatLngs.current.get(node.id);
      if (!cur) continue;

      const [x, y, z] = latLngToXYZ(cur.lat, cur.lng, R * 1.008);

      // Write to shared map for EdgeField lookup
      sharedDisplacedPositions.set(node.id, [x, y, z]);

      // Backface visibility calculation
      _nodeDir.set(x, y, z).normalize();
      const facing = _nodeDir.dot(_camDir);
      const visibility = Math.max(0, Math.min(1, (facing + 0.05) / 0.3));

      const baseWeight = node.weight;
      let scaleMultiplier = 1.0;
      let targetOpacity = 0.92;

      // Frontier node pulse: staggered slow pulse of scale, keeping opacity bright (0.92)
      if (node.state === 'frontier') {
        const phase = (time + i * 0.23) % 3.5;
        // Pulse scaleMultiplier between 0.95 and 1.25
        scaleMultiplier = 1.10 + 0.15 * Math.sin(phase * Math.PI * 2 / 3.5);
      }

      // Transition node celebration animations
      if (expansionEvent && expansionEvent.nodeId === node.id) {
        const elapsed = Date.now() - expansionEvent.timestamp;
        if (elapsed < 1200) {
          colorNeedsUpdate = true;
          const color = genreToThreeColor(node.genres);
          
          if (elapsed < 400) {
            // Scale up phase: 0-400ms, cubic ease-out
            const t = elapsed / 400;
            const ease = 1 - Math.pow(1 - t, 3);
            scaleMultiplier = 0.65 + (1.4 - 0.65) * ease;
            targetOpacity = 0.38 + 0.62 * ease;
            color.lerp(new THREE.Color('#fafafa'), 0.85 * (1 - ease));
          } else {
            // Scale down phase: 400-1200ms, quad ease-out
            const t = (elapsed - 400) / 800;
            const ease = 1 - Math.pow(1 - t, 2);
            scaleMultiplier = 1.4 - 0.4 * ease;
            targetOpacity = 1.0;
            // Remains at full biome saturation color
          }
          mesh.setColorAt(i, color);
        }
      }

      let radius = getNodeRadius(baseWeight) * scaleMultiplier * visibility;

      // Pinned Node Camera focus transitions
      const isFocused = node.id === focusedNodeId;
      const targetScale = isFocused ? 0 : 1;
      let currentScale = nodeScales.current.get(node.id) ?? 1;
      currentScale += (targetScale - currentScale) * 0.15;
      nodeScales.current.set(node.id, currentScale);
      
      radius *= currentScale;

      _obj.position.set(x, y, z);
      _obj.scale.setScalar(radius);
      _outward.set(x, y, z).normalize().add(_obj.position);
      _obj.lookAt(_outward);
      _obj.updateMatrix();
      mesh.setMatrixAt(i, _obj.matrix);

      // Relationship isolation opacity dampening
      if (pinnedNodeId) {
        if (node.id === pinnedNodeId || directNeighbors.has(node.id)) {
          // Keep base targetOpacity
        } else if (secondaryNeighbors.has(node.id)) {
          targetOpacity = Math.min(targetOpacity, 0.5);
        } else {
          targetOpacity = Math.min(targetOpacity, 0.15);
        }
      }

      if (attr) {
        const currentOpacity = attr.getX(i);
        const nextOpacity = currentOpacity + (targetOpacity - currentOpacity) * 0.15;
        attr.setX(i, nextOpacity);
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (colorNeedsUpdate && mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
    if (attr) {
      attr.needsUpdate = true;
    }
    displacedPositionsVersion++;
  });

  return (
    <group>
      <instancedMesh
        ref={(el) => {
          if (el && !el.instanceColor) {
            const colors = new Float32Array(MAX_NODES * 3).fill(1.0);
            el.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
          }
          meshRef.current = el;
        }}
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
