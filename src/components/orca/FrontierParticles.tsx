'use client';

/**
 * FrontierParticles — subtle pulse effects around frontier (unexplored) nodes.
 * Expanding concentric rings invite exploration.
 */
import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useOrcaStore } from '@/store/orca';

const MAX_FRONTIER_EFFECTS = 40;

export function FrontierParticles() {
  const graph = useOrcaStore(s => s.graph);
  const positions = useOrcaStore(s => s.nodePositions);
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const geometry = useMemo(() => new THREE.PlaneGeometry(0.1, 0.1), []);
  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float ring = fract(-d * 2.0 + uTime * 0.4);
        ring = smoothstep(0.0, 0.1, ring) * smoothstep(0.25, 0.1, ring);
        float fade = 1.0 - smoothstep(0.4, 0.95, d);
        gl_FragColor = vec4(0.4, 0.4, 0.45, ring * fade * 0.12);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  }), []);

  // Temp objects
  const _obj = useMemo(() => new THREE.Object3D(), []);
  const _up = useMemo(() => new THREE.Vector3(0, 0, 1), []);
  const _normal = useMemo(() => new THREE.Vector3(), []);

  // Update frontier positions
  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh || !graph || positions.size === 0) return;

    material.uniforms.uTime.value = clock.getElapsedTime();

    const frontierNodes = graph.nodes
      .filter(n => n.state === 'frontier')
      .slice(0, MAX_FRONTIER_EFFECTS);

    mesh.count = frontierNodes.length;

    for (let i = 0; i < frontierNodes.length; i++) {
      const node = frontierNodes[i];
      const pos = positions.get(node.id);
      if (!pos) continue;

      _obj.position.set(pos[0], pos[1], pos[2]);
      // Slightly above the surface
      _normal.set(pos[0], pos[1], pos[2]).normalize();
      _obj.position.addScaledVector(_normal, 0.01);

      // Orient to face outward
      _obj.quaternion.setFromUnitVectors(_up, _normal);
      _obj.scale.setScalar(1);
      _obj.updateMatrix();
      mesh.setMatrixAt(i, _obj.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, MAX_FRONTIER_EFFECTS]}
      frustumCulled={false}
    />
  );
}
