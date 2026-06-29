'use client';

/**
 * OrcaHUD — minimal heads-up display overlay on top of the canvas.
 * Shows node count, expansion state, and hovered artist info.
 */
import { useEffect, useMemo, useState, useRef } from 'react';
import { useOrcaStore } from '@/store/orca';
import { getGenreColor, normaliseGenre } from '@/lib/graph/genre-normaliser';
import { useObservationStore } from '@/store/feedback';
import { getCachedArtistData } from './orca/ArtistImageLayer';
import type { OrcaNode } from '@/lib/graph/types';
import { FrontierPanel } from './orca/FrontierPanel';
import { Tooltip } from '@/components/ui/Tooltip';



// Helper to hash string to a deterministic positive integer
const getHash = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
};



function ConnectedArtistRow({ artist }: { artist: OrcaNode }) {
  const [imageUrl, setImageUrl] = useState(artist.imageUrl || '');
  const [hovered, setHovered] = useState(false);
  const [imageError, setImageError] = useState(false);
  const setPinnedNode = useOrcaStore(s => s.setPinnedNode);
  const setFocusedNode = useOrcaStore(s => s.setFocusedNode);

  const primaryGenre = normaliseGenre(artist.genres);
  const genreColor = getGenreColor(primaryGenre);

  useEffect(() => {
    if (!artist.imageUrl) {
      fetch(`/api/orca/image?artist=${encodeURIComponent(artist.name)}`)
        .then(res => {
          if (res.ok) return res.json();
          throw new Error('Failed');
        })
        .then(data => {
          if (data && data.imageUrl) {
            setImageUrl(data.imageUrl);
            artist.imageUrl = data.imageUrl; // cache it
          }
        })
        .catch(() => {});
    }
  }, [artist.imageUrl, artist.name, artist]);

  const displayImgUrl = imageUrl.startsWith('/api/') || imageUrl.startsWith('data:')
    ? imageUrl
    : imageUrl
      ? `/api/orca/image-proxy?url=${encodeURIComponent(imageUrl)}`
      : '';

  return (
    <div
      onClick={() => {
        setPinnedNode(artist.id);
        setFocusedNode(artist.id);
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '6px 10px',
        borderRadius: '8px',
        background: hovered ? 'rgba(0,0,0,0.04)' : 'rgba(0,0,0,0.015)',
        border: '1px solid rgba(0,0,0,0.03)',
        cursor: 'pointer',
        transition: 'all 150ms ease',
      }}
    >
      <div
        style={{
          width: '26px',
          height: '26px',
          borderRadius: '50%',
          overflow: 'hidden',
          flexShrink: 0,
          background: `${genreColor}18`,
          border: '1px solid rgba(0,0,0,0.05)',
        }}
      >
        {displayImgUrl && !imageError ? (
          <img 
            src={displayImgUrl} 
            width={26} 
            height={26} 
            style={{ borderRadius: '50%', objectFit: 'cover' }} 
            alt={artist.name} 
            onError={() => setImageError(true)}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '10px',
              fontWeight: 700,
              color: genreColor,
            }}
          >
            {artist.name.charAt(0)}
          </div>
        )}
      </div>
      <div
        style={{
          fontSize: '12px',
          fontWeight: 600,
          color: '#111118',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {artist.name}
      </div>
    </div>
  );
}

function AlbumArt({ imageUrl, name, genreColor }: { imageUrl: string; name: string; genreColor: string }) {
  const [error, setError] = useState(false);

  const src = imageUrl.startsWith('/api/') || imageUrl.startsWith('data:')
    ? imageUrl
    : imageUrl
      ? `/api/orca/image-proxy?url=${encodeURIComponent(imageUrl)}`
      : '';

  if (error || !src) {
    return (
      <div 
        className="orca-album-art-placeholder"
        style={{ background: `${genreColor}35` }}
      >
        {name.charAt(0)}
      </div>
    );
  }

  return (
    <img 
      src={src} 
      alt={name} 
      className="orca-album-art" 
      onError={() => setError(true)}
    />
  );
}

export function OrcaHUD() {
  const tasteSummary = useOrcaStore(s => s.tasteSummary || '');
  const { observations, acknowledgeObservation } = useObservationStore();
  const searchSuffix = typeof window !== 'undefined' ? window.location.search : '';

  const graph = useOrcaStore(s => s.graph);
  const isExpanding = useOrcaStore(s => s.isExpanding);
  const pinnedNodeId = useOrcaStore(s => s.pinnedNodeId);
  const frontierPanelOpen = useOrcaStore(s => s.frontierPanelOpen);
  const setFrontierPanelOpen = useOrcaStore(s => s.setFrontierPanelOpen);
  const setFocusedNode = useOrcaStore(s => s.setFocusedNode);
  const setPinnedNode = useOrcaStore(s => s.setPinnedNode);
  
  // Globe Controls (Phase 3.5)
  const showJourney = useOrcaStore(s => s.showJourney);
  const showHistory = useOrcaStore(s => s.showHistory);
  const relationshipFilter = useOrcaStore(s => s.relationshipFilter);
  const setShowJourney = useOrcaStore(s => s.setShowJourney);
  const setShowHistory = useOrcaStore(s => s.setShowHistory);
  const setRelationshipFilter = useOrcaStore(s => s.setRelationshipFilter);
  
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isMobile, setIsMobile] = useState(false);

  // Draggable coordinate positioning mechanics
  const [panelPos, setPanelPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const panelStart = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const [exploreStatus, setExploreStatus] = useState<'idle' | 'adding' | 'done'>('idle');
  const transitionNodeToExplored = useOrcaStore(s => s.transitionNodeToExplored);
  const revertNodeTransition = useOrcaStore(s => s.revertNodeTransition);

  async function handleExploreFrontier(node: OrcaNode, action: 'add-to-spotify' | 'mark-explored') {
    if (exploreStatus !== 'idle') return;
    setExploreStatus('adding');

    // 1. Optimistic transition
    transitionNodeToExplored(node.id);
    
    if (action === 'add-to-spotify') {
      // Open Spotify tab
      window.open(`https://open.spotify.com/artist/${node.id}`, '_blank');
    }

    try {
      // 2. Persist in database
      const search = typeof window !== 'undefined' ? window.location.search : '';
      const res = await fetch(`/api/artist/${node.id}/integrate${search}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) throw new Error('API exploration failed');

      setExploreStatus('done');
    } catch (err) {
      console.error('[HUD Explore] Exploration failed, reverting:', err);
      revertNodeTransition(node.id);
      setExploreStatus('idle');
    }
  }

  const [followStatus, setFollowStatus] = useState<'idle' | 'loading' | 'done'>('idle');
  const [ignoreStatus, setIgnoreStatus] = useState<'idle' | 'loading' | 'done'>('idle');
  const [journeyStatus, setJourneyStatus] = useState<'idle' | 'loading' | 'done'>('idle');

  async function handleFollowArtist(artistId: string, action: 'follow' | 'unfollow') {
    if (followStatus !== 'idle') return;
    setFollowStatus('loading');
    
    // Optimistic UI update
    if (pinnedNode) {
      pinnedNode.availableActions = {
        ...pinnedNode.availableActions,
        canExplore: action === 'unfollow',
        canSave: true,
        canListen: true
      } as any;
    }

    try {
      const search = typeof window !== 'undefined' ? window.location.search : '';
      const res = await fetch(`/api/artist/${artistId}/${action}${search}`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed');
      setFollowStatus('done');
      setTimeout(() => setFollowStatus('idle'), 2000);
    } catch (err) {
      console.error(err);
      setFollowStatus('idle');
    }
  }

  async function handleIgnoreArtist(artistId: string) {
    if (ignoreStatus !== 'idle') return;
    setIgnoreStatus('loading');

    // Optimistic UI
    const prevIntegrated = pinnedNode?.alreadyIntegrated;
    if (pinnedNode) {
      pinnedNode.alreadyIntegrated = false;
    }

    try {
      const search = typeof window !== 'undefined' ? window.location.search : '';
      const res = await fetch(`/api/artist/${artistId}/ignore${search}`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed');
      setIgnoreStatus('done');
      setTimeout(() => setIgnoreStatus('idle'), 2000);
    } catch (err) {
      console.error(err);
      if (pinnedNode) pinnedNode.alreadyIntegrated = prevIntegrated;
      setIgnoreStatus('idle');
    }
  }

  async function handleJourneyAction(genreName: string, action: 'start' | 'continue' | 'cancel', journeyId?: string) {
    if (journeyStatus !== 'idle') return;
    setJourneyStatus('loading');

    try {
      const search = typeof window !== 'undefined' ? window.location.search : '';
      let res;
      if (action === 'start') {
        res = await fetch(`/api/journeys${search}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ destinationGenreId: genreName })
        });
      } else {
        res = await fetch(`/api/journeys/${journeyId}/${action}${search}`, { method: 'POST' });
      }

      if (!res.ok) throw new Error('Failed');
      
      // Force sync update immediately
      const globeRes = await fetch(`/api/globe${search}`);
      if (globeRes.ok) {
        const globeData = await globeRes.json();
        if (globeData.status === 'ready') {
          useOrcaStore.getState().setGraph({ ...globeData });
        }
      }

      setJourneyStatus('done');
      setTimeout(() => setJourneyStatus('idle'), 2000);
    } catch (err) {
      console.error(err);
      setJourneyStatus('idle');
    }
  }

  const frontierNodes = useOrcaStore(s => s.frontierNodes);
  const edgeCount = graph?.edges.length ?? 0;
  const exploredCount = graph?.nodes.filter(n => n.state === 'explored').length ?? 0;
  const frontierCount = frontierNodes.length;
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
        return b.weight - a.weight;
      })
      .slice(0, 6);
  }, [graph, normalizedQuery]);

  // Bottom card only shows for pinned state (hover has the floating 3D card)
  const pinnedNode = useMemo(() => {
    if (!pinnedNodeId || !graph) return null;
    return graph.nodes.find(n => n.id === pinnedNodeId) || frontierNodes.find(n => n.id === pinnedNodeId) || null;
  }, [pinnedNodeId, graph, frontierNodes]);

  const adjacentExplored = useMemo(() => {
    if (!pinnedNode || !graph || pinnedNode.state !== 'frontier') return [];

    // Use real adjacentTo data if available (stored on frontier nodes)
    if (pinnedNode.adjacentTo && pinnedNode.adjacentTo.length > 0) {
      return pinnedNode.adjacentTo
        .map(id => graph.nodes.find(n => n.id === id))
        .filter((n): n is typeof graph.nodes[number] => n != null)
        .slice(0, 3);
    }

    // Fallback for legacy frontier data without adjacentTo
    const primaryGenre = normaliseGenre(pinnedNode.genres);
    return graph.nodes.filter(n =>
      n.state === 'explored' &&
      normaliseGenre(n.genres) === primaryGenre
    ).slice(0, 3);
  }, [pinnedNode, graph]);

  // ── Render-time State Synchronization ──
  const [prevPinnedNode, setPrevPinnedNode] = useState<OrcaNode | null>(null);
  const [fetchedImageUrl, setFetchedImageUrl] = useState('');
  const [prevMatches, setPrevMatches] = useState<OrcaNode[]>([]);
  const [prevPinnedNodeId, setPrevPinnedNodeId] = useState<string | null>(null);

  if (pinnedNode !== prevPinnedNode) {
    setPrevPinnedNode(pinnedNode);
    setFetchedImageUrl('');
  }

  if (matches !== prevMatches) {
    setPrevMatches(matches);
    setActiveIndex(-1);
  }

  if (pinnedNodeId !== prevPinnedNodeId) {
    setPrevPinnedNodeId(pinnedNodeId);
    const bestMatch = matches[0];
    if (!bestMatch || pinnedNodeId !== bestMatch.id) {
      setQuery('');
    }
  }

  // Resolve pinned artist image instantly
  const derivedImageUrl = useMemo(() => {
    if (!pinnedNode) return '';
    if (pinnedNode.imageUrl) {
      return pinnedNode.imageUrl.startsWith('/api/') || pinnedNode.imageUrl.startsWith('data:')
        ? pinnedNode.imageUrl
        : `/api/orca/image-proxy?url=${encodeURIComponent(pinnedNode.imageUrl)}`;
    }
    const cached = getCachedArtistData(pinnedNode.name);
    if (cached && cached.status === 'loaded' && cached.imageUrl) {
      return cached.imageUrl;
    }
    return '';
  }, [pinnedNode]);

  const displayPinnedImageUrl = fetchedImageUrl || derivedImageUrl;

  useEffect(() => {
    if (!pinnedNode || derivedImageUrl !== '') return;

    let cancelled = false;
    const search = typeof window !== 'undefined' ? window.location.search : '';
    const searchSuffix = search ? '&' + search.substring(1) : '';

    fetch(`/api/orca/image?artist=${encodeURIComponent(pinnedNode.name)}${searchSuffix}`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        if (data.imageUrl) {
          const proxied = data.imageUrl.startsWith('/api/') || data.imageUrl.startsWith('data:')
            ? data.imageUrl
            : `/api/orca/image-proxy?url=${encodeURIComponent(data.imageUrl)}`;
          setFetchedImageUrl(proxied);
          pinnedNode.imageUrl = proxied; // save on node
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [pinnedNode, derivedImageUrl]);

  // Resolve rich details for the pinned artist
  const [prevPinnedNodeForDetails, setPrevPinnedNodeForDetails] = useState<OrcaNode | null>(null);
  const [details, setDetails] = useState<{
    description: string;
    albums: Array<{ name: string; playcount: number; imageUrl: string; spotifyUrl: string }>;
    tracks: Array<{ name: string; playcount: number; spotifyUrl: string }>;
    artistSpotifyUrl?: string;
  } | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showAllAlbums, setShowAllAlbums] = useState(false);
  const [showAllTracks, setShowAllTracks] = useState(false);

  if (pinnedNode !== prevPinnedNodeForDetails) {
    setPrevPinnedNodeForDetails(pinnedNode);
    setDetails(null);
    setDetailsLoading(pinnedNode ? true : false);
    setPanelPos({ x: 0, y: 0 });
    setShowAbout(false);
    setShowAllAlbums(false);
    setShowAllTracks(false);
  }

  useEffect(() => {
    if (!pinnedNode) return;
    let cancelled = false;

    const search = typeof window !== 'undefined' ? window.location.search : '';
    const searchSuffix = search ? '&' + search.substring(1) : '';
    fetch(`/api/orca/artist-details?artist=${encodeURIComponent(pinnedNode.name)}&id=${encodeURIComponent(pinnedNode.id)}${searchSuffix}`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        setDetails(data);
        setDetailsLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load artist details:', err);
        if (cancelled) return;
        setDetails(null);
        setDetailsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [pinnedNode]);

  const handlePointerDown = (e: React.PointerEvent) => {
    // Only permit dragging with primary mouse click
    if (e.button !== 0) return;
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    panelStart.current = { x: panelPos.x, y: panelPos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.stopPropagation();
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setPanelPos({
      x: panelStart.current.x + dx,
      y: panelStart.current.y + dy,
    });
    e.stopPropagation();
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setIsDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
    e.stopPropagation();
  };



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
      <Tooltip position="right" content="About ORCA">
        <div className="orca-logo" onClick={() => setIsAboutOpen(true)}>
          <img
            src="/ORCA_logo.png"
            alt="ORCA Logo"
            style={{
              width: '36px',
              height: '36px',
              objectFit: 'contain',
              mixBlendMode: 'multiply',
            }}
          />
          <span>ORCA</span>
        </div>
      </Tooltip>

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
          borderRadius: '100px',
          boxShadow: '0 10px 34px rgba(0, 0, 0, 0.08), 0 1px 4px rgba(0, 0, 0, 0.05)',
          padding: '0 12px 0 16px',
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
              fontWeight: 500,
            }}
          />
          {query && (
            <Tooltip position="bottom" content="Clear search">
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
            </Tooltip>
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
                  {node.genres.slice(0, 3).join(' · ')}
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
        <div>{exploredCount} explored · {frontierCount} unexplored</div>
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

      {/* Floating Light Glassmorphic Artist Info Panel */}
      <div 
        className={`orca-artist-panel ${pinnedNode ? 'active' : ''}`}
        style={{
          ...(isMobile ? {} : { transform: `translate(${panelPos.x}px, ${panelPos.y}px)` }),
          transition: isDragging ? 'none' : 'opacity 300ms ease, transform 300ms ease',
        }}
        // Block pointer and mouse interactions to prevent unpinning when clicking/scrolling the panel
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {pinnedNode && (
          <>
            {/* Close action */}
            <Tooltip position="left" content="Close details">
              <button 
                type="button" 
                className="orca-artist-panel-close"
                onClick={clearSearch}
                aria-label="Close details panel"
              >
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </Tooltip>

            {/* Scrollable contents */}
            <div className="orca-artist-panel-scroll">
              
              {/* Header: Banner with profile image and details (Draggable handle area) */}
              <div 
                className={`orca-artist-header ${isMobile ? '' : 'orca-artist-drag-handle'}`}
                {...(isMobile ? {} : {
                  onPointerDown: handlePointerDown,
                  onPointerMove: handlePointerMove,
                  onPointerUp: handlePointerUp,
                })}
              >
                <div className="orca-artist-banner-wrap">
                  {displayPinnedImageUrl ? (
                    <img 
                      src={displayPinnedImageUrl} 
                      alt={pinnedNode.name} 
                      className="orca-artist-banner-img"
                    />
                  ) : (
                    <div 
                      className="orca-artist-banner-img" 
                      style={{ 
                        background: getGenreColor((pinnedNode.genres[0] || '').toLowerCase()),
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '32px',
                        fontWeight: 800,
                        color: 'rgba(255, 255, 255, 0.9)'
                      }}
                    >
                      {pinnedNode.name.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase()).join('')}
                    </div>
                  )}
                  <div className="orca-artist-banner-overlay" />
                </div>

                <div className="orca-artist-header-info">
                  {details?.artistSpotifyUrl ? (
                    <a 
                      href={details.artistSpotifyUrl} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      style={{ textDecoration: 'none' }}
                      onPointerDown={(e) => e.stopPropagation()} // Stop drag capture!
                      onClick={(e) => e.stopPropagation()} // Prevent dragging panel on clicking link
                    >
                      <h2 className="orca-artist-name-title" style={{ transition: 'color 0.2s ease' }} onMouseEnter={(e) => e.currentTarget.style.color = getGenreColor((pinnedNode.genres[0] || '').toLowerCase())} onMouseLeave={(e) => e.currentTarget.style.color = '#111118'}>
                        {pinnedNode.name} ↗
                      </h2>
                    </a>
                  ) : (
                    <h2 className="orca-artist-name-title">{pinnedNode.name}</h2>
                  )}
                  {pinnedNode.genres.length > 0 && (
                    <span 
                      className="orca-artist-genre-badge"
                      style={{
                        color: getGenreColor((pinnedNode.genres[0] || '').toLowerCase()),
                        borderColor: `${getGenreColor((pinnedNode.genres[0] || '').toLowerCase())}40`,
                        background: `${getGenreColor((pinnedNode.genres[0] || '').toLowerCase())}15`,
                      }}
                    >
                      {pinnedNode.genres[0].replace(/-/g, ' ')}
                    </span>
                  )}

                </div>
              </div>

              {/* Frontier Details Section */}
              {pinnedNode.state === 'frontier' && (
                <div className="orca-frontier-details" style={{
                  background: 'rgba(29, 185, 84, 0.08)',
                  border: '1px solid rgba(29, 185, 84, 0.15)',
                  borderRadius: '12px',
                  padding: isMobile ? '10px' : '14px',
                  marginBottom: isMobile ? '10px' : '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px'
                }}>
                  <div style={{
                    fontSize: isMobile ? '10px' : '11px',
                    fontWeight: 700,
                    color: '#1db954',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase'
                  }}>
                    Unexplored Artist
                  </div>

                  {adjacentExplored.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <div style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Connected through
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {adjacentExplored.map(a => (
                          <ConnectedArtistRow key={a.id} artist={a} />
                        ))}
                      </div>
                    </div>
                  )}

                  <div style={{ fontSize: isMobile ? '11px' : '13px', color: 'rgba(0,0,0,0.55)', lineHeight: '1.4', whiteSpace: 'normal' }}>
                    {(() => {
                      const genre = (pinnedNode.genres[0] || '').replace(/-/g, ' ');
                      const nameHash = getHash(pinnedNode.id);
                      const connCount = adjacentExplored.length;
                      const sig = pinnedNode.audioSignature;
                      const isHighEnergy = sig && sig.energy > 0.7;
                      const isLowEnergy = sig && sig.energy < 0.35;
                      const isAcoustic = sig && sig.acousticness > 0.5;
                      const isDanceable = sig && sig.danceability > 0.7;

                      const templates: string[] = [];

                      // Genre-aware templates
                      if (genre) {
                        templates.push(
                          `A fresh voice in the ${genre} space sitting right at the edge of your catalog. Explore to expand your ${genre} territory.`,
                          `Your ${genre} constellation has a gap — ${pinnedNode.name} could be the missing link. Tap explore to pull them in.`,
                          `Closely orbiting your ${genre} cluster, ${pinnedNode.name} shares DNA with artists you already love.`,
                        );
                      }

                      // Connection-count-aware templates
                      if (connCount >= 3) {
                        templates.push(
                          `Strongly connected to multiple artists in your universe — ${pinnedNode.name} is a natural next addition.`,
                          `Multiple threads tie ${pinnedNode.name} to your existing world. This is a high-confidence journey.`,
                        );
                      } else if (connCount === 1) {
                        templates.push(
                          `A single thread connects ${pinnedNode.name} to your universe — exploring could open up an entirely new sonic branch.`,
                          `${pinnedNode.name} is tethered by one connection. This could be the start of something unexpected.`,
                        );
                      } else if (connCount === 2) {
                        templates.push(
                          `Two paths lead to ${pinnedNode.name} from your explored territory — a solid bridge to new sounds.`,
                          `${pinnedNode.name} sits at the intersection of two artists you know. A natural discovery.`,
                        );
                      }

                      // Audio-signature-aware templates
                      if (isHighEnergy) {
                        templates.push(
                          `${pinnedNode.name} brings an explosive energy that could supercharge your collection. Hit explore to feel the heat.`,
                        );
                      }
                      if (isLowEnergy) {
                        templates.push(
                          `${pinnedNode.name} offers a quieter, more introspective corner of music — a beautiful contrast in your universe.`,
                        );
                      }
                      if (isAcoustic) {
                        templates.push(
                          `Rooted in organic, acoustic textures, ${pinnedNode.name} would add warmth and depth to your catalog.`,
                        );
                      }
                      if (isDanceable) {
                        templates.push(
                          `${pinnedNode.name} brings infectious rhythm and groove — a dancefloor-ready addition to your world.`,
                        );
                      }

                      // Fallback generic pool
                      if (templates.length === 0) {
                        templates.push(
                          `${pinnedNode.name} lives at the frontier of your music universe. Explore to bring them into your world.`,
                          `Just beyond your current catalog, ${pinnedNode.name} is waiting to be discovered.`,
                          `${pinnedNode.name} could be your next favorite artist. Tap explore to find out.`,
                        );
                      }

                      return templates[nameHash % templates.length];
                    })()}
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <Tooltip position="top" content="Open in Spotify and add to your library">
                      <button
                        type="button"
                        onClick={() => handleExploreFrontier(pinnedNode, 'add-to-spotify')}
                        disabled={exploreStatus !== 'idle'}
                        style={{
                          flex: 1.2,
                          background: '#1db954',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: '100px',
                          padding: isMobile ? '10px 16px' : '12px 20px',
                          fontSize: isMobile ? '12px' : '13.5px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          boxShadow: '0 4px 14px rgba(29, 185, 84, 0.25)',
                          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                          fontFamily: "'Inter', sans-serif"
                        }}
                        onMouseEnter={(e) => { 
                          e.currentTarget.style.background = '#1ed760'; 
                          e.currentTarget.style.transform = 'translateY(-1px)'; 
                          e.currentTarget.style.boxShadow = '0 6px 20px rgba(29, 185, 84, 0.35)';
                        }}
                        onMouseLeave={(e) => { 
                          e.currentTarget.style.background = '#1db954'; 
                          e.currentTarget.style.transform = 'translateY(0)';
                          e.currentTarget.style.boxShadow = '0 4px 14px rgba(29, 185, 84, 0.25)';
                        }}
                      >
                        {exploreStatus === 'adding' ? 'Exploring…' : exploreStatus === 'done' ? 'Explored!' : 'Explore Artist'}
                      </button>
                    </Tooltip>

                    <Tooltip position="top" content="Mark as explored without opening Spotify">
                      <button
                        type="button"
                        onClick={() => handleExploreFrontier(pinnedNode, 'mark-explored')}
                        disabled={exploreStatus !== 'idle'}
                        style={{
                          flex: 0.8,
                          background: 'rgba(255, 255, 255, 0.55)',
                          color: '#1e293b',
                          border: '1px solid rgba(0, 0, 0, 0.08)',
                          borderRadius: '100px',
                          padding: isMobile ? '10px 16px' : '12px 20px',
                          fontSize: isMobile ? '12px' : '13.5px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          backdropFilter: 'blur(10px)',
                          WebkitBackdropFilter: 'blur(10px)',
                          boxShadow: '0 4px 14px rgba(0, 0, 0, 0.04)',
                          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                          fontFamily: "'Inter', sans-serif"
                        }}
                        onMouseEnter={(e) => { 
                          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.8)'; 
                          e.currentTarget.style.borderColor = 'rgba(0, 0, 0, 0.12)'; 
                          e.currentTarget.style.transform = 'translateY(-1px)'; 
                          e.currentTarget.style.boxShadow = '0 6px 20px rgba(0, 0, 0, 0.08)';
                        }}
                        onMouseLeave={(e) => { 
                          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.55)'; 
                          e.currentTarget.style.borderColor = 'rgba(0, 0, 0, 0.08)'; 
                          e.currentTarget.style.transform = 'translateY(0)';
                          e.currentTarget.style.boxShadow = '0 4px 14px rgba(0, 0, 0, 0.04)';
                        }}
                      >
                        I know this
                      </button>
                    </Tooltip>
                  </div>

                  <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                    <button
                      type="button"
                      onClick={() => handleFollowArtist(pinnedNode.id, 'follow')}
                      disabled={followStatus !== 'idle'}
                      style={{
                        flex: 1,
                        background: 'rgba(255, 255, 255, 0.45)',
                        color: '#1e293b',
                        border: '1px solid rgba(0, 0, 0, 0.08)',
                        borderRadius: '100px',
                        padding: '8px 12px',
                        fontSize: '11.5px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        backdropFilter: 'blur(8px)',
                        WebkitBackdropFilter: 'blur(8px)',
                        boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.5)',
                        transition: 'background 0.2s',
                        fontFamily: "'Inter', sans-serif"
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.7)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.45)'; }}
                    >
                      {followStatus === 'loading' ? 'Loading…' : 'Follow Artist'}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleIgnoreArtist(pinnedNode.id)}
                      disabled={ignoreStatus !== 'idle'}
                      style={{
                        flex: 1,
                        background: 'rgba(255, 255, 255, 0.45)',
                        color: '#1e293b',
                        border: '1px solid rgba(0, 0, 0, 0.08)',
                        borderRadius: '100px',
                        padding: '8px 12px',
                        fontSize: '11.5px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        backdropFilter: 'blur(8px)',
                        WebkitBackdropFilter: 'blur(8px)',
                        boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.5)',
                        transition: 'background 0.2s',
                        fontFamily: "'Inter', sans-serif"
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.7)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.45)'; }}
                    >
                      {ignoreStatus === 'loading' ? 'Loading…' : 'Ignore Artist'}
                    </button>
                  </div>

                  {/* Genre Journey Opportunities (GIA-driven) */}
                  {(() => {
                    const primaryGenreName = pinnedNode.genres?.[0]?.toLowerCase();
                    const genreSnapshot = graph?.genres.find((g: any) => g.name.toLowerCase() === primaryGenreName);
                    if (!genreSnapshot) return null;

                    const isJourneyActive = genreSnapshot.journey?.active;
                    const canStart = genreSnapshot.availableActions?.canStartJourney;
                    const canContinue = genreSnapshot.availableActions?.canContinueJourney;
                    const canCancel = genreSnapshot.availableActions?.canPause;

                    if (!canStart && !canContinue && !isJourneyActive) return null;

                    return (
                      <div style={{
                        marginTop: '16px',
                        padding: '12px',
                        background: 'rgba(255, 255, 255, 0.45)',
                        border: '1px solid rgba(0, 0, 0, 0.08)',
                        borderRadius: '12px',
                        backdropFilter: 'blur(10px)',
                        WebkitBackdropFilter: 'blur(10px)',
                      }}>
                        <h4 style={{
                          margin: '0 0 6px 0',
                          fontSize: '11px',
                          fontWeight: 700,
                          color: 'rgba(0,0,0,0.8)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em'
                        }}>
                          Genre Journey: {genreSnapshot.name}
                        </h4>
                        <p style={{
                          margin: '0 0 10px 0',
                          fontSize: '11px',
                          color: 'rgba(0,0,0,0.55)',
                          lineHeight: '1.4'
                        }}>
                          {isJourneyActive 
                            ? `Active journey in progress. Current step: ${genreSnapshot.journey?.milestone || 1}.`
                            : `A template pathway is available to integrate this genre into your profile.`}
                        </p>

                        <div style={{ display: 'flex', gap: '8px' }}>
                          {isJourneyActive ? (
                            <>
                              <button
                                type="button"
                                onClick={() => handleJourneyAction(genreSnapshot.name, 'continue', 'active-id')}
                                disabled={journeyStatus !== 'idle'}
                                style={{
                                  flex: 1.2,
                                  background: '#1db954',
                                  color: '#ffffff',
                                  border: 'none',
                                  borderRadius: '100px',
                                  padding: '8px 12px',
                                  fontSize: '11.5px',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: '6px',
                                  boxShadow: '0 2px 8px rgba(29, 185, 84, 0.2)',
                                  transition: 'background 0.2s',
                                  fontFamily: "'Inter', sans-serif"
                                }}
                              >
                                Continue
                              </button>
                              <button
                                type="button"
                                onClick={() => handleJourneyAction(genreSnapshot.name, 'cancel', 'active-id')}
                                disabled={journeyStatus !== 'idle'}
                                style={{
                                  flex: 0.8,
                                  background: 'rgba(0, 0, 0, 0.05)',
                                  color: 'rgba(0, 0, 0, 0.7)',
                                  border: '1px solid rgba(0, 0, 0, 0.08)',
                                  borderRadius: '100px',
                                  padding: '8px 12px',
                                  fontSize: '11.5px',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: '6px',
                                  transition: 'background 0.2s',
                                  fontFamily: "'Inter', sans-serif"
                                }}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleJourneyAction(genreSnapshot.name, 'start')}
                              disabled={journeyStatus !== 'idle'}
                              style={{
                                width: '100%',
                                background: 'rgba(29, 185, 84, 0.85)',
                                color: '#ffffff',
                                border: '1px solid rgba(29, 185, 84, 0.2)',
                                borderRadius: '100px',
                                padding: '8px 12px',
                                fontSize: '11.5px',
                                fontWeight: 600,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '6px',
                                boxShadow: '0 2px 8px rgba(29, 185, 84, 0.15)',
                                transition: 'background 0.2s',
                                fontFamily: "'Inter', sans-serif"
                              }}
                            >
                              Start Journey
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
 


              {/* Essential Albums */}
              <div>
                <h3 className="orca-panel-section-title">Essential Albums</h3>
                <div className="orca-albums-list">
                  {detailsLoading ? (
                    [1, 2, 3].map(i => (
                      <div key={i} className="orca-album-item" style={{ background: 'transparent', padding: '8px 0' }}>
                        <div className="orca-skeleton" style={{ width: '42px', height: '42px', borderRadius: '6px' }} />
                        <div className="orca-album-info" style={{ flex: 1 }}>
                          <div className="orca-skeleton" style={{ height: '12px', width: '60%', marginBottom: '6px' }} />
                          <div className="orca-skeleton" style={{ height: '10px', width: '40%' }} />
                        </div>
                      </div>
                    ))
                  ) : (
                    (showAllAlbums ? details?.albums : details?.albums.slice(0, 3))?.map((album, idx) => {
                      const albumEl = (
                        <div className="orca-album-item" style={{ minWidth: 0 }}>
                          <AlbumArt 
                            imageUrl={album.imageUrl} 
                            name={album.name} 
                            genreColor={getGenreColor((pinnedNode.genres[0] || '').toLowerCase())} 
                          />
                          <div className="orca-album-info">
                            <span className="orca-album-name">{album.name}</span>
                            <span className="orca-album-popularity">
                              {album.playcount && album.playcount < 2100 
                                ? `Album · ${album.playcount}` 
                                : 'Album'}
                            </span>
                          </div>
                        </div>
                      );

                      return album.spotifyUrl ? (
                        <a 
                          key={idx}
                          href={album.spotifyUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ textDecoration: 'none', display: 'block', color: 'inherit', minWidth: 0 }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {albumEl}
                        </a>
                      ) : (
                        <div key={idx} style={{ minWidth: 0 }}>{albumEl}</div>
                      );
                    })
                  )}
                </div>
                {details && details.albums.length > 3 && (
                  <Tooltip position="top" content={showAllAlbums ? 'Show fewer albums' : 'Show all albums'}>
                    <button
                      type="button"
                      onClick={() => setShowAllAlbums(!showAllAlbums)}
                      style={{
                        width: '100%',
                        background: 'rgba(0, 0, 0, 0.02)',
                        border: '1px solid rgba(0, 0, 0, 0.04)',
                        borderRadius: '8px',
                        padding: '8px',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: 'rgba(0, 0, 0, 0.5)',
                        cursor: 'pointer',
                        marginTop: '8px',
                        transition: 'all 0.2s ease',
                        textAlign: 'center',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(0, 0, 0, 0.04)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(0, 0, 0, 0.02)'}
                    >
                      {showAllAlbums ? 'Show Less' : `Show More (${details.albums.length - 3} more)`}
                    </button>
                  </Tooltip>
                )}
              </div>

              {/* Essential Tracks */}
              <div>
                <h3 className="orca-panel-section-title">Essential Tracks</h3>
                <div className="orca-tracks-list">
                  {detailsLoading ? (
                    [1, 2, 3].map(i => (
                      <div key={i} className="orca-track-item" style={{ background: 'transparent', padding: '8px 0' }}>
                        <div className="orca-skeleton" style={{ height: '12px', width: '80%' }} />
                      </div>
                    ))
                  ) : (
                    (showAllTracks ? details?.tracks : details?.tracks.slice(0, 3))?.map((track, idx) => {
                      const trackEl = (
                        <div className="orca-track-item">
                          <div className="orca-track-left" style={{ minWidth: 0, flex: 1 }}>
                            <span className="orca-track-index">{idx + 1}</span>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0, flex: 1 }}>
                              <span className="orca-track-name">{track.name}</span>
                            </div>
                          </div>
                          <div 
                            className="orca-track-visualizer"
                            style={{ color: getGenreColor((pinnedNode.genres[0] || '').toLowerCase()) }}
                          >
                            <div className="orca-vis-bar" />
                            <div className="orca-vis-bar" />
                            <div className="orca-vis-bar" />
                          </div>
                        </div>
                      );

                      return track.spotifyUrl ? (
                        <a 
                          key={idx}
                          href={track.spotifyUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ textDecoration: 'none', display: 'block', color: 'inherit', minWidth: 0 }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {trackEl}
                        </a>
                      ) : (
                        <div key={idx} style={{ minWidth: 0 }}>{trackEl}</div>
                      );
                    })
                  )}
                </div>
                {details && details.tracks.length > 3 && (
                  <Tooltip position="top" content={showAllTracks ? 'Show fewer tracks' : 'Show all tracks'}>
                    <button
                      type="button"
                      onClick={() => setShowAllTracks(!showAllTracks)}
                      style={{
                        width: '100%',
                        background: 'rgba(0, 0, 0, 0.02)',
                        border: '1px solid rgba(0, 0, 0, 0.04)',
                        borderRadius: '8px',
                        padding: '8px',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: 'rgba(0, 0, 0, 0.5)',
                        cursor: 'pointer',
                        marginTop: '8px',
                        transition: 'all 0.2s ease',
                        textAlign: 'center',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(0, 0, 0, 0.04)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(0, 0, 0, 0.02)'}
                    >
                      {showAllTracks ? 'Show Less' : `Show More (${details.tracks.length - 3} more)`}
                    </button>
                  </Tooltip>
                )}
              </div>

              {/* Collapsible About Section */}
              <div style={{
                border: '1px solid rgba(0, 0, 0, 0.05)',
                borderRadius: '12px',
                background: 'rgba(0, 0, 0, 0.01)',
                overflow: 'hidden',
                marginTop: '6px'
              }}>
                <Tooltip position="top" content="Toggle biography details">
                  <button
                    type="button"
                    onClick={() => setShowAbout(!showAbout)}
                    style={{
                      width: '100%',
                      background: 'transparent',
                      border: 'none',
                      padding: '12px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      fontSize: '10px',
                      fontWeight: 600,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: 'rgba(0, 0, 0, 0.5)',
                    }}
                  >
                    <span>About the Artist</span>
                    <svg 
                      width="10" 
                      height="6" 
                      viewBox="0 0 10 6" 
                      fill="none" 
                      style={{
                        transform: showAbout ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform 0.2s ease',
                        color: 'rgba(0, 0, 0, 0.4)'
                      }}
                    >
                      <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                </Tooltip>
                {showAbout && (
                  <div style={{ 
                    padding: '0 14px 14px 14px', 
                    fontSize: '13px', 
                    lineHeight: '1.6', 
                    color: 'rgba(0, 0, 0, 0.7)' 
                  }}>
                    {detailsLoading ? (
                      <div className="orca-artist-bio">
                        <div className="orca-skeleton" style={{ height: '14px', width: '100%', marginBottom: '6px' }} />
                        <div className="orca-skeleton" style={{ height: '14px', width: '95%', marginBottom: '6px' }} />
                        <div className="orca-skeleton" style={{ height: '14px', width: '80%' }} />
                      </div>
                    ) : (
                      <p className="orca-artist-bio" style={{ color: 'rgba(0, 0, 0, 0.65)' }}>
                        {details?.description}
                      </p>
                    )}
                  </div>
                )}
              </div>

            </div>
          </>
        )}
      </div>

      {/* Centered Taste Summary Text */}
      {(tasteSummary || graph) && (
        <div 
          className="taste-summary-text"
          style={{
            position: 'fixed',
            bottom: '9%',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 10,
            fontSize: '13px',
            color: 'rgba(0,0,0,0.38)',
            fontWeight: 500,
            letterSpacing: '0.02em',
            textAlign: 'center',
            width: '80%',
            maxWidth: '600px',
            pointerEvents: 'none',
            userSelect: 'none',
            animation: 'fadeInText 1s ease-out 800ms forwards',
            opacity: 0,
            fontFamily: "'Inter', system-ui, sans-serif",
          }}
        >
          {graph ? (
            <>
              {graph.nodes.length} artists <span style={{ fontWeight: 'bold', margin: '0 4px' }}>•</span> {new Set(graph.nodes.map(n => n.genres[0] || 'pop')).size} territories
            </>
          ) : (
            tasteSummary
          )}
        </div>
      )}

      {/* Phase 2 Widgets */}

      <FrontierPanel onClose={() => setFrontierPanelOpen(false)} />

      {/* Frontier Toggle Button — bottom right */}
      <Tooltip position="left" content="Toggle Unexplored frontier list">
        <button
          type="button"
          className="orca-frontier-toggle-btn"
          onClick={() => setFrontierPanelOpen(!frontierPanelOpen)}
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            background: 'rgba(255, 255, 255, 0.88)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            border: '1px solid rgba(20, 20, 20, 0.08)',
            borderRadius: '100px',
            padding: '8px 18px',
            fontSize: '11px',
            fontWeight: 600,
            color: '#111118',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0,0,0,0.03)',
            zIndex: 20,
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            pointerEvents: 'auto',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => { 
            e.currentTarget.style.background = '#ffffff'; 
            e.currentTarget.style.transform = 'scale(1.03)';
          }}
          onMouseLeave={(e) => { 
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.88)'; 
            e.currentTarget.style.transform = 'none';
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ color: 'rgba(0,0,0,0.5)' }}>
            <path d="M1 5H9M5 1V9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Unexplored
        </button>
      </Tooltip>

      {/* Animation keyframes */}
      <style>{`
        @keyframes hudPulse {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 0.9; }
        }
        @keyframes fadeInHUD {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeInText {
          from { opacity: 0; transform: translate(-50%, 6px); }
          to   { opacity: 1; transform: translate(-50%, 0); }
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>

      {isAboutOpen && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.22)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          zIndex: 10001,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'auto',
        }}
        onClick={() => setIsAboutOpen(false)}
        >
          <div style={{
            background: 'rgba(255, 255, 255, 0.88)',
            backdropFilter: 'blur(32px) saturate(1.8)',
            WebkitBackdropFilter: 'blur(32px) saturate(1.8)',
            border: '1px solid rgba(0, 0, 0, 0.08)',
            borderRadius: isMobile ? '16px' : '20px',
            boxShadow: '0 30px 60px rgba(0, 0, 0, 0.15), 0 4px 15px rgba(0, 0, 0, 0.05)',
            padding: isMobile ? '20px' : '32px',
            maxWidth: '460px',
            width: isMobile ? '92%' : '90%',
            maxHeight: isMobile ? '80vh' : 'none',
            overflowY: isMobile ? 'auto' as const : 'visible' as const,
            color: '#111118',
            position: 'relative',
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif",
            display: 'flex',
            flexDirection: 'column' as const,
            gap: isMobile ? '14px' : '20px',
          }}
          onClick={e => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => setIsAboutOpen(false)}
              style={{
                position: 'absolute',
                top: '16px',
                right: '16px',
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                background: 'rgba(0, 0, 0, 0.05)',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'rgba(0,0,0,0.45)',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(0, 0, 0, 0.1)';
                e.currentTarget.style.color = '#000';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(0, 0, 0, 0.05)';
                e.currentTarget.style.color = 'rgba(0,0,0,0.45)';
              }}
            >
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>

            {/* About Section */}
            <div>
              <h2 style={{
                fontSize: '20px',
                fontWeight: 700,
                color: '#111118',
                marginBottom: '8px',
                letterSpacing: '-0.015em',
              }}>
                About ORCA
              </h2>
              <p style={{
                fontSize: '13px',
                lineHeight: '1.65',
                color: 'rgba(0, 0, 0, 0.62)',
              }}>
                ORCA helps you expand your music taste.
                <br /><br />
                By analyzing your listening habits and highlighting unexplored areas of music, ORCA encourages discovery beyond the playlists and algorithmic loops that dominate modern streaming platforms.
              </p>
            </div>

            {/* Why ORCA Section */}
            <div>
              <h3 style={{
                fontSize: '14px',
                fontWeight: 650,
                color: '#111118',
                marginBottom: '6px',
              }}>
                Why ORCA?
              </h3>
              <p style={{
                fontSize: '13px',
                lineHeight: '1.65',
                color: 'rgba(0, 0, 0, 0.62)',
              }}>
                <strong>Finding great music is easy. Expanding your taste is hard.</strong>
                <br /><br />
                ORCA is designed to help listeners move beyond algorithmic comfort zones and discover music they wouldn&apos;t normally encounter. The goal isn&apos;t more algorithms—it&apos;s meaningful musical exploration.
              </p>
            </div>

            {/* Current State & Version Section */}
            <div>
              <h3 style={{
                fontSize: '14px',
                fontWeight: 650,
                color: '#111118',
                marginBottom: '6px',
              }}>
                Current Version
              </h3>
              <p style={{
                fontSize: '12px',
                lineHeight: '1.65',
                color: 'rgba(0, 0, 0, 0.55)',
                background: 'rgba(0, 0, 0, 0.03)',
                padding: '10px 14px',
                borderRadius: '10px',
                border: '1px solid rgba(0, 0, 0, 0.04)',
              }}>
                <span style={{ fontWeight: 700, color: '#111118', display: 'block', marginBottom: '4px' }}>
                  Pre-Alpha 1.11
                </span>
                ORCA is currently in active development. Core visualization, Spotify integration, and exploration systems are operational as we build the next generation of taste expansion tools.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Cognitive Feedback Layer Observation Toast Stack */}
      <div style={{
        position: 'fixed',
        top: '20px',
        right: '20px',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        maxWidth: '360px',
        pointerEvents: 'none'
      }}>
        {observations.map(item => (
          <div
            key={item.id}
            style={{
              pointerEvents: 'auto',
              background: item.priority >= 4 ? 'rgba(251, 191, 36, 0.95)' : 'rgba(255, 255, 255, 0.92)',
              color: item.priority >= 4 ? '#78350f' : '#1e293b',
              border: '1px solid rgba(0, 0, 0, 0.08)',
              borderRadius: '16px',
              padding: '16px',
              boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              animation: 'slideIn 0.3s ease-out',
              fontFamily: "'Inter', sans-serif"
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{
                fontSize: '11px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: item.priority >= 4 ? '#92400e' : '#64748b'
              }}>
                Priority {item.priority} • {item.type}
              </span>
              <button
                type="button"
                onClick={() => acknowledgeObservation(item.id, searchSuffix)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'currentColor',
                  cursor: 'pointer',
                  padding: '2px',
                  opacity: 0.6,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>

            <h4 style={{ margin: 0, fontSize: '13.5px', fontWeight: 700 }}>
              {item.summary}
            </h4>
            {item.detail && (
              <p style={{ margin: 0, fontSize: '12px', lineHeight: '1.4', opacity: 0.9 }}>
                {item.detail}
              </p>
            )}

            {item.availableActions && item.availableActions.length > 0 && (
              <div style={{ marginTop: '4px', display: 'flex', gap: '8px' }}>
                {item.availableActions.map((action, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={async () => {
                      try {
                        const res = await fetch(`${action.endpoint}${searchSuffix}`, {
                          method: action.method || 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: action.payload ? JSON.stringify(action.payload) : undefined
                        });
                        if (res.ok) {
                          acknowledgeObservation(item.id, searchSuffix);
                          const globeRes = await fetch(`/api/globe${searchSuffix}`);
                          if (globeRes.ok) {
                            const globeData = await globeRes.json();
                            if (globeData.status === 'ready') {
                              useOrcaStore.getState().setGraph({ ...globeData });
                            }
                          }
                        }
                      } catch (err) {
                        console.error('Suggested action failed:', err);
                      }
                    }}
                    style={{
                      background: item.priority >= 4 ? '#78350f' : '#1db954',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '100px',
                      padding: '6px 12px',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.06)'
                    }}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

