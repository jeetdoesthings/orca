'use client';

/**
 * AdventurousnessIndicator — sleek HUD widget showing the user's taste spread.
 * Placed in the bottom-left corner of the viewport.
 */
import { useOrcaStore } from '@/store/orca';

export function AdventurousnessIndicator() {
  const adventurousness = useOrcaStore(s => s.adventurousness);

  if (!adventurousness) return null;

  const { spread, label, trajectory } = adventurousness;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '24px',
        left: '28px',
        width: '210px',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        pointerEvents: 'none',
        userSelect: 'none',
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        animation: 'fadeInHUD 0.8s ease-out forwards',
      }}
    >
      {/* Spread slider bar */}
      <div
        style={{
          position: 'relative',
          height: '2px',
          background: 'rgba(0,0,0,0.06)',
          borderRadius: '1px',
          width: '100%',
        }}
      >
        {/* Glow fill up to user spread */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            height: '100%',
            width: `${spread * 100}%`,
            background: 'rgba(0, 0, 0, 0.18)',
            borderRadius: '1px',
            transition: 'width 800ms cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        />

        {/* Glow position slider dot */}
        <div
          style={{
            position: 'absolute',
            top: '-3px',
            left: `calc(${spread * 100}% - 4px)`,
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: '#111118',
            boxShadow: '0 0 10px rgba(0,0,0,0.3)',
            transition: 'left 800ms cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        />

        {/* Extreme endpoints labels */}
        <span
          style={{
            position: 'absolute',
            top: '6px',
            left: 0,
            fontSize: '8px',
            fontWeight: 700,
            color: 'rgba(0,0,0,0.22)',
            letterSpacing: '0.08em',
          }}
        >
          FOCUSED
        </span>
        <span
          style={{
            position: 'absolute',
            top: '6px',
            right: 0,
            fontSize: '8px',
            fontWeight: 700,
            color: 'rgba(0,0,0,0.22)',
            letterSpacing: '0.08em',
          }}
        >
          WIDE
        </span>
      </div>

      {/* Narrative descriptive label */}
      <div
        style={{
          marginTop: '12px',
          fontSize: '10.5px',
          lineHeight: '1.45',
          color: 'rgba(0,0,0,0.35)',
          fontWeight: 500,
          whiteSpace: 'normal',
        }}
      >
        {label}
      </div>

      {/* Dynamic trajectory indicator */}
      {trajectory && trajectory !== 'stable' && (
        <div
          style={{
            fontSize: '9.5px',
            fontWeight: 700,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            color: trajectory === 'expanding' ? '#2e7d32' : '#1565c0', // expanding green, focusing blue
            display: 'flex',
            alignItems: 'center',
            gap: '3px',
            marginTop: '2px',
          }}
        >
          {trajectory === 'expanding' ? (
            <>
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M1 7L7 1M7 1H3M7 1V5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>Expanding Taste</span>
            </>
          ) : (
            <>
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M1 1L7 7M7 7H3M7 7V3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>Focusing Taste</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
