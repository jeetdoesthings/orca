'use client';

/**
 * ArtistHoverCard — floating glassmorphic information card that appears
 * when hovering over an artist node. Positioned in 3D space near the node.
 * 
 * Performance & QOL Optimization:
 * - 75ms hover debouncing to prevent flickering and network clutter on sweeps.
 * - Instant local image resolution for pre-cached Spotify/Wikipedia URLs.
 * - AbortController to cancel out-of-order network lookups immediately.
 * - Restrictive renders: transitions occur only when hover focuses on a node.
 */
import { useRef, useState, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useOrcaStore } from '@/store/orca';
import { getGenreColor } from '@/lib/graph/genre-normaliser';
import type { OrcaNode } from '@/lib/graph/types';
import { sharedDisplacedPositions } from './NodeField';
import { artistImageCache, getCachedArtistData } from './ArtistImageLayer';

export function ArtistHoverCard() {
  const graph = useOrcaStore(s => s.graph);
  const hoveredNodeId = useOrcaStore(s => s.hoveredNodeId);

  // Only show for hover
  const activeNodeId = hoveredNodeId;

  const [visible, setVisible] = useState(false);
  const [animState, setAnimState] = useState<'entering' | 'visible' | 'exiting' | 'hidden'>('hidden');
  const positionRef = useRef<[number, number, number]>([0, 0, 0]);
  const cardRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Image URL state (fetched from cache or resolved)
  const [imageUrl, setImageUrl] = useState('');

  const activeNode = useMemo(() => {
    if (!activeNodeId || !graph) return null;
    return graph.nodes.find(n => n.id === activeNodeId) ?? null;
  }, [activeNodeId, graph]);

  // 1. Debounce the active node focus (75ms delay)
  // This suppresses jitter, halts layout re-evaluations, and stops network fetches for sweeping cursors.
  const [debouncedNode, setDebouncedNode] = useState<OrcaNode | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedNode(activeNode);
    }, 75);

    return () => clearTimeout(timer);
  }, [activeNode]);

  // 2. Manage visibility transitions based on the debounced node focus
  useEffect(() => {
    if (debouncedNode) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setVisible(true);
      setAnimState('entering');
      // Smooth fade-in
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

  // 3. Resolve image with instant local checks and network request canceling
  useEffect(() => {
    if (!activeNode) {
      setImageUrl('');
      return;
    }

    const key = activeNode.name.toLowerCase().trim();

    // Strategy A: Direct cached URL in the graph node (Instant, no local network overhead)
    if (activeNode.imageUrl) {
      const proxiedUrl = activeNode.imageUrl.startsWith('/api/') || activeNode.imageUrl.startsWith('data:')
        ? activeNode.imageUrl
        : `/api/orca/image-proxy?url=${encodeURIComponent(activeNode.imageUrl)}`;
      setImageUrl(proxiedUrl);
      return;
    }

    // Strategy B: Direct texture loader cache hit
    const cached = getCachedArtistData(activeNode.name);
    if (cached && cached.status === 'loaded' && cached.imageUrl) {
      setImageUrl(cached.imageUrl);
      return;
    }

    // Strategy C: Fetch from Next.js server route, abortable if hover changes
    const controller = new AbortController();

    fetch(`/api/orca/image?artist=${encodeURIComponent(activeNode.name)}`, { signal: controller.signal })
      .then(res => res.json())
      .then(data => {
        if (data.imageUrl) {
          setImageUrl(data.imageUrl);
          // Pre-cache on the node so subsequent hovers are instantaneous
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

  // Update position from shared displaced positions each frame
  useFrame(() => {
    if (!activeNodeId) return;
    const pos = sharedDisplacedPositions.get(activeNodeId);
    if (pos) {
      // Slightly offset for the card to not block the node
      const normal = new THREE.Vector3(pos[0], pos[1], pos[2]).normalize();
      positionRef.current = [
        pos[0] + normal.x * 0.04,
        pos[1] + normal.y * 0.04,
        pos[2] + normal.z * 0.04,
      ];
    }
  });

  if (!visible || !debouncedNode) return null;

  const primaryGenre = debouncedNode.genres[0] || '';
  const genreColor = getGenreColor(primaryGenre.toLowerCase());
  const topGenres = debouncedNode.genres.slice(0, 4);

  return (
    <Html
      position={positionRef.current}
      style={{
        pointerEvents: 'none',
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
      zIndexRange={[50, 40]}
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
        }}
      >
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
        <div className="orca-hover-card-info">
          <div className="orca-hover-card-name">{debouncedNode.name}</div>

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
    </Html>
  );
}
