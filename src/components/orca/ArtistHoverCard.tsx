'use client';

/**
 * ArtistHoverCard — floating glassmorphic information card that appears
 * when hovering over an artist node. Positioned in 3D space near the node.
 */
import { useRef, useState, useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useOrcaStore } from '@/store/orca';
import { useObservationStore } from '@/store/feedback';
import { getGenreColor, normaliseGenre } from '@/lib/graph/genre-normaliser';
import type { OrcaNode } from '@/lib/graph/types';
import { sharedDisplacedPositions } from './NodeField';
import { getCachedArtistData } from './ArtistImageLayer';
import { translateSemanticRole } from '@/lib/product-language';

function HoverAvatar({ artist, index }: { artist: OrcaNode; index: number }) {
  const [imageUrl, setImageUrl] = useState(artist.imageUrl || '');

  useEffect(() => {
    if (!artist.imageUrl) {
      const suffix =
        typeof window !== 'undefined' ? window.location.search : '';
      fetch(`/api/orca/image?artist=${encodeURIComponent(artist.name)}${suffix ? '&' + suffix.substring(1) : ''}`)
        .then(res => {
          if (res.ok) return res.json();
          throw new Error('Failed');
        })
        .then(data => {
          if (data && data.imageUrl) {
            setImageUrl(data.imageUrl);
            artist.imageUrl = data.imageUrl;
          }
        })
        .catch(() => {});
    } else {
      setImageUrl(artist.imageUrl);
    }
  }, [artist.imageUrl, artist.name]);

  const genreColor = getGenreColor((artist.genres[0] || '').toLowerCase());
  const displayImgUrl = imageUrl.startsWith('/api/') || imageUrl.startsWith('data:')
    ? imageUrl
    : imageUrl
      ? `/api/orca/image-proxy?url=${encodeURIComponent(imageUrl)}`
      : '';

  return (
    <div
      style={{
        width: '18px',
        height: '18px',
        borderRadius: '50%',
        overflow: 'hidden',
        border: '1.5px solid #ffffff',
        background: `${genreColor}18`,
        marginLeft: index > 0 ? '-6px' : '0px',
        zIndex: 5 - index,
        flexShrink: 0,
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
      }}
    >
      {displayImgUrl ? (
        <img src={displayImgUrl} width={18} height={18} style={{ borderRadius: '50%', objectFit: 'cover' }} alt={artist.name} />
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '7px',
            fontWeight: 800,
            color: genreColor,
          }}
        >
          {artist.name.charAt(0)}
        </div>
      )}
    </div>
  );
}

export function ArtistHoverCard() {
  const { size } = useThree();
  const isMobile = size.width < 640;
  const graph = useOrcaStore(s => s.graph);
  const hoveredNodeId = useOrcaStore(s => s.hoveredNodeId);
  // Audio selectors removed
  const transitionNodeToExplored = useOrcaStore(s => s.transitionNodeToExplored);
  const revertNodeTransition = useOrcaStore(s => s.revertNodeTransition);

  const activeNodeId = hoveredNodeId;

  const [visible, setVisible] = useState(false);
  const [animState, setAnimState] = useState<'entering' | 'visible' | 'exiting' | 'hidden'>('hidden');
  const positionRef = useRef<[number, number, number]>([0, 0, 0]);
  const cardRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [imageUrl, setImageUrl] = useState('');
  const [exploreStatus, setExploreStatus] = useState<'idle' | 'adding' | 'done'>('idle');

  // Combine graph nodes and frontier nodes to search details
  const allNodes = useMemo(() => {
    if (!graph) return [];
    return [...graph.nodes, ...useOrcaStore.getState().frontierNodes];
  }, [graph]);

  const activeNode = useMemo(() => {
    if (!activeNodeId || !graph) return null;
    return allNodes.find(n => n.id === activeNodeId) ?? null;
  }, [activeNodeId, graph, allNodes]);

  // Debounce the active node focus (75ms delay)
  const [debouncedNode, setDebouncedNode] = useState<OrcaNode | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedNode(activeNode);
    }, 75);

    return () => clearTimeout(timer);
  }, [activeNode]);

  // Manage visibility transitions
  useEffect(() => {
    if (debouncedNode) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setVisible(true);
      setAnimState('entering');
      setExploreStatus('idle'); // Reset exploration button state
      timeoutRef.current = setTimeout(() => setAnimState('visible'), 150);
    } else {
      setAnimState('exiting');
      timeoutRef.current = setTimeout(() => {
        setVisible(false);
        setAnimState('hidden');
      }, 100);
    }
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [debouncedNode]);

  // Resolve image cache or proxy
  useEffect(() => {
    if (!activeNode) {
      setImageUrl('');
      return;
    }

    if (activeNode.imageUrl) {
      const proxiedUrl = activeNode.imageUrl.startsWith('/api/') || activeNode.imageUrl.startsWith('data:')
        ? activeNode.imageUrl
        : `/api/orca/image-proxy?url=${encodeURIComponent(activeNode.imageUrl)}`;
      setImageUrl(proxiedUrl);
      return;
    }

    const cached = getCachedArtistData(activeNode.name);
    if (cached && cached.status === 'loaded' && cached.imageUrl) {
      setImageUrl(cached.imageUrl);
      return;
    }

    const controller = new AbortController();
    const suffix2 =
      typeof window !== 'undefined' ? window.location.search : '';
    fetch(`/api/orca/image?artist=${encodeURIComponent(activeNode.name)}${suffix2 ? '&' + suffix2.substring(1) : ''}`, { signal: controller.signal })
      .then(res => res.json())
      .then(data => {
        if (data.imageUrl) {
          setImageUrl(data.imageUrl);
          activeNode.imageUrl = data.imageUrl;
        } else {
          setImageUrl('');
        }
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setImageUrl('');
        }
      });

    return () => {
      controller.abort();
    };
  }, [activeNode]);

  // Prefer real seed links (adjacentTo) — same artists that draw the edges
  const adjacentExplored = useMemo(() => {
    if (!debouncedNode || !graph || debouncedNode.state !== 'frontier') return [];
    if (debouncedNode.adjacentTo && debouncedNode.adjacentTo.length > 0) {
      const fromSeeds = debouncedNode.adjacentTo
        .map((id) => graph.nodes.find((n) => n.id === id))
        .filter((n): n is OrcaNode => n != null)
        .slice(0, 5);
      if (fromSeeds.length > 0) return fromSeeds;
    }
    // Fallback: same-genre explored (legacy snapshots without adjacentTo)
    const primaryGenre = normaliseGenre(debouncedNode.genres);
    return graph.nodes
      .filter(
        (n) =>
          n.state === 'explored' &&
          normaliseGenre(n.genres) === primaryGenre,
      )
      .slice(0, 3);
  }, [debouncedNode, graph]);

  // Update position from shared displaced positions each frame
  useFrame(() => {
    if (!activeNodeId) return;
    const pos = sharedDisplacedPositions.get(activeNodeId);
    if (pos) {
      const normal = new THREE.Vector3(pos[0], pos[1], pos[2]).normalize();
      positionRef.current = [
        pos[0] + normal.x * 0.04,
        pos[1] + normal.y * 0.04,
        pos[2] + normal.z * 0.04,
      ];
    }
  });

  if (isMobile) return null;
  if (!visible || !debouncedNode) return null;

  const primaryGenre = debouncedNode.genres[0] || '';
  const genreColor = getGenreColor(primaryGenre.toLowerCase());
  const topGenres = debouncedNode.genres.slice(0, 3);

  const isFrontier = debouncedNode.state === 'frontier';
  const isPlaying = false;

  async function handleExplore(action: 'add-to-spotify' | 'mark-explored') {
    if (!debouncedNode || exploreStatus !== 'idle') return;
    setExploreStatus('adding');

    // 1. Optimistic UI update
    transitionNodeToExplored(debouncedNode.id);

    try {
      // 2. Persist in database
      const search = typeof window !== 'undefined' ? window.location.search : '';
      const res = await fetch(`/api/user/explore${search}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artistId: debouncedNode.id, action }),
      });

      if (!res.ok) throw new Error('API exploration failed');

      // 3. Open Spotify in new tab if selected
      if (action === 'add-to-spotify') {
        window.open(`https://open.spotify.com/search/${encodeURIComponent(debouncedNode.name)}`, '_blank');
      }

      setExploreStatus('done');

      // Add a client-side observation notification
      useObservationStore.getState().addObservation({
        id: `obs_explored_${debouncedNode.id}_${Date.now()}`,
        type: 'ArtistExplored',
        summary: `Explored ${debouncedNode.name}`,
        detail: `Successfully added ${debouncedNode.name} to your taste graph.`,
        priority: 2,
        confidence: 1.0,
        timestamp: new Date().toISOString(),
        relatedEntities: { artistId: debouncedNode.id },
        availableActions: [],
        ttl: 1800,
        status: 'active'
      });
    } catch (err) {
      console.error('[HoverCard Explore] Exploration failed, reverting:', err);
      // Revert optimistic transition
      revertNodeTransition(debouncedNode.id);
      setExploreStatus('idle');
    }
  }

  return (
    <Html
      position={positionRef.current}
      style={{
        pointerEvents: animState === 'visible' ? 'auto' : 'none', // Allow clicks inside hover card only when settled
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
      zIndexRange={[60, 50]}
      occlude={false}
    >
      <div
        ref={cardRef}
        className="orca-hover-card"
        style={{
          opacity: animState === 'entering' || animState === 'visible' ? 1 : 0,
          transform: `translate(-50%, -120%) translateY(${
            animState === 'entering' || animState === 'visible' ? '0px' : '6px'
          })`,
          transition: 'opacity 150ms ease-out, transform 150ms ease-out',
          flexDirection: 'column',
          alignItems: 'stretch',
          gap: '8px',
          minWidth: isFrontier ? '240px' : '200px',
          pointerEvents: animState === 'visible' ? 'auto' : 'none',
        }}
        onClick={(e) => e.stopPropagation()} // Block R3F OrbitControls clicks
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '12px' }}>
          {/* Profile Image */}
          <div className="orca-hover-card-image-wrap">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={debouncedNode.name}
                className="orca-hover-card-image"
                style={{ borderColor: genreColor }}
              />
            ) : (
              <div
                className="orca-hover-card-image-placeholder"
                style={{ background: genreColor }}
              >
                {debouncedNode.name.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase()).join('')}
              </div>
            )}
          </div>

          {/* Artist Info */}
          <div className="orca-hover-card-info" style={{ flex: 1 }}>
            <div className="orca-hover-card-name" style={{ fontSize: '13.5px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>{debouncedNode.name}</span>
              {isFrontier && (() => {
                const trans = translateSemanticRole(debouncedNode.semanticRole);
                return (
                  <span
                    style={{
                      fontSize: '9px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      background: `${trans.badgeColor}18`,
                      color: trans.badgeColor,
                      border: `1px solid ${trans.badgeColor}33`,
                    }}
                  >
                    {trans.label}
                  </span>
                );
              })()}
            </div>

            {/* Genre Pills */}
            <div className="orca-hover-card-genres">
              {topGenres.map((g, i) => (
                <span
                  key={g}
                  className="orca-genre-pill"
                  style={{
                    background: i === 0
                      ? `${getGenreColor(g.toLowerCase())}18`
                      : 'rgba(0,0,0,0.04)',
                    color: i === 0
                      ? getGenreColor(g.toLowerCase())
                      : 'rgba(0,0,0,0.45)',
                    borderColor: i === 0
                      ? `${getGenreColor(g.toLowerCase())}30`
                      : 'rgba(0,0,0,0.06)',
                  }}
                >
                  {g.replace(/-/g, ' ')}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Frontier Nodes Enhancements */}
        {isFrontier && adjacentExplored.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              marginTop: '4px',
              borderTop: '1px solid rgba(0,0,0,0.06)',
              paddingTop: '8px',
            }}
          >
            {/* "Because you know..." connection paths */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                {adjacentExplored.map((a, idx) => (
                  <HoverAvatar key={a.id} artist={a} index={idx} />
                ))}
              </div>
              <div
                style={{
                  fontSize: '10.5px',
                  color: 'rgba(0, 0, 0, 0.45)',
                  lineHeight: '1.4',
                  whiteSpace: 'normal',
                }}
              >
                Because you know{' '}
                <span style={{ fontWeight: 600, color: '#111118' }}>
                  {adjacentExplored.slice(0, 2).map(a => a.name).join(' & ')}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </Html>
  );
}
