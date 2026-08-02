'use client';

/**
 * EdgeField — connection lines for the active (hovered / pinned) artist only.
 * Explored: graph.edges. Frontier: adjacentTo seeds, else k-nearest explored.
 * Idle (no hover/pin) draws nothing — keeps globe clean.
 * Positions from sharedDisplacedPositions (NodeField).
 */
import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useOrcaStore } from '@/store/orca';
import { genreToColor } from '@/lib/graph/builder';
import { sharedDisplacedPositions, displacedPositionsVersion } from './NodeField';

const CONN_SEGMENTS = 8;
const MAX_EDGES = 8;
const MIN_FRONTIER_EDGES = 3;

type Cand = {
  source: string;
  target: string;
  type: string;
  weight: number;
  dist: number;
};

export function EdgeField() {
  const lineRef = useRef<THREE.LineSegments>(null);

  const graph = useOrcaStore((s) => s.graph);
  const positions = useOrcaStore((s) => s.nodePositions);
  const hoveredNodeId = useOrcaStore((s) => s.hoveredNodeId);
  const pinnedNodeId = useOrcaStore((s) => s.pinnedNodeId);
  const frontierNodes = useOrcaStore((s) => s.frontierNodes);

  const lastRenderedVersion = useRef(-1);
  const lastActiveNodeId = useRef<string | null>(null);

  const lineMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
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
        depthTest: true,
        blending: THREE.NormalBlending,
      }),
    [],
  );

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

  useFrame(({ camera }) => {
    if (!graph || !lineRef.current) return;
    if (positions.size === 0 && sharedDisplacedPositions.size === 0) return;

    const activeNodeId = pinnedNodeId ?? hoveredNodeId;

    // Only rebuild when active changes or positions version jumps a lot.
    // NodeField bumps version every frame during magnet — skip tiny thrash
    // by also requiring active id stability for skip path when version same.
    if (
      lastRenderedVersion.current === displacedPositionsVersion &&
      lastActiveNodeId.current === activeNodeId
    ) {
      return;
    }

    lastRenderedVersion.current = displacedPositionsVersion;
    lastActiveNodeId.current = activeNodeId;

    // Clean globe when nothing focused
    if (!activeNodeId) {
      if (lineRef.current.geometry.attributes.position?.count) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          'position',
          new THREE.BufferAttribute(new Float32Array(0), 3),
        );
        geometry.setAttribute(
          'color',
          new THREE.BufferAttribute(new Float32Array(0), 4),
        );
        lineRef.current.geometry.dispose();
        lineRef.current.geometry = geometry;
      }
      return;
    }

    const getPos = (id: string): [number, number, number] | null => {
      const fromShared = sharedDisplacedPositions.get(id);
      if (fromShared) return fromShared;
      const fromLayout = positions.get(id);
      if (fromLayout) return fromLayout as [number, number, number];
      const n = nodeMap.get(id);
      if (
        n &&
        typeof n.x === 'number' &&
        typeof n.y === 'number' &&
        typeof n.z === 'number'
      ) {
        return [n.x, n.y, n.z];
      }
      return null;
    };

    const candidates: Cand[] = [];
    const edgeKeySet = new Set<string>();

    const consider = (
      source: string,
      target: string,
      type: string,
      weight: number,
    ) => {
      if (!source || !target || source === target) return;
      const key =
        source < target ? `${source}:${target}` : `${target}:${source}`;
      if (edgeKeySet.has(key)) return;
      const a = getPos(source);
      const b = getPos(target);
      if (!a || !b) return;
      const dx = a[0] - b[0],
        dy = a[1] - b[1],
        dz = a[2] - b[2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < 1e-4) return;
      edgeKeySet.add(key);
      candidates.push({ source, target, type, weight, dist });
    };

    // Graph edges touching active node
    for (const edge of graph.edges) {
      const sourceId =
        typeof edge.source === 'string' ? edge.source : edge.source.id;
      const targetId =
        typeof edge.target === 'string' ? edge.target : edge.target.id;
      if (sourceId === activeNodeId || targetId === activeNodeId) {
        consider(sourceId, targetId, edge.type || 'related', edge.weight ?? 0.6);
      }
    }

    const activeFn = frontierNodes.find((f) => f.id === activeNodeId);

    if (activeFn && activeFn.reachable !== false) {
      for (const adjId of activeFn.adjacentTo || []) {
        consider(activeFn.id, adjId, 'related', 0.95);
      }

      const needMore = candidates.filter(
        (c) => c.source === activeFn.id || c.target === activeFn.id,
      ).length;

      if (needMore < MIN_FRONTIER_EDGES) {
        const primary = (activeFn.genres?.[0] || '').toLowerCase();
        const fp = getPos(activeFn.id);
        if (fp) {
          const scored: Array<{
            id: string;
            dist: number;
            sameGenre: boolean;
          }> = [];
          for (const n of graph.nodes) {
            if (n.id === activeFn.id) continue;
            const p = getPos(n.id);
            if (!p) continue;
            const dx = p[0] - fp[0],
              dy = p[1] - fp[1],
              dz = p[2] - fp[2];
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            const g = (n.genres?.[0] || '').toLowerCase();
            scored.push({
              id: n.id,
              dist,
              sameGenre: !!primary && g === primary,
            });
          }
          scored.sort((a, b) => {
            if (a.sameGenre !== b.sameGenre) return a.sameGenre ? -1 : 1;
            return a.dist - b.dist;
          });
          for (const s of scored) {
            if (
              candidates.filter(
                (c) => c.source === activeFn.id || c.target === activeFn.id,
              ).length >= MAX_EDGES
            )
              break;
            consider(activeFn.id, s.id, 'related', s.sameGenre ? 0.85 : 0.7);
          }
        }
      }
    } else {
      // Active is explored: frontier nodes that list it as seed
      for (const fn of frontierNodes) {
        if (fn.reachable === false) continue;
        if (fn.adjacentTo?.includes(activeNodeId)) {
          consider(activeNodeId, fn.id, 'related', 0.9);
        }
      }
      // If graph had no edges for this node, k-nearest explored peers
      if (candidates.length === 0) {
        const fp = getPos(activeNodeId);
        const activeNode = nodeMap.get(activeNodeId);
        if (fp && activeNode) {
          const primary = (activeNode.genres?.[0] || '').toLowerCase();
          const scored: Array<{
            id: string;
            dist: number;
            sameGenre: boolean;
          }> = [];
          for (const n of graph.nodes) {
            if (n.id === activeNodeId) continue;
            const p = getPos(n.id);
            if (!p) continue;
            const dx = p[0] - fp[0],
              dy = p[1] - fp[1],
              dz = p[2] - fp[2];
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            const g = (n.genres?.[0] || '').toLowerCase();
            scored.push({
              id: n.id,
              dist,
              sameGenre: !!primary && g === primary,
            });
          }
          scored.sort((a, b) => {
            if (a.sameGenre !== b.sameGenre) return a.sameGenre ? -1 : 1;
            return a.dist - b.dist;
          });
          for (const s of scored.slice(0, MAX_EDGES)) {
            consider(activeNodeId, s.id, 'related', s.sameGenre ? 0.8 : 0.65);
          }
        }
      }
    }

    candidates.sort((a, b) => {
      if (Math.abs(b.weight - a.weight) > 0.05) return b.weight - a.weight;
      return a.dist - b.dist;
    });
    const edgesToRender = candidates.slice(
      0,
      Math.min(MAX_EDGES, candidates.length),
    );

    const strokesPerEdge = 3;
    const maxVerts = edgesToRender.length * strokesPerEdge * CONN_SEGMENTS * 2;
    const posArray = new Float32Array(Math.max(maxVerts * 3, 0));
    const colArray = new Float32Array(Math.max(maxVerts * 4, 0));

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
    const offsetAmount = Math.max(
      0.00055,
      Math.min(0.0028, 0.0007 * (cameraDist - 1.55)),
    );

    for (const edge of edgesToRender) {
      const sourceId = edge.source;
      const targetId = edge.target;

      const sourceNode = nodeMap.get(sourceId);
      const targetNode = nodeMap.get(targetId);

      if (sourceNode?.reachable === false) continue;
      if (targetNode?.reachable === false) continue;

      const sourcePos = getPos(sourceId);
      const targetPos = getPos(targetId);
      if (!sourcePos || !targetPos) continue;

      _s.set(sourcePos[0], sourcePos[1], sourcePos[2]);
      _e.set(targetPos[0], targetPos[1], targetPos[2]);

      const dist = _s.distanceTo(_e);
      if (dist < 1e-4) continue;

      // Gentle arc above surface — not skyrockets
      const altitude = Math.max(0.035, dist * 0.14);
      _m.addVectors(_s, _e).multiplyScalar(0.5);
      const midLen = _m.length();
      if (midLen < 1e-4) continue;
      const mn = _m.clone().normalize();
      _m.copy(mn.multiplyScalar(midLen + altitude));

      const curve = new THREE.QuadraticBezierCurve3(
        _s.clone(),
        _m.clone(),
        _e.clone(),
      );
      const pts = curve.getPoints(CONN_SEGMENTS);

      const g1 = sourceNode?.genres?.[0] || '';
      const g2 = targetNode?.genres?.[0] || '';
      _c1.set(genreToColor(g1));
      _c2.set(genreToColor(g2));
      _blend.copy(_c1).lerp(_c2, 0.5);
      _blend.offsetHSL(0, 0.1, 0.05);

      const alpha = pinnedNodeId ? 0.9 : 0.78;

      const addSegment = (ptsList: THREE.Vector3[], a: number) => {
        for (let seg = 0; seg < CONN_SEGMENTS; seg++) {
          if (seg + 1 >= ptsList.length) break;

          posArray[idx * 3] = ptsList[seg].x;
          posArray[idx * 3 + 1] = ptsList[seg].y;
          posArray[idx * 3 + 2] = ptsList[seg].z;
          colArray[idx * 4] = _blend.r;
          colArray[idx * 4 + 1] = _blend.g;
          colArray[idx * 4 + 2] = _blend.b;
          colArray[idx * 4 + 3] = a;
          idx++;

          posArray[idx * 3] = ptsList[seg + 1].x;
          posArray[idx * 3 + 1] = ptsList[seg + 1].y;
          posArray[idx * 3 + 2] = ptsList[seg + 1].z;
          colArray[idx * 4] = _blend.r;
          colArray[idx * 4 + 1] = _blend.g;
          colArray[idx * 4 + 2] = _blend.b;
          colArray[idx * 4 + 3] = a;
          idx++;
        }
      };

      addSegment(pts, alpha);

      const ptsLeft: THREE.Vector3[] = [];
      const ptsRight: THREE.Vector3[] = [];
      for (let seg = 0; seg < pts.length; seg++) {
        const p = pts[seg];
        let tVec = tangent;
        if (seg + 1 < pts.length) {
          tVec.subVectors(pts[seg + 1], p).normalize();
        } else if (seg > 0) {
          tVec.subVectors(p, pts[seg - 1]).normalize();
        } else {
          tVec.set(1, 0, 0);
        }
        normal.copy(p).normalize();
        perp.crossVectors(tVec, normal);
        if (perp.lengthSq() < 1e-8) {
          perp.set(0, 1, 0).cross(normal);
        }
        perp.normalize().multiplyScalar(offsetAmount);
        ptsLeft.push(p.clone().add(perp));
        ptsRight.push(p.clone().sub(perp));
      }
      addSegment(ptsLeft, alpha * 0.75);
      addSegment(ptsRight, alpha * 0.75);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(posArray.slice(0, idx * 3), 3),
    );
    geometry.setAttribute(
      'color',
      new THREE.BufferAttribute(colArray.slice(0, idx * 4), 4),
    );

    lineRef.current.geometry.dispose();
    lineRef.current.geometry = geometry;
  });

  return (
    <lineSegments ref={lineRef} material={lineMaterial} frustumCulled={false} />
  );
}
