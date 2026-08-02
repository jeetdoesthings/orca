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

function genreToThreeColorRef(genres: string[]): THREE.Color {
  const genre = (genres[0] || '').toLowerCase();
  if (!GENRE_COLORS_THREE[genre]) {
    GENRE_COLORS_THREE[genre] = new THREE.Color(getGenreColor(genre));
  }
  return GENRE_COLORS_THREE[genre];
}

function getNodeRadius(weight: number, isFrontier = false): number {
  // Slightly larger dots so light-mode globe stays readable
  if (isFrontier) {
    if (weight > 0.5) return 0.032;
    return 0.026;
  }
  if (weight > 0.8) return 0.034;
  if (weight > 0.5) return 0.028;
  if (weight > 0.2) return 0.022;
  return 0.018;
}

const MAX_NODES = 2500;
const R = 1.65;

// Magnetic hover — only the single closest node, and only when truly near cursor.
// Old MAGNET_RADIUS=18 + push-away made the whole field churn whenever pointer sat on globe.
const MAGNET_RADIUS = 5.5;
const MAGNET_STRENGTH = 1.6;
const SNAP_SPEED = 0.14;
const HOVER_ACTIVATE_DIST = 6;

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
      opacity: 1.0,
      vertexColors: true,
    });
    mat.onBeforeCompile = (shader) => {
      // instanceOpacity is custom (not Three built-in) — declare once.
      if (!shader.vertexShader.includes('attribute float instanceOpacity')) {
        shader.vertexShader =
          `attribute float instanceOpacity;\nvarying float vOpacity;\n` +
          shader.vertexShader;
      }
      if (!shader.vertexShader.includes('vOpacity = instanceOpacity')) {
        shader.vertexShader = shader.vertexShader.replace(
          'void main() {',
          `void main() {
          vOpacity = instanceOpacity;
        `,
        );
      }

      if (!shader.fragmentShader.includes('varying float vOpacity')) {
        shader.fragmentShader =
          `varying float vOpacity;\n` + shader.fragmentShader;
      }
      if (!shader.fragmentShader.includes('opacity * vOpacity')) {
        shader.fragmentShader = shader.fragmentShader.replace(
          'vec4 diffuseColor = vec4( diffuse, opacity );',
          'vec4 diffuseColor = vec4( diffuse, opacity * vOpacity );',
        );
      }
    };
    mat.customProgramCacheKey = () => 'orca-nodefield-opacity-v3';
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
  const _tempColor = useMemo(() => new THREE.Color(), []);
  const _whiteColor = useMemo(() => new THREE.Color('#ffffff'), []);
  const _blendColor = useMemo(() => new THREE.Color(), []);

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

  const allNodes = useMemo(() => {
    if (!graph) return [];
    const explored = graph.nodes.map((n) => ({ ...n, state: 'explored' as const }));
    // Only in-depth unexplored nodes — out-of-band must disappear
    const frontier = frontierNodes
      .filter((n) => n.visible !== false && n.reachable !== false)
      .map((n) => ({ ...n, state: 'frontier' as const }));
    return [...explored, ...frontier];
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
    mesh.count = count;

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

    // ── Magnetic displacement (closest node only; rest stay parked) ──
    let closestDist = Infinity;
    let closestNodeId: string | null = null;

    if (mouseGlobeLatLng.current) {
      for (const node of allNodes) {
        const orig = originalLatLngs.current.get(node.id);
        if (!orig) continue;

        // Skip out-of-window or OCSE-rejected frontier for hover / snap
        if (node.state === 'frontier' && (node.visible === false || node.reachable === false)) {
          continue;
        }

        const dLat = mouseGlobeLatLng.current.lat - orig.lat;
        const dLng = mouseGlobeLatLng.current.lng - orig.lng;
        const dist = Math.sqrt(dLat * dLat + dLng * dLng);
        if (dist < closestDist) {
          closestDist = dist;
          closestNodeId = node.id;
        }
      }
    }

    const magnetActive =
      !!mouseGlobeLatLng.current &&
      !!closestNodeId &&
      closestDist < HOVER_ACTIVATE_DIST;

    for (const node of allNodes) {
      const orig = originalLatLngs.current.get(node.id);
      const cur = currentLatLngs.current.get(node.id);
      if (!orig || !cur) continue;

      let targetLat = orig.lat;
      let targetLng = orig.lng;

      // Only the hovered node drifts toward cursor — no field-wide push-away
      if (
        magnetActive &&
        mouseGlobeLatLng.current &&
        node.id === closestNodeId &&
        closestDist > 0.1 &&
        closestDist < MAGNET_RADIUS
      ) {
        const dLat = mouseGlobeLatLng.current.lat - orig.lat;
        const dLng = mouseGlobeLatLng.current.lng - orig.lng;
        const dist = Math.max(closestDist, 0.1);
        const effect = MAGNET_STRENGTH * Math.pow(1 - dist / MAGNET_RADIUS, 2);
        targetLat = orig.lat + (dLat / dist) * (effect * 0.35);
        targetLng = orig.lng + (dLng / dist) * (effect * 0.35);
      }

      // Snap hard when near rest so field doesn't micro-jitter forever
      const dLatT = targetLat - cur.lat;
      const dLngT = targetLng - cur.lng;
      if (Math.abs(dLatT) + Math.abs(dLngT) < 0.002) {
        cur.lat = targetLat;
        cur.lng = targetLng;
      } else {
        cur.lat += dLatT * SNAP_SPEED;
        cur.lng += dLngT * SNAP_SPEED;
      }
    }

    // Update hovered node (throttled)
    const newClosest =
      isHovering.current && closestNodeId && closestDist < HOVER_ACTIVATE_DIST
        ? closestNodeId
        : null;
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
      // Frontier seed links are not in graph.edges — include adjacentTo
      const frontierNodesNow = useOrcaStore.getState().frontierNodes;
      const pinnedFrontier = frontierNodesNow.find((f) => f.id === pinnedNodeId);
      if (pinnedFrontier?.adjacentTo) {
        for (const adj of pinnedFrontier.adjacentTo) {
          directNeighbors.add(adj);
        }
      }
      for (const fn of frontierNodesNow) {
        if (fn.adjacentTo?.includes(pinnedNodeId)) {
          directNeighbors.add(fn.id);
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

      const baseWeight = node.weight ?? 0.4;
      let scaleMultiplier = 1.0;
      // Explored: solid and bright on light globe
      let targetOpacity = 0.98;

      // Frontier: opacity breathe only — no scale thrash (looked like nodes crawling)
      if (node.state === 'frontier') {
        const phase = (time + i * 0.23) % 3.5;
        const wave = Math.sin((phase * Math.PI * 2) / 3.5);
        scaleMultiplier = 1.05;
        const pulseOpacity = 0.9 + 0.06 * wave;
        const tierMul =
          typeof node.tierEmphasis === 'number' ? node.tierEmphasis : 1;
        targetOpacity = Math.max(0.6, pulseOpacity * tierMul);
        scaleMultiplier *= 0.94 + 0.1 * Math.min(1, tierMul);

        colorNeedsUpdate = true;
        _tempColor.copy(genreToThreeColorRef(node.genres));
        // Subtle lift, not washed-out white
        _tempColor.lerp(_whiteColor, 0.1 + 0.05 * wave);
        mesh.setColorAt(i, _tempColor);

        if (node.visible === false || node.reachable === false) {
          scaleMultiplier = 0.0;
          targetOpacity = 0.0;
        }
      } else {
        colorNeedsUpdate = true;
        _tempColor.copy(genreToThreeColorRef(node.genres));
        // Slight saturate boost for explored on light bg
        _tempColor.offsetHSL(0, 0.05, 0.02);
        mesh.setColorAt(i, _tempColor);
      }

      // Transition node celebration animations
      if (expansionEvent && expansionEvent.nodeId === node.id) {
        const elapsed = Date.now() - expansionEvent.timestamp;
        if (elapsed < 1200) {
          colorNeedsUpdate = true;
          // Use _tempColor to avoid garbage collection allocation
          _tempColor.copy(genreToThreeColorRef(node.genres));
          
          if (elapsed < 400) {
            // Scale up phase: 0-400ms, cubic ease-out
            const t = elapsed / 400;
            const ease = 1 - Math.pow(1 - t, 3);
            scaleMultiplier = 0.65 + (1.4 - 0.65) * ease;
            targetOpacity = 0.38 + 0.62 * ease;
            // Lerp with _whiteColor to make it flash
            _tempColor.lerp(_whiteColor, 0.85 * (1 - ease));
          } else {
            // Scale down phase: 400-1200ms, quad ease-out
            const t = (elapsed - 400) / 800;
            const ease = 1 - Math.pow(1 - t, 2);
            scaleMultiplier = 1.4 - 0.4 * ease;
            targetOpacity = 1.0;
            // Remains at full biome saturation color
          }
          mesh.setColorAt(i, _tempColor);
        }
      }

      // Soft backface: don't zero out edge-on nodes completely
      const faceMul = 0.35 + 0.65 * visibility;
      let radius =
        getNodeRadius(baseWeight, node.state === 'frontier') *
        scaleMultiplier *
        faceMul;

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

      // Pin isolation: dim others gently (still visible on light globe)
      if (pinnedNodeId) {
        if (node.id === pinnedNodeId || directNeighbors.has(node.id)) {
          targetOpacity = Math.max(targetOpacity, 0.95);
          if (node.id === pinnedNodeId) radius *= 1.2;
        } else if (secondaryNeighbors.has(node.id)) {
          targetOpacity = Math.min(targetOpacity, 0.72);
        } else {
          targetOpacity = Math.min(targetOpacity, 0.5);
        }
        // Re-apply matrix if radius changed for pin
        if (node.id === pinnedNodeId) {
          _obj.scale.setScalar(radius);
          _obj.updateMatrix();
          mesh.setMatrixAt(i, _obj.matrix);
        }
      }

      if (attr) {
        const currentOpacity = attr.getX(i);
        // Snap toward target faster so UI doesn't lag into "invisible"
        const nextOpacity = currentOpacity + (targetOpacity - currentOpacity) * 0.28;
        attr.setX(i, Math.min(1, Math.max(0, nextOpacity)));
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
