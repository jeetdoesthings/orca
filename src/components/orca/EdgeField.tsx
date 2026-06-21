'use client';

/**
 * EdgeField — connection lines between artists on the globe surface.
 * Includes luminescent glows for the active node and its connected peers.
 * Uses LineSegments with bezier arcs for performant batch rendering.
 * Reads displaced positions from shared module state to avoid 60fps React re-renders.
 */
import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useOrcaStore } from '@/store/orca';
import { genreToColor } from '@/lib/graph/builder';
import { sharedDisplacedPositions, displacedPositionsVersion } from './NodeField';

const R = 1.65;
const CONN_SEGMENTS = 8;
const MAX_GLOWS = 100;

export function EdgeField() {
  const lineRef = useRef<THREE.LineSegments>(null);
  const glowMeshRef = useRef<THREE.InstancedMesh>(null);
  
  const graph = useOrcaStore(s => s.graph);
  const positions = useOrcaStore(s => s.nodePositions);
  const hoveredNodeId = useOrcaStore(s => s.hoveredNodeId);
  const pinnedNodeId = useOrcaStore(s => s.pinnedNodeId);
  const frontierNodes = useOrcaStore(s => s.frontierNodes);

  // We track the last version we rendered to avoid rebuilding geometry every frame
  const lastRenderedVersion = useRef(-1);
  const lastActiveNodeId = useRef<string | null>(null);

  // Luminescent Edge Material (Custom Shader for Per-Vertex Opacity/RGBA)
  const lineMaterial = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: `
      attribute vec4 color;
      varying vec4 vColor;
      void main() {
        vColor = color;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec4 vColor;
      void main() {
        gl_FragColor = vColor;
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }), []);

  // Luminescent Anamorphic Glow Material
  const glowGeo = useMemo(() => new THREE.PlaneGeometry(0.8, 0.12), []); // wide geometry for the streak
  const glowMaterial = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: `
      varying vec2 vUv;
      attribute vec3 instanceColor;
      varying vec3 vColor;
      void main() {
        vUv = uv;
        vColor = instanceColor;
        // Billboard
        vec4 mvPosition = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        mvPosition.xy += position.xy;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying vec3 vColor;
      void main() {
        vec2 uv = vUv - 0.5;
        
        // Horizontal anamorphic streak
        float streakDist = length(uv * vec2(0.4, 25.0)); // stretched very wide and thin
        float streakAlpha = smoothstep(0.5, 0.0, streakDist) * 1.5;
        
        // Core glow
        float coreDist = length(uv * vec2(8.0, 8.0));
        float coreAlpha = smoothstep(0.5, 0.0, coreDist) * 2.0;
        
        // Combine
        float alpha = max(streakAlpha, coreAlpha);
        
        // White core, colored outer streak
        vec3 color = mix(vColor, vec3(1.0), coreAlpha * 0.8);
        
        gl_FragColor = vec4(color, alpha * 0.9);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }), []);

  // Temp objects for instanced mesh
  const _obj = useMemo(() => new THREE.Object3D(), []);
  const _color = useMemo(() => new THREE.Color(), []);

  // Build node lookup by ID
  const nodeMap = useMemo(() => {
    const map = new Map<string, any>();
    if (graph) {
      for (const node of graph.nodes) {
        map.set(node.id, node);
      }
    }
    for (const node of frontierNodes) {
      map.set(node.id, node);
    }
    return map;
  }, [graph, frontierNodes]);

  // Rebuild geometry when edges, positions, or hover state change
  useFrame(({ camera }) => {
    if (!graph || !lineRef.current || !glowMeshRef.current || positions.size === 0) return;

    // Active node: pinned takes priority over hovered
    const activeNodeId = pinnedNodeId ?? hoveredNodeId;

    // Only rebuild if the magnetic positions changed OR the active node changed
    if (lastRenderedVersion.current === displacedPositionsVersion && lastActiveNodeId.current === activeNodeId) {
      // Still need to update billboarding for glows if camera moved
      if (glowMeshRef.current.count > 0) {
        for (let i = 0; i < glowMeshRef.current.count; i++) {
          glowMeshRef.current.getMatrixAt(i, _obj.matrix);
          _obj.position.setFromMatrixPosition(_obj.matrix);
          _obj.quaternion.copy(camera.quaternion); // Billboard
          _obj.updateMatrix();
          glowMeshRef.current.setMatrixAt(i, _obj.matrix);
        }
        glowMeshRef.current.instanceMatrix.needsUpdate = true;
      }
      return;
    }

    lastRenderedVersion.current = displacedPositionsVersion;
    lastActiveNodeId.current = activeNodeId;

    if (!activeNodeId) {
      // Clear edges & glows
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3));
      lineRef.current.geometry.dispose();
      lineRef.current.geometry = geometry;
      glowMeshRef.current.count = 0;
      return;
    }

    const activePositions = sharedDisplacedPositions.size > 0 ? sharedDisplacedPositions : positions;

    // Collect neighbors if pinned
    const directNeighbors = new Set<string>();
    const secondaryNeighbors = new Set<string>();

    // Build dynamic frontier edges for the active node
    const frontierEdges: { source: string; target: string; type: string; weight: number }[] = [];
    if (activeNodeId) {
      // Case 1: activeNodeId is an explored artist, we find adjacent unexplored nodes
      for (const fn of frontierNodes) {
        if (fn.adjacentTo && fn.adjacentTo.includes(activeNodeId)) {
          frontierEdges.push({
            source: activeNodeId,
            target: fn.id,
            type: 'related',
            weight: 0.65,
          });
        }
      }

      // Case 2: activeNodeId is an unexplored artist, we connect it to the explored nodes that introduced it
      const activeFrontierNode = frontierNodes.find(n => n.id === activeNodeId);
      if (activeFrontierNode && activeFrontierNode.adjacentTo) {
        for (const adjId of activeFrontierNode.adjacentTo) {
          frontierEdges.push({
            source: activeNodeId,
            target: adjId,
            type: 'related',
            weight: 0.65,
          });
        }
      }
    }

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

      // Add adjacent unexplored nodes to directNeighbors (when active is explored)
      for (const fn of frontierNodes) {
        if (fn.adjacentTo && fn.adjacentTo.includes(pinnedNodeId)) {
          directNeighbors.add(fn.id);
        }
      }

      // Add adjacent explored nodes to directNeighbors (when active is unexplored)
      const activeFrontierNode = frontierNodes.find(n => n.id === pinnedNodeId);
      if (activeFrontierNode && activeFrontierNode.adjacentTo) {
        for (const adjId of activeFrontierNode.adjacentTo) {
          directNeighbors.add(adjId);
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

    // Determine edges to render:
    // If pinnedNodeId is set, we render ALL edges in the graph with varying intensities.
    // Otherwise, we only render edges connected to activeNodeId (which would be hoveredNodeId in this case).
    const baseEdges = pinnedNodeId
      ? graph.edges
      : graph.edges.filter(edge => {
          const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
          const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
          return sourceId === activeNodeId || targetId === activeNodeId;
        });

    const edgesToRender = [...baseEdges, ...frontierEdges];

    // ── Build Edges ──
    // Calculate total vertices needed (direct edges are rendered 3x for thickness)
    let totalSegments = 0;
    for (const edge of edgesToRender) {
      const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
      const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
      const isDirect = pinnedNodeId && (sourceId === pinnedNodeId || targetId === pinnedNodeId);
      totalSegments += isDirect ? (CONN_SEGMENTS * 3) : CONN_SEGMENTS;
    }

    const totalVerts = totalSegments * 2;
    const posArray = new Float32Array(totalVerts * 3);
    const colArray = new Float32Array(totalVerts * 4); // 4 components for RGBA!

    let idx = 0;
    const _s = new THREE.Vector3();
    const _e = new THREE.Vector3();
    const _m = new THREE.Vector3();
    const _c1 = new THREE.Color();
    const _c2 = new THREE.Color();
    const _blend = new THREE.Color();

    const tangent = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const perp = new THREE.Vector3();
    const cameraDist = camera.position.length();
    const offsetAmount = Math.max(0.00025, Math.min(0.0016, 0.00045 * (cameraDist - 1.55)));

    // Collect unique node IDs to glow: ONLY activeNodeId and its direct neighbors get glows
    const glowingNodes = new Set<string>();
    glowingNodes.add(activeNodeId);

    const activeEdgesForGlow = edgesToRender.filter(edge => {
      const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
      const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
      return sourceId === activeNodeId || targetId === activeNodeId;
    });

    for (const edge of activeEdgesForGlow) {
      const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
      const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
      glowingNodes.add(sourceId);
      glowingNodes.add(targetId);
    }

    for (const edge of edgesToRender) {
      const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
      const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;

      const sourcePos = activePositions.get(sourceId) || positions.get(sourceId);
      const targetPos = activePositions.get(targetId) || positions.get(targetId);
      if (!sourcePos || !targetPos) continue;

      const sourceNode = nodeMap.get(sourceId);
      const targetNode = nodeMap.get(targetId);

      _s.set(sourcePos[0], sourcePos[1], sourcePos[2]);
      _e.set(targetPos[0], targetPos[1], targetPos[2]);

      const dist = _s.distanceTo(_e);
      const isCross = edge.type !== 'genre';
      const altitude = isCross ? dist * 0.25 : 0.015;
      _m.addVectors(_s, _e).multiplyScalar(0.5);
      const mn = _m.clone().normalize();
      _m.copy(mn.multiplyScalar(_m.length() + altitude));

      const curve = new THREE.QuadraticBezierCurve3(_s.clone(), _m.clone(), _e.clone());
      const pts = curve.getPoints(CONN_SEGMENTS);

      const g1 = sourceNode?.genres[0] || '';
      const g2 = targetNode?.genres[0] || '';
      _c1.set(genreToColor(g1));
      _c2.set(genreToColor(g2));
      
      // Bump brightness for luminescent lines
      _blend.copy(_c1).lerp(_c2, 0.5).multiplyScalar(isCross ? 0.7 : 1.0);

      // Determine edge category & apply brightness/opacity multipliers
      let isDirect = false;
      const finalColor = _blend.clone();
      let alpha = 0.85;

      if (pinnedNodeId) {
        if (sourceId === pinnedNodeId || targetId === pinnedNodeId) {
          isDirect = true;
          finalColor.multiplyScalar(1.5); // Brighter direct neighbor edges
          alpha = 1.0;
        } else if (
          directNeighbors.has(sourceId) || directNeighbors.has(targetId)
        ) {
          alpha = 0.25; // Dimmer secondary connections
        } else {
          alpha = 0.035; // Faded significantly for unrelated connections (extremely faint!)
        }
      } else {
        alpha = 0.85;
      }

      const addSegment = (ptsList: THREE.Vector3[]) => {
        for (let seg = 0; seg < CONN_SEGMENTS; seg++) {
          if (seg + 1 >= ptsList.length) break;
          
          posArray[idx * 3] = ptsList[seg].x;
          posArray[idx * 3 + 1] = ptsList[seg].y;
          posArray[idx * 3 + 2] = ptsList[seg].z;
          colArray[idx * 4] = finalColor.r;
          colArray[idx * 4 + 1] = finalColor.g;
          colArray[idx * 4 + 2] = finalColor.b;
          colArray[idx * 4 + 3] = alpha;
          idx++;

          posArray[idx * 3] = ptsList[seg + 1].x;
          posArray[idx * 3 + 1] = ptsList[seg + 1].y;
          posArray[idx * 3 + 2] = ptsList[seg + 1].z;
          colArray[idx * 4] = finalColor.r;
          colArray[idx * 4 + 1] = finalColor.g;
          colArray[idx * 4 + 2] = finalColor.b;
          colArray[idx * 4 + 3] = alpha;
          idx++;
        }
      };

      if (isDirect) {
        // Render center line
        addSegment(pts);

        // Render left and right offset lines to simulate thickness
        const ptsLeft: THREE.Vector3[] = [];
        const ptsRight: THREE.Vector3[] = [];

        for (let seg = 0; seg < pts.length; seg++) {
          const p = pts[seg];
          let tVec = tangent;
          if (seg + 1 < pts.length) {
            tVec.subVectors(pts[seg + 1], p).normalize();
          } else {
            tVec.subVectors(p, pts[seg - 1]).normalize();
          }
          normal.copy(p).normalize();
          perp.crossVectors(tVec, normal).normalize().multiplyScalar(offsetAmount);

          ptsLeft.push(p.clone().add(perp));
          ptsRight.push(p.clone().sub(perp));
        }

        addSegment(ptsLeft);
        addSegment(ptsRight);
      } else {
        addSegment(pts);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(posArray.slice(0, idx * 3), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colArray.slice(0, idx * 4), 4)); // 4 components for RGBA!

    lineRef.current.geometry.dispose();
    lineRef.current.geometry = geometry;

    // ── Build Glows ──
    const glowCount = Math.min(glowingNodes.size, MAX_GLOWS);
    glowMeshRef.current.count = glowCount;
    let gIdx = 0;
    
    for (const nodeId of glowingNodes) {
      if (gIdx >= MAX_GLOWS) break;
      const pos = activePositions.get(nodeId) || positions.get(nodeId);
      if (!pos) continue;

      _obj.position.set(pos[0], pos[1], pos[2]);
      _obj.quaternion.copy(camera.quaternion); // Billboard to face camera
      _obj.updateMatrix();
      glowMeshRef.current.setMatrixAt(gIdx, _obj.matrix);

      const node = nodeMap.get(nodeId);
      _color.set(genreToColor(node?.genres[0] || ''));
      // Boost the active node's glow brightness
      if (nodeId === activeNodeId) _color.multiplyScalar(1.5);
      
      glowMeshRef.current.setColorAt(gIdx, _color);
      gIdx++;
    }
    
    glowMeshRef.current.instanceMatrix.needsUpdate = true;
    if (glowMeshRef.current.instanceColor) glowMeshRef.current.instanceColor.needsUpdate = true;
  });

  return (
    <group>
      <lineSegments ref={lineRef} material={lineMaterial} frustumCulled={false} />
      <instancedMesh
        ref={(el) => {
          if (el && !el.instanceColor) {
            const colors = new Float32Array(MAX_GLOWS * 3).fill(1.0);
            el.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
          }
          glowMeshRef.current = el;
        }}
        args={[glowGeo, glowMaterial, MAX_GLOWS]}
        frustumCulled={false}
      />
    </group>
  );
}
