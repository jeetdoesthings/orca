'use client';

/**
 * ExpansionParticles — subtle pulse effects around taste expansion candidate nodes.
 * Expanding concentric rings invite taste expansion.
 */
import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useOrcaStore } from '@/store/orca';
import { getGenreColor, normaliseGenre } from '@/lib/graph/genre-normaliser';

const MAX_FRONTIER_EFFECTS = 150;

export function ExpansionParticles() {
  const positions = useOrcaStore(s => s.nodePositions);
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const geometry = useMemo(() => {
    // Smaller plane — soft halo, not loud ring
    const geo = new THREE.PlaneGeometry(0.22, 0.22);
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
      opacity: 0.55,
    });
    
    mat.userData = {
      uTime: { value: 0 }
    };

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = mat.userData.uTime;

      if (!shader.vertexShader.includes('varying vec2 orcaPulseUv')) {
        shader.vertexShader =
          `varying vec2 orcaPulseUv;\n` + shader.vertexShader;
      }

      if (!shader.vertexShader.includes('orcaPulseUv = uv')) {
        shader.vertexShader = shader.vertexShader.replace(
          'void main() {',
          `void main() {
          orcaPulseUv = uv;
        `,
        );
      }

      if (!shader.fragmentShader.includes('varying vec2 orcaPulseUv')) {
        shader.fragmentShader =
          `uniform float uTime;\nvarying vec2 orcaPulseUv;\n` +
          shader.fragmentShader;
      } else if (!shader.fragmentShader.includes('uniform float uTime')) {
        shader.fragmentShader = `uniform float uTime;\n` + shader.fragmentShader;
      }

      if (!shader.fragmentShader.includes('orcaPulseUv - 0.5')) {
        // Soft slow breath — matches calm globe, not nightclub strobe
        shader.fragmentShader = shader.fragmentShader.replace(
          'vec4 diffuseColor = vec4( diffuse, opacity );',
          `
        float d = length(orcaPulseUv - 0.5) * 2.0;
        float breath = 0.55 + 0.45 * sin(uTime * 0.9);
        float ring = fract(-d * 1.05 + uTime * 0.28);
        ring = smoothstep(0.0, 0.14, ring) * smoothstep(0.32, 0.12, ring);
        float soft = exp(-d * 2.4) * 0.45;
        float fade = 1.0 - smoothstep(0.35, 0.92, d);
        float a = (ring * 0.55 + soft) * fade * breath * opacity * 0.42;
        vec4 diffuseColor = vec4( diffuse, a );
        `,
        );
      }
    };

    mat.customProgramCacheKey = () => 'orca-expansion-particles-v3-soft';

    return mat;
  }, []);

  // Temp objects
  const _obj = useMemo(() => new THREE.Object3D(), []);
  const _up = useMemo(() => new THREE.Vector3(0, 0, 1), []);
  const _normal = useMemo(() => new THREE.Vector3(), []);
  const _color = useMemo(() => new THREE.Color(), []);

  // Update expansion candidate positions
  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    if (material.userData.uTime) {
      material.userData.uTime.value = clock.getElapsedTime();
    }

    const frontierNodes = useOrcaStore
      .getState()
      .frontierNodes.filter((n) => n.reachable !== false && n.visible !== false)
      .slice(0, MAX_FRONTIER_EFFECTS);

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
