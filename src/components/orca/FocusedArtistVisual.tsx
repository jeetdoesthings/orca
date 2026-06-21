'use client';

/**
 * FocusedArtistVisual — a premium, high-priority visual layer dedicated to
 * rendering the currently focused artist node.
 *
 * It features:
 * - 1.2x to 1.4x (specifically 1.3x) smooth scale-up animation.
 * - An custom glowing shader that pulses gently in the artist's genre-color with a white core.
 * - Render order 9999 + depthTest: false to draw completely on top of all edges/labels.
 * - Seamless exit transitions (continues animating out even after focusedNodeId becomes null).
 */
import { useRef, useMemo, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useOrcaStore } from '@/store/orca';
import { getGenreColor, latLngToXYZ, xyzToLatLng } from '@/lib/graph/genre-normaliser';
import { artistImageCache } from './ArtistImageLayer';
import { sharedDisplacedPositions } from './NodeField';

const R = 1.65;

function getNodeRadius(weight: number): number {
  if (weight > 0.8) return 0.028;
  if (weight > 0.5) return 0.022;
  if (weight > 0.2) return 0.016;
  return 0.013;
}

function createPlaceholderTexture(artistName: string, genreColor: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = genreColor;
  ctx.fillRect(0, 0, 128, 128);

  const initials = artistName
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() || '')
    .join('');

  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = 'bold 41px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initials, 64, 66);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function FocusedArtistVisual() {
  const focusedNodeId = useOrcaStore(s => s.focusedNodeId);
  const graph = useOrcaStore(s => s.graph);
  const positions = useOrcaStore(s => s.nodePositions);

  const lastFocusedNodeId = useRef<string | null>(null);
  const scaleProgress = useRef(0); // 0 to 1 smooth animation progress

  // Synchronously capture focusedNodeId to ref during render cycle
  if (focusedNodeId) {
    lastFocusedNodeId.current = focusedNodeId;
  }

  // Create radial glow shader material
  const glowMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        color: { value: new THREE.Color('#888888') },
        opacity: { value: 0 },
        time: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform vec3 color;
        uniform float opacity;
        uniform float time;
        void main() {
          vec2 uv = vUv - 0.5;
          float dist = length(uv);
          
          // Smooth pulse oscillation
          float pulse = 1.0 + 0.12 * sin(time * 3.5);
          float d = dist * 2.0 / pulse;
          
          // Exponential decay visual glow
          float alpha = exp(-d * 3.2);
          
          // Hard visual cut-off border
          alpha *= smoothstep(1.0, 0.0, d);
          
          // Pure white core visual highlight
          vec3 finalColor = mix(color, vec3(1.0), exp(-d * 8.0) * 0.6);
          
          gl_FragColor = vec4(finalColor, alpha * opacity);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
  }, []);

  // Colored base circle material (drawn on top, depthTest: false to never be occluded)
  const baseMaterial = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: new THREE.Color('#888888'),
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    });
  }, []);

  // Profile image material (drawn on top, depthTest: false to never be occluded)
  const imageMaterial = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    });
  }, []);

  // Standard geometries
  const circleGeo = useMemo(() => new THREE.CircleGeometry(0.5, 32), []);
  const glowGeo = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  // Track coordinates and perform animations
  const visualGroupRef = useRef<THREE.Group>(null);
  const _outward = useMemo(() => new THREE.Vector3(), []);

  useFrame((state) => {
    const visualGroup = visualGroupRef.current;
    if (!visualGroup || !graph) return;

    const active = focusedNodeId !== null;
    const target = active ? 1 : 0;
    
    // Smooth lerp
    scaleProgress.current += (target - scaleProgress.current) * 0.15;

    // Reset and hide when exit animation completes
    if (scaleProgress.current < 0.01 && !active) {
      visualGroup.visible = false;
      lastFocusedNodeId.current = null;
      scaleProgress.current = 0;
      return;
    }

    const nodeIdToRender = focusedNodeId || lastFocusedNodeId.current;
    if (!nodeIdToRender) {
      visualGroup.visible = false;
      return;
    }

    let node = graph.nodes.find(n => n.id === nodeIdToRender);
    if (!node) {
      node = useOrcaStore.getState().frontierNodes.find(n => n.id === nodeIdToRender);
    }
    if (!node) {
      visualGroup.visible = false;
      return;
    }

    // Retrieve active positions from shared edge tracker or store, with fallback coordinates
    let pos = sharedDisplacedPositions.get(node.id) || positions.get(node.id);
    if (!pos && node.x !== undefined && node.y !== undefined && node.z !== undefined) {
      pos = [node.x, node.y, node.z];
    }
    if (!pos) {
      visualGroup.visible = false;
      return;
    }

    // Ensure the group is visible
    visualGroup.visible = true;

    // ── Update coordinates ──
    visualGroup.position.set(pos[0], pos[1], pos[2]);

    _outward.set(pos[0], pos[1], pos[2]).normalize();
    // Slightly push outwards on the normal to avoid z-fighting with elements below
    visualGroup.position.addScaledVector(_outward, 0.002);
    _outward.add(visualGroup.position);
    visualGroup.lookAt(_outward);

    // ── Animate scale ──
    const baseRadius = getNodeRadius(node.weight);
    // Scales to 1.3x smoothly in Focus Mode
    const animatedScaleMultiplier = 1.0 + 0.3 * scaleProgress.current;
    const currentRadius = baseRadius * animatedScaleMultiplier;

    // Scale parent group accordingly
    visualGroup.scale.set(currentRadius * 2, currentRadius * 2, currentRadius * 2);

    // Scale glow (sized to ~3.2x normal node radius)
    const glowScale = 3.2 / animatedScaleMultiplier;
    const glowMesh = visualGroup.children[0] as THREE.Mesh;
    if (glowMesh) {
      glowMesh.scale.setScalar(glowScale);
    }

    // ── Update Material Colors Dynamically inside useFrame ──
    const genreColor = getGenreColor((node.genres[0] || '').toLowerCase());
    baseMaterial.color.set(genreColor);
    glowMaterial.uniforms.color.value.set(genreColor);

    // ── Update Opacities ──
    // Glow fades in/out with the scale progress
    glowMaterial.uniforms.opacity.value = scaleProgress.current * 0.95;
    glowMaterial.uniforms.time.value = state.clock.getElapsedTime();

    // Node contents fade in/out beautifully
    baseMaterial.opacity = scaleProgress.current * 0.95;
    imageMaterial.opacity = scaleProgress.current * 0.95;

    // ── Retrieve Profile Image Texture ──
    const cacheKey = node.name.toLowerCase().trim();
    const cached = artistImageCache.get(cacheKey);
    let activeTexture = cached?.texture;

    if (!activeTexture) {
      // Create local fallback placeholder texture
      activeTexture = createPlaceholderTexture(node.name, genreColor);
    }

    if (imageMaterial.map !== activeTexture) {
      imageMaterial.map = activeTexture;
      imageMaterial.needsUpdate = true;
    }
  });

  return (
    <group ref={visualGroupRef} visible={false}>
      {/* 1. Pulses Additive Glow (behind the node, renderOrder: 9997) */}
      <mesh
        geometry={glowGeo}
        material={glowMaterial}
        renderOrder={9997}
      />

      {/* 2. Base colored circle border background (renderOrder: 9998) */}
      <mesh
        geometry={circleGeo}
        material={baseMaterial}
        renderOrder={9998}
      />

      {/* 3. Rounded Spotify Profile Image (scaled to 85% width, renderOrder: 9999) */}
      <mesh
        geometry={circleGeo}
        material={imageMaterial}
        scale={[0.85, 0.85, 1]}
        position={[0, 0, 0.001]} // z-bias layering
        renderOrder={9999}
      />
    </group>
  );
}
