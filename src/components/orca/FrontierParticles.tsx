'use client';

/**
 * FrontierParticles — subtle pulse effects around frontier (unexplored) nodes.
 * Expanding concentric rings invite exploration.
 */
import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useOrcaStore } from '@/store/orca';
import { getGenreColor, normaliseGenre } from '@/lib/graph/genre-normaliser';

const MAX_FRONTIER_EFFECTS = 150;

export function FrontierParticles() {
  const positions = useOrcaStore(s => s.nodePositions);
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(0.32, 0.32);
    const dummyColors = new Float32Array(geo.attributes.position.count * 3).fill(1.0);
    geo.setAttribute('color', new THREE.BufferAttribute(dummyColors, 3));
    return geo;
  }, []);
  const material = useMemo(() => {
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });
    
    mat.userData = {
      uTime: { value: 0 }
    };

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = mat.userData.uTime;

      shader.vertexShader = `
        varying vec2 customVuv;
      ` + shader.vertexShader;
      
      shader.vertexShader = shader.vertexShader.replace(
        'void main() {',
        `
        varying vec2 customVuv;
        void main() {
          customVuv = uv;
        `
      );

      shader.fragmentShader = `
        uniform float uTime;
        varying vec2 customVuv;
      ` + shader.fragmentShader;

      shader.fragmentShader = shader.fragmentShader.replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        `
        float d = length(customVuv - 0.5) * 2.0;
        // Expanding concentric circles - faster, wider, and more intense
        float ring = fract(-d * 1.8 + uTime * 0.85);
        ring = smoothstep(0.0, 0.08, ring) * smoothstep(0.40, 0.08, ring);
        float fade = 1.0 - smoothstep(0.48, 0.98, d);
        
        vec4 diffuseColor = vec4( diffuse, opacity * ring * fade * 0.95 );
        `
      );
    };

    return mat;
  }, []);

  // Temp objects
  const _obj = useMemo(() => new THREE.Object3D(), []);
  const _up = useMemo(() => new THREE.Vector3(0, 0, 1), []);
  const _normal = useMemo(() => new THREE.Vector3(), []);
  const _color = useMemo(() => new THREE.Color(), []);

  // Update frontier positions
  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    if (material.userData.uTime) {
      material.userData.uTime.value = clock.getElapsedTime();
    }

    const frontierNodes = useOrcaStore.getState().frontierNodes.slice(0, MAX_FRONTIER_EFFECTS);

    mesh.count = frontierNodes.length;

    if (!mesh.instanceColor || mesh.instanceColor.count < MAX_FRONTIER_EFFECTS) {
      const colors = new Float32Array(MAX_FRONTIER_EFFECTS * 3).fill(1.0);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    }

    for (let i = 0; i < frontierNodes.length; i++) {
      const node = frontierNodes[i];
      let pos = positions.get(node.id);
      if (!pos && node.x !== undefined && node.y !== undefined && node.z !== undefined) {
        pos = [node.x, node.y, node.z];
      }
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

      // Set node's genre color
      const primaryGenre = normaliseGenre(node.genres);
      const colorHex = getGenreColor(primaryGenre);
      _color.set(colorHex);
      mesh.setColorAt(i, _color);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={(el) => {
        if (el && !el.instanceColor) {
          const colors = new Float32Array(MAX_FRONTIER_EFFECTS * 3).fill(1.0);
          el.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
        }
        meshRef.current = el;
      }}
      args={[geometry, material, MAX_FRONTIER_EFFECTS]}
      frustumCulled={false}
    />
  );
}
