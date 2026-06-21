'use client';

/**
 * ExpansionSharePrompt — congratulations popup that slides up 1.5 seconds after
 * a successful frontier exploration event, offering a screenshot capture prompt.
 */
import { useEffect, useState, useMemo } from 'react';
import { useOrcaStore } from '@/store/orca';
import { getGenreColor } from '@/lib/graph/genre-normaliser';

export function ExpansionSharePrompt() {
  const graph = useOrcaStore(s => s.graph);
  const expansionEvent = useOrcaStore(s => s.expansionEvent);
  
  const [visible, setVisible] = useState(false);
  const [activeArtist, setActiveArtist] = useState<any | null>(null);

  // Combine explored and frontier nodes to search details
  const allNodes = useMemo(() => {
    if (!graph) return [];
    return [...graph.nodes, ...useOrcaStore.getState().frontierNodes];
  }, [graph]);

  useEffect(() => {
    if (!expansionEvent || !graph) {
      setVisible(false);
      setActiveArtist(null);
      return;
    }

    const artistId = expansionEvent.nodeId;
    const match = allNodes.find(n => n.id === artistId);
    if (!match) return;

    // Trigger celebration card 1.5 seconds after transition completed per Section 14
    const timer = setTimeout(() => {
      setActiveArtist(match);
      setVisible(true);
    }, 1500);

    return () => clearTimeout(timer);
  }, [expansionEvent, graph, allNodes]);

  if (!visible || !activeArtist) return null;

  const genreColor = getGenreColor(activeArtist.genres[0] || 'pop');

  const handleShare = () => {
    // Locate the default screenshot sharing trigger inside HUD
    const shareBtn = document.querySelector('.orca-share-btn') as HTMLButtonElement | null;
    if (shareBtn) {
      shareBtn.click();
    } else {
      // Basic fallback alert
      alert(`Sharing your discovery of ${activeArtist.name}!`);
    }
  };

  const handleDismiss = () => {
    setVisible(false);
  };

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '80px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(255, 255, 255, 0.9)',
        backdropFilter: 'blur(16px) saturate(1.4)',
        WebkitBackdropFilter: 'blur(16px) saturate(1.4)',
        border: '1px solid rgba(0, 0, 0, 0.08)',
        borderRadius: '16px',
        padding: '12px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
        boxShadow: '0 12px 36px rgba(0, 0, 0, 0.09), 0 2px 8px rgba(0,0,0,0.04)',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        animation: 'slideUpPrompt 350ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
        zIndex: 500,
        pointerEvents: 'auto',
      }}
      onClick={(e) => e.stopPropagation()} // Stop canvas triggers
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Small genre dot */}
      <div
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: genreColor,
          flexShrink: 0,
          boxShadow: `0 0 8px ${genreColor}`,
        }}
      />

      {/* Narrative info */}
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: '150px' }}>
        <div style={{ fontSize: '12.5px', color: '#111118', fontWeight: 650, letterSpacing: '-0.01em' }}>
          Your universe just expanded
        </div>
        <div style={{ fontSize: '10.5px', color: 'rgba(0, 0, 0, 0.42)', marginTop: '2px', fontWeight: 500 }}>
          {activeArtist.name} is now part of your world
        </div>
      </div>

      {/* Share action button */}
      <button
        type="button"
        onClick={handleShare}
        style={{
          background: 'rgba(0, 0, 0, 0.05)',
          border: 'none',
          borderRadius: '100px',
          padding: '6px 14px',
          fontSize: '11px',
          fontWeight: 600,
          color: '#111118',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
          transition: 'background 0.2s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0, 0, 0, 0.08)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0, 0, 0, 0.05)'; }}
      >
        Share
      </button>

      {/* Dismiss cross */}
      <button
        type="button"
        onClick={handleDismiss}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'rgba(0, 0, 0, 0.28)',
          fontSize: '16px',
          fontWeight: 400,
          padding: '0 2px',
          lineHeight: 1,
          fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
          transition: 'color 0.2s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = '#111118'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(0, 0, 0, 0.28)'; }}
      >
        ×
      </button>

      {/* Keyframe animations */}
      <style>{`
        @keyframes slideUpPrompt {
          from { opacity: 0; transform: translate(-50%, 16px); }
          to   { opacity: 1; transform: translate(-50%, 0); }
        }
      `}</style>
    </div>
  );
}
