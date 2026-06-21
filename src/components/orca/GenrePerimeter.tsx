'use client';

/**
 * GenrePerimeter — renders smooth closed splines surrounding explored clusters per genre.
 * Includes slow breathing opacity and morphing transition effects when nodes expand.
 */
import { useRef, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useOrcaStore } from '@/store/orca';
import { latLngToXYZ } from '@/lib/graph/genre-normaliser';

const R = 1.65;

interface PerimeterItemProps {
  genre: string;
  points: Array<{ lat: number; lng: number }>;
  color: string;
}

function PerimeterItem({ genre, points, color }: PerimeterItemProps) {
  const lineRef = useRef<THREE.Line>(null);
  
  // Transition refs for morph animation
  const oldPointsRef = useRef<Array<{ lat: number; lng: number }>>([...points]);
  const targetPointsRef = useRef<Array<{ lat: number; lng: number }>>([...points]);
  const transitionTimeRef = useRef<number>(-1);

  // Re-map target coordinates whenever points update
  useEffect(() => {
    oldPointsRef.current = [...targetPointsRef.current];
    targetPointsRef.current = [...points];
    transitionTimeRef.current = Date.now();
  }, [points]);

  const curveGeometry = useMemo(() => {
    // Return an initial static geometry
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    return geo;
  }, []);

  const material = useMemo(() => {
    return new THREE.LineBasicMaterial({
      color: new THREE.Color(color),
      opacity: 0.25,
      transparent: true,
      depthWrite: false,
    });
  }, [color]);

  useFrame(() => {
    const line = lineRef.current;
    if (!line) return;

    // 1. Staggered slow breathing opacity (4s cycle)
    const time = clockElapsedTime();
    const breathing = 0.25 + 0.1 * Math.sin(time * 0.5 * Math.PI); // oscillating 0.15 to 0.35
    material.opacity = breathing;

    // 2. Morph points if transition timer is active
    let activePoints = targetPointsRef.current;
    if (transitionTimeRef.current > 0) {
      const elapsed = Date.now() - transitionTimeRef.current;
      const duration = 800; // 800ms morph duration
      const t = Math.min(elapsed / duration, 1.0);
      
      // Smooth sigmoid / cubic easing
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

      const interpolated: Array<{ lat: number; lng: number }> = [];
      const oldLen = oldPointsRef.current.length;
      const targetLen = targetPointsRef.current.length;

      // Safe interpolation accounting for point length variations
      const maxLen = Math.max(oldLen, targetLen);
      for (let i = 0; i < maxLen; i++) {
        const oldPt = oldPointsRef.current[i % oldLen] || { lat: 0, lng: 0 };
        const targetPt = targetPointsRef.current[i % targetLen] || { lat: 0, lng: 0 };
        interpolated.push({
          lat: oldPt.lat + (targetPt.lat - oldPt.lat) * ease,
          lng: oldPt.lng + (targetPt.lng - oldPt.lng) * ease,
        });
      }

      activePoints = interpolated;

      if (t >= 1.0) {
        transitionTimeRef.current = -1; // Animation settled
      }
    }

    // 3. Build 3D closed CatmullRom spline curve coordinates on sphere surface
    if (activePoints.length >= 3) {
      const xyzPoints = activePoints.map(p => {
        const coords = latLngToXYZ(p.lat, p.lng, R * 1.006); // slight altitude to hover above globe body
        return new THREE.Vector3(...coords);
      });

      const curve = new THREE.CatmullRomCurve3(xyzPoints, true, 'centripetal');
      // Subdivide curve segments for organic fluidity
      const curvePts = curve.getPoints(activePoints.length * 8);
      
      const posArray = new Float32Array(curvePts.length * 3);
      for (let i = 0; i < curvePts.length; i++) {
        posArray[i * 3] = curvePts[i].x;
        posArray[i * 3 + 1] = curvePts[i].y;
        posArray[i * 3 + 2] = curvePts[i].z;
      }

      line.geometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
      line.geometry.attributes.position.needsUpdate = true;
    }
  });

  return <primitive object={useMemo(() => new THREE.Line(curveGeometry, material), [curveGeometry, material])} ref={lineRef} />;
}

// Clock helper function
let clockStart = Date.now();
function clockElapsedTime() {
  return (Date.now() - clockStart) / 1000;
}

export function GenrePerimeter() {
  const perimeterData = useOrcaStore(s => s.perimeterData);

  if (!perimeterData || perimeterData.length === 0) return null;

  return (
    <group>
      {perimeterData.map((perim, idx) => (
        <PerimeterItem
          key={`${perim.genre}-${idx}`}
          genre={perim.genre}
          points={perim.points}
          color={perim.color}
        />
      ))}
    </group>
  );
}
