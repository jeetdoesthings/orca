'use client';

/**
 * OrcaHUD — minimal heads-up display overlay on top of the canvas.
 * Shows node count, expansion state, and hovered artist info.
 */
import { useEffect, useMemo, useState, useRef } from 'react';
import { useOrcaStore } from '@/store/orca';

export function OrcaHUD() {
  const graph = useOrcaStore(s => s.graph);
  const isExpanding = useOrcaStore(s => s.isExpanding);
  const hoveredNodeId = useOrcaStore(s => s.hoveredNodeId);
  const pinnedNodeId = useOrcaStore(s => s.pinnedNodeId);
  const setFocusedNode = useOrcaStore(s => s.setFocusedNode);
  const setPinnedNode = useOrcaStore(s => s.setPinnedNode);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const edgeCount = graph?.edges.length ?? 0;
  const exploredCount = graph?.nodes.filter(n => n.state === 'explored').length ?? 0;
  const frontierCount = graph?.nodes.filter(n => n.state === 'frontier').length ?? 0;
  const normalizedQuery = query.trim().toLowerCase();

  const matches = useMemo(() => {
    if (!graph || normalizedQuery.length < 2) return [];

    return graph.nodes
      .filter(node => node.name.toLowerCase().includes(normalizedQuery))
      .sort((a, b) => {
        const aName = a.name.toLowerCase();
        const bName = b.name.toLowerCase();
        const aStarts = aName.startsWith(normalizedQuery) ? 0 : 1;
        const bStarts = bName.startsWith(normalizedQuery) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return b.weight - a.weight || b.popularity - a.popularity;
      })
      .slice(0, 6);
  }, [graph, normalizedQuery]);

  const activeNodeId = hoveredNodeId ?? pinnedNodeId;
  const activeNode = activeNodeId
    ? graph?.nodes.find(n => n.id === activeNodeId)
    : null;

  // Reset keyboard highlight index when search matches list changes
  useEffect(() => {
    setActiveIndex(-1);
  }, [matches]);

  useEffect(() => {
    if (normalizedQuery.length < 2) {
      // Only sync search when there is an active query, preventing background expansions from clearing pinned nodes
      return;
    }

    const bestMatch = matches[0];
    if (!bestMatch) return;

    setFocusedNode(bestMatch.id);
    setPinnedNode(bestMatch.id);
  }, [matches, normalizedQuery, setFocusedNode, setPinnedNode]);

  // Clear search query if user manually pins a different node on the globe
  useEffect(() => {
    if (!pinnedNodeId || query === '') return;
    if (document.activeElement === inputRef.current) return;

    const bestMatch = matches[0];
    if (!bestMatch || pinnedNodeId !== bestMatch.id) {
      setQuery('');
    }
  }, [pinnedNodeId, matches, query]);

  const selectArtist = (id: string, name: string) => {
    setQuery(name);
    setFocusedNode(id);
    setPinnedNode(id);
  };

  const clearSearch = () => {
    setQuery('');
    setFocusedNode(null);
    setPinnedNode(null);
  };

  return (
    <>
      {/* ORCA Branding — top left */}
      <div className="orca-logo">
        ORCA
      </div>

      {/* Artist search — top right */}
      <div className="orca-search-container">
        <div style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          minHeight: '42px',
          background: 'rgba(255, 255, 255, 0.82)',
          backdropFilter: 'blur(18px)',
          WebkitBackdropFilter: 'blur(18px)',
          border: '1px solid rgba(20, 20, 20, 0.08)',
          borderRadius: '12px',
          boxShadow: '0 10px 34px rgba(0, 0, 0, 0.08), 0 1px 4px rgba(0, 0, 0, 0.05)',
          padding: '0 10px 0 14px',
        }}>
          <span style={{
            width: '13px',
            height: '13px',
            border: '1.7px solid rgba(0, 0, 0, 0.38)',
            borderRadius: '50%',
            position: 'relative',
            flex: '0 0 auto',
          }}>
            <span style={{
              position: 'absolute',
              width: '6px',
              height: '1.7px',
              right: '-5px',
              bottom: '-2px',
              background: 'rgba(0, 0, 0, 0.38)',
              borderRadius: '2px',
              transform: 'rotate(45deg)',
              transformOrigin: 'center',
            }} />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Escape') clearSearch();
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                if (matches.length > 0) {
                  setActiveIndex(prev => (prev + 1) % matches.length);
                }
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                if (matches.length > 0) {
                  setActiveIndex(prev => (prev - 1 + matches.length) % matches.length);
                }
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                const target = activeIndex >= 0 && matches[activeIndex] ? matches[activeIndex] : matches[0];
                if (target) {
                  selectArtist(target.id, target.name);
                }
              }
            }}
            placeholder="Search artist"
            aria-label="Search artist"
            style={{
              flex: 1,
              minWidth: 0,
              height: '40px',
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: '#111118',
              fontFamily: "'Inter', system-ui, sans-serif",
              fontSize: '13px',
              fontWeight: 500,
            }}
          />
          {query && (
            <button
              type="button"
              onClick={clearSearch}
              aria-label="Clear artist search"
              style={{
                width: '24px',
                height: '24px',
                border: 'none',
                borderRadius: '50%',
                background: 'rgba(0, 0, 0, 0.05)',
                color: 'rgba(0, 0, 0, 0.45)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(0, 0, 0, 0.1)';
                e.currentTarget.style.color = 'rgba(0, 0, 0, 0.7)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(0, 0, 0, 0.05)';
                e.currentTarget.style.color = 'rgba(0, 0, 0, 0.45)';
              }}
            >
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}
        </div>

        {normalizedQuery.length >= 2 && (
          <div style={{
            marginTop: '8px',
            background: 'rgba(255, 255, 255, 0.9)',
            backdropFilter: 'blur(18px)',
            WebkitBackdropFilter: 'blur(18px)',
            border: '1px solid rgba(20, 20, 20, 0.08)',
            borderRadius: '12px',
            boxShadow: '0 10px 34px rgba(0, 0, 0, 0.08), 0 1px 4px rgba(0, 0, 0, 0.05)',
            overflow: 'hidden',
          }}>
            {matches.length > 0 ? matches.map((node, index) => (
              <button
                key={node.id}
                type="button"
                onClick={() => selectArtist(node.id, node.name)}
                style={{
                  width: '100%',
                  border: 'none',
                  borderBottom: '1px solid rgba(0, 0, 0, 0.045)',
                  background: index === activeIndex ? 'rgba(0, 0, 0, 0.05)' : (node.id === pinnedNodeId ? 'rgba(29, 185, 84, 0.09)' : 'transparent'),
                  padding: '10px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: '3px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: "'Inter', system-ui, sans-serif",
                }}
              >
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#111118' }}>
                  {node.name}
                </span>
                <span style={{
                  fontSize: '10px',
                  color: 'rgba(0, 0, 0, 0.42)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: '100%',
                }}>
                  {node.genres.slice(0, 3).join(' · ') || `${node.popularity} popularity`}
                </span>
              </button>
            )) : (
              <div style={{
                padding: '12px 14px',
                fontSize: '12px',
                color: 'rgba(0, 0, 0, 0.45)',
              }}>
                No artist found
              </div>
            )}
          </div>
        )}
      </div>

      {/* Node count — bottom left */}
      <div className="orca-stats">
        <div>{exploredCount} explored · {frontierCount} frontier</div>
        <div>{edgeCount} connections</div>
      </div>

      {/* Expansion indicator */}
      {isExpanding && (
        <div className="orca-expansion-status">
          <div style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: '#1DB954',
            animation: 'hudPulse 1.5s ease-in-out infinite',
          }} />
          exploring…
        </div>
      )}

      {/* Active artist info — bottom center */}
      {activeNode && (
        <div className="orca-active-artist-card">
          <span style={{ fontSize: '13px', fontWeight: 500, color: '#111118' }}>
            {activeNode.name}
          </span>
          {activeNode.genres.length > 0 && (
            <span style={{
              fontSize: '10px',
              color: 'rgba(0, 0, 0, 0.4)',
              letterSpacing: '0.03em',
            }}>
              {activeNode.genres.slice(0, 3).join(' · ')}
            </span>
          )}
        </div>
      )}

      {/* Animation keyframes */}
      <style>{`
        @keyframes hudPulse {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 0.9; }
        }
      `}</style>
    </>
  );
}
