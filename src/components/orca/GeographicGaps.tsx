'use client';

/**
 * GeographicGaps — floating typography indicators for musically unexplored regions of the world.
 * Billboarded just outside the globe sphere, serving as dynamic visual discovery prompts.
 */
import { useMemo } from 'react';
import { Html } from '@react-three/drei';
import { useOrcaStore } from '@/store/orca';
import { latLngToXYZ } from '@/lib/graph/genre-normaliser';

const R = 1.65;

interface GapItemProps {
  region: string;
  lat: number;
  lng: number;
}

function GapItem({ region, lat, lng }: GapItemProps) {
  // Position slightly outside the sphere radius (R = 1.65 -> 1.76)
  const pos = useMemo(() => {
    return latLngToXYZ(lat, lng, R * 1.08);
  }, [lat, lng]);

  return (
    <Html
      position={pos}
      style={{
        pointerEvents: 'none',
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
      center
      distanceFactor={4} // Scales text size based on zoom depth
      zIndexRange={[15, 5]}
    >
      <div
        className="geographic-gap-label"
        style={{
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
          fontSize: '9px',
          fontWeight: 600,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'rgba(0, 0, 0, 0.16)', // Dim invitation color
          background: 'transparent',
          padding: '2px 6px',
          display: 'flex',
          alignItems: 'center',
          gap: '3px',
          transition: 'opacity 0.3s ease',
        }}
      >
        <span>↳</span> {region}
      </div>
    </Html>
  );
}

export function GeographicGaps() {
  const gaps = useOrcaStore(s => s.geographicGaps);

  if (!gaps || gaps.length === 0) return null;

  return (
    <group>
      {gaps.map((gap, idx) => (
        <GapItem
          key={`${gap.region}-${idx}`}
          region={gap.region}
          lat={gap.anchorLat}
          lng={gap.anchorLng}
        />
      ))}
    </group>
  );
}
