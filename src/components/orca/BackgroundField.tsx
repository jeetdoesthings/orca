'use client';

/**
 * BackgroundField — deep background particles for depth perception.
 * 90 subtle particles inside the globe volume.
 */
import { useMemo } from 'react';
import * as THREE from 'three';

const R = 1.65;
const PARTICLE_COUNT = 90;

export function BackgroundField() {
  const geometry = useMemo(() => {
    const positions = new Float32Array(PARTICLE_COUNT * 3);

    // Seeded random for deterministic placement
    let seed = 42;
    const rng = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const theta = rng() * Math.PI * 2;
      const phi = Math.acos(2 * rng() - 1);
      const sr = R * 0.85 * Math.cbrt(rng()); // Uniform volume distribution
      positions[i * 3] = sr * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = sr * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = sr * Math.cos(phi);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geo;
  }, []);

  const material = useMemo(() => new THREE.PointsMaterial({
    color: 0xaabbcc,
    size: 0.006,
    transparent: true,
    opacity: 0.35,
    sizeAttenuation: true,
    blending: THREE.NormalBlending,
    depthWrite: false,
  }), []);

  return <points geometry={geometry} material={material} />;
}
