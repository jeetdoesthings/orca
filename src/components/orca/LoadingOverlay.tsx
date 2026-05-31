// src/components/orca/LoadingOverlay.tsx
'use client';

import { useEffect, useRef, useState } from 'react';

interface LoadingOverlayProps {
  loadedCount: number;
  totalCount: number;           // should be 60
  currentArtistName: string;    // name of most recently loaded artist
  dissolving: boolean;          // triggers exit animation
}

export function LoadingOverlay({
  loadedCount,
  totalCount,
  currentArtistName,
  dissolving,
}: LoadingOverlayProps) {

  // Artist name cross-fade
  const [displayName, setDisplayName]   = useState(currentArtistName);
  const [nameVisible, setNameVisible]   = useState(true);
  const pendingName = useRef<string>('');

  useEffect(() => {
    if (currentArtistName === displayName || !currentArtistName) return;

    pendingName.current = currentArtistName;

    // Fade out current name
    setNameVisible(false);

    // After fade-out, swap and fade in
    const t = setTimeout(() => {
      setDisplayName(pendingName.current);
      setNameVisible(true);
    }, 140); // matches CSS transition duration

    return () => clearTimeout(t);
  }, [currentArtistName]);

  // Progress ring calculation
  const RING_RADIUS      = 140;
  const CIRCUMFERENCE    = 2 * Math.PI * RING_RADIUS;
  const progress         = Math.min(loadedCount / totalCount, 1);
  const strokeDashFilled = CIRCUMFERENCE * progress;

  // Truncate artist name
  const truncatedName = displayName.length > 28
    ? displayName.slice(0, 27) + '…'
    : displayName;

  return (
    <div
      style={{
        position:       'fixed',
        inset:          0,
        zIndex:         100,
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'center',
        justifyContent: 'center',
        pointerEvents:  dissolving ? 'none' : 'all',

        // Light mode overlay — translucent glass sphere shows through this
        background:     'rgba(240, 240, 245, 0.82)',
        backdropFilter: dissolving ? 'blur(0px)' : 'blur(3px) saturate(120%)',
        WebkitBackdropFilter: dissolving ? 'blur(0px)' : 'blur(3px) saturate(120%)',

        // Dissolve transition
        opacity:    dissolving ? 0 : 1,
        transition: dissolving
          ? 'opacity 600ms cubic-bezier(0.4, 0, 0.2, 1), backdrop-filter 600ms ease-out'
          : 'opacity 400ms ease-out',

        // Entrance
        animation: dissolving ? 'none' : 'overlay-appear 400ms ease-out forwards',
      }}
    >
      {/* Orbital progress ring — centred in viewport */}
      <div style={{
        position:  'absolute',
        top:       '50%',
        left:      '50%',
        transform: 'translate(-50%, -50%)',
        width:     282,
        height:    282,
        pointerEvents: 'none',
      }}>
        <svg
          width="282"
          height="282"
          style={{ transform: 'rotate(-90deg)', overflow: 'visible' }}
          aria-hidden="true"
        >
          {/* Ghost track ring */}
          <circle
            cx="141" cy="141" r={RING_RADIUS}
            fill="none"
            stroke="rgba(0,0,0,0.07)"
            strokeWidth="1"
          />

          {/* Filled arc */}
          <circle
            cx="141" cy="141" r={RING_RADIUS}
            fill="none"
            stroke="rgba(0,0,0,0.28)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray={`${strokeDashFilled} ${CIRCUMFERENCE}`}
            style={{
              transition: 'stroke-dasharray 200ms ease-out',
            }}
          />
        </svg>
      </div>

      {/* Bottom text — artist name + count */}
      <div style={{
        position:       'absolute',
        bottom:         '12%',
        left:           '50%',
        transform:      'translateX(-50%)',
        textAlign:      'center',
        fontFamily:     "'Geist', 'DM Sans', 'Inter', sans-serif",
        WebkitFontSmoothing: 'antialiased',
        userSelect:     'none',
      }}>

        {/* Artist name ticker */}
        <div style={{
          height:        16,              // fixed — no layout shift
          display:       'flex',
          alignItems:    'center',
          justifyContent:'center',
          marginBottom:  10,
        }}>
          <span style={{
            fontSize:      11,
            fontWeight:    400,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color:         'rgba(0,0,0,0.30)',
            opacity:       nameVisible ? 1 : 0,
            transition:    'opacity 140ms ease-out',
            lineHeight:    1,
            whiteSpace:    'nowrap',
          }}>
            {truncatedName}
          </span>
        </div>

        {/* Count */}
        <div style={{
          fontSize:           13,
          fontWeight:         400,
          fontVariantNumeric: 'tabular-nums',
          color:              'rgba(0,0,0,0.50)',
          lineHeight:         1,
        }}>
          {loadedCount}
          <span style={{ color: 'rgba(0,0,0,0.22)', marginLeft: 3 }}>
            / {totalCount}
          </span>
        </div>

      </div>

      <style>{`
        @keyframes overlay-appear {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
