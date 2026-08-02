'use client';

/**
 * Honest-state banner when a depth bucket could not be filled with real material.
 * Reused for Deep (leap), Shore, and collapsed distance signal.
 */

export type HonestyBannerKind = 'leap' | 'close' | 'variance';

export interface LeapFallbackBannerProps {
  visible: boolean;
  isMobile?: boolean;
  /** Which honesty message to show (default leap for back-compat). */
  kind?: HonestyBannerKind;
}

const COPY: Record<
  HonestyBannerKind,
  { title: string; body: string; cta: string }
> = {
  leap: {
    title: 'Few genuinely distant candidates found yet',
    body: 'Explore more of your map, then rebuild the frontier to open farther territory.',
    cta: 'Rebuild frontier',
  },
  close: {
    title: 'Few deep cuts near home found yet',
    body: 'Close looks for lesser-known artists inside territory you already know. Rebuild after more listening, or try Far.',
    cta: 'Rebuild frontier',
  },
  variance: {
    title: 'Distance signal is too compressed',
    body: 'Many candidates share nearly the same distance (often weak audio). Depth bands may not mean much until embeddings improve.',
    cta: 'Rebuild frontier',
  },
};

export function LeapFallbackBanner({
  visible,
  isMobile,
  kind = 'leap',
}: LeapFallbackBannerProps) {
  if (!visible) return null;
  const copy = COPY[kind];
  return (
    <div
      style={{
        position: 'fixed',
        bottom: isMobile ? '72px' : '88px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 55,
        maxWidth: '320px',
        width: '90%',
        padding: '12px 16px',
        borderRadius: '12px',
        background: 'rgba(255,255,255,0.88)',
        border: '1px solid rgba(0,0,0,0.08)',
        boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
        fontFamily: "'Inter', system-ui, sans-serif",
        fontSize: '12px',
        color: 'rgba(0,0,0,0.55)',
        lineHeight: 1.45,
        textAlign: 'center',
        pointerEvents: 'auto',
      }}
    >
      <div style={{ fontWeight: 600, color: '#111118', marginBottom: 6 }}>
        {copy.title}
      </div>
      <div style={{ marginBottom: 10 }}>{copy.body}</div>
      <button
        type="button"
        className="orca-hud-pill-btn"
        style={{ minWidth: 0, padding: '8px 16px', fontSize: 12 }}
        onClick={() => {
          const search =
            typeof window !== 'undefined' ? window.location.search : '';
          void fetch(`/api/world/regenerate${search}`, { method: 'POST' }).catch(
            () => {},
          );
        }}
      >
        {copy.cta}
      </button>
    </div>
  );
}
