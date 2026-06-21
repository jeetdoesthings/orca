'use client';

/**
 * GlobeShell — the transparent glass globe with atmosphere, wireframe,
 * latitude rings, and great circles.
 * No occluder sphere — backface hiding is handled dynamically by NodeField.
 */
import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const R = 1.65;

export function GlobeShell() {
  const groupRef = useRef<THREE.Group>(null);
  const wireRef = useRef<THREE.ShaderMaterial>(null);

  // ── Globe Body — subtle glass rim, no fill ──
  const globeBodyGeo = useMemo(() => new THREE.SphereGeometry(R * 0.998, 64, 32), []);
  const globeBodyMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        // Transform normal to world space for coordinate system consistency
        vNormal = normalize(vec3(modelMatrix * vec4(normal, 0.0)));
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vViewDir = normalize(cameraPosition - worldPos.xyz);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        float facing = dot(vNormal, vViewDir);
        // Soft, rich frosted glassmorphism blur simulation
        // Lower exponent makes the frost wider and spread further inward
        float rim = pow(1.0 - max(facing, 0.0), 1.6);
        
        // Deeper interior volume fill for an enhanced blur/frost appearance
        float interior = (1.0 - max(facing, 0.0)) * 0.16;
        
        float alpha = rim * 0.45 + interior;
        
        // Pure translucent white glass color
        vec3 glassColor = vec3(0.98, 0.99, 1.0);
        
        gl_FragColor = vec4(glassColor, alpha);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    blending: THREE.NormalBlending,
  }), []);

  // ── Atmosphere Shell ──
  const atmoGeo = useMemo(() => new THREE.SphereGeometry(R * 1.12, 48, 24), []);
  const atmoMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        // Transform normal to world space for coordinate system consistency
        vNormal = normalize(vec3(modelMatrix * vec4(normal, 0.0)));
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vViewDir = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        float rim = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 4.0);
        gl_FragColor = vec4(1.0, 1.0, 1.0, rim * 0.22); // soft, gorgeous outer atmospheric halo
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
  }), []);

  // ── Scaffold Material ──
  const scaffoldMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0.08, 0.08, 0.08) },
      uBase: { value: 0.012 }, // Made much lighter per user feedback
    },
    vertexShader: `void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uBase;
      void main() {
        float pulse = 0.75 + 0.25 * sin(uTime * 0.4);
        gl_FragColor = vec4(uColor, uBase * pulse);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  }), []);

  // ── Latitude Rings as THREE.Line objects ──
  const latRingLines = useMemo(() => {
    return [-30, 0, 30].map(lat => {
      const phi = (90 - lat) * Math.PI / 180;
      const r = R * 1.01 * Math.sin(phi);
      const y = R * 1.01 * Math.cos(phi);
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 128; i++) {
        const t = (i / 128) * Math.PI * 2;
        pts.push(new THREE.Vector3(r * Math.sin(t), y, r * Math.cos(t)));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      return new THREE.Line(geo, scaffoldMat);
    });
  }, [scaffoldMat]);

  // ── Great Circle Arcs as THREE.Line objects ──
  const greatCircleLines = useMemo(() => {
    const axes: [number, number, number][] = [[0.3, 1, 0.2], [0.8, 0.3, 0.5]];
    return axes.map(([ax, ay, az]) => {
      const axis = new THREE.Vector3(ax, ay, az).normalize();
      const p1 = new THREE.Vector3();
      if (Math.abs(axis.x) < 0.9) p1.crossVectors(axis, new THREE.Vector3(1, 0, 0)).normalize();
      else p1.crossVectors(axis, new THREE.Vector3(0, 1, 0)).normalize();
      const p2 = new THREE.Vector3().crossVectors(axis, p1).normalize();
      const pts: THREE.Vector3[] = [];
      const gcR = R * 1.005;
      for (let i = 0; i <= 128; i++) {
        const t = (i / 128) * Math.PI * 2;
        pts.push(new THREE.Vector3()
          .addScaledVector(p1, Math.cos(t) * gcR)
          .addScaledVector(p2, Math.sin(t) * gcR));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      return new THREE.Line(geo, scaffoldMat);
    });
  }, [scaffoldMat]);

  // ── Geodesic Wireframe ──
  const wireGeo = useMemo(() => new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(R, 3), 0), []);
  const wireMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      uniform float uTime;
      void main() {
        vec3 n = normalize(position);
        float b = sin(uTime * 0.5 + n.y * 2.5) * 0.002;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position + n * b, 1.0);
      }`,
    fragmentShader: `void main() { gl_FragColor = vec4(0.08, 0.08, 0.08, 0.01); }`, // Made much lighter (from 0.04 to 0.01)
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  }), []);

  // ── Animation Loop ──
  useFrame(({ clock }) => {
    const time = clock.getElapsedTime();
    scaffoldMat.uniforms.uTime.value = time;
    if (wireRef.current) wireRef.current.uniforms.uTime.value = time;
  });

  return (
    <group ref={groupRef}>
      {/* Globe Body — clean glass rim, no fill */}
      <mesh geometry={globeBodyGeo} material={globeBodyMat} />

      {/* Atmosphere */}
      <mesh geometry={atmoGeo} material={atmoMat} />

      {/* Latitude Rings */}
      {latRingLines.map((lineObj, i) => (
        <primitive key={`lat-${i}`} object={lineObj} />
      ))}

      {/* Great Circles */}
      {greatCircleLines.map((lineObj, i) => (
        <primitive key={`gc-${i}`} object={lineObj} />
      ))}

      {/* Geodesic Wireframe */}
      <lineSegments geometry={wireGeo}>
        <shaderMaterial ref={wireRef} attach="material" {...wireMat} />
      </lineSegments>
    </group>
  );
}
