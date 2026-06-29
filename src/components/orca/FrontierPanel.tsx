'use client';

/**
 * FrontierPanel — beautiful glassmorphic slide-out catalog container showing
 * a browseable list of frontier artist nodes. Accessible bottom-right.
 */
import { useEffect, useState, useMemo } from 'react';
import { useOrcaStore } from '@/store/orca';
import { getGenreColor, normaliseGenre, GENRE_LABELS } from '@/lib/graph/genre-normaliser';
// Audio previews disabled
import type { OrcaNode } from '@/lib/graph/types';
import { Tooltip } from '@/components/ui/Tooltip';

interface FrontierPanelProps {
  onClose: () => void;
}

export function FrontierPanel({ onClose }: FrontierPanelProps) {
  const frontierNodes = useOrcaStore(s => s.frontierNodes);
  const frontierPanelOpen = useOrcaStore(s => s.frontierPanelOpen);
  const [open, setOpen] = useState(false);

  // Group frontier nodes by primary normalized genre
  const groupedByGenre = useMemo(() => {
    const groups: Record<string, OrcaNode[]> = {};
    for (const node of frontierNodes) {
      const primary = normaliseGenre(node.genres);
      if (!groups[primary]) {
        groups[primary] = [];
      }
      groups[primary].push(node);
    }
    return groups;
  }, [frontierNodes]);

  useEffect(() => {
    // Stagger animation state
    if (frontierPanelOpen) {
      requestAnimationFrame(() => setOpen(true));
    } else {
      setOpen(false);
    }
  }, [frontierPanelOpen]);

  if (!frontierPanelOpen) return null;

  return (
    <div
      className="orca-frontier-panel"
      style={{
        transform: open ? 'translateX(0)' : 'translateX(100%)',
      }}
      onClick={(e) => e.stopPropagation()} // Stop canvas triggers
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Close button */}
      <button
        type="button"
        className="orca-artist-panel-close"
        onClick={onClose}
        aria-label="Close unexplored panel"
        style={{ top: '16px', right: '16px' }} // slightly override for alignment
      >
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {/* Header */}
      <div
        style={{
          padding: '20px 24px 16px',
          borderBottom: '1px solid rgba(0, 0, 0, 0.06)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#111118', letterSpacing: '-0.01em' }}>
            Unexplored
          </div>
          <div style={{ fontSize: '11px', color: 'rgba(0, 0, 0, 0.38)', marginTop: '2px', fontWeight: 500 }}>
            {frontierNodes.length} artists adjacent to your taste
          </div>
        </div>
      </div>

      {/* Scrollable list container */}
      <div
        className="frontier-scroll-container"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px 0 32px',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
        }}
      >
        {Object.entries(groupedByGenre).map(([genre, artists]) => (
          <div key={genre}>
            {/* Genre section header */}
            <div
              style={{
                padding: '0 24px 8px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <div
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: getGenreColor(genre),
                  opacity: 0.7,
                }}
              />
              <span
                style={{
                  fontSize: '9.5px',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'rgba(0,0,0,0.38)',
                }}
              >
                {(GENRE_LABELS as Record<string, string>)[genre] || genre.replace(/-/g, ' ')}
              </span>
            </div>

            {/* List of artists in this genre */}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {artists.slice(0, 5).map(artist => (
                <FrontierArtistRow key={artist.id} artist={artist} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function artistImgSrc(url: string | null | undefined): string {
  if (!url) return '';
  if (url.startsWith('/api/') || url.startsWith('data:')) return url;
  return `/api/orca/image-proxy?url=${encodeURIComponent(url)}`;
}

function FrontierArtistRow({ artist }: { artist: OrcaNode }) {
  const [hovering, setHovering] = useState(false);
  const [status, setStatus] = useState<'idle' | 'adding' | 'done'>('idle');
  const [imageUrl, setImageUrl] = useState(artist.imageUrl ? artistImgSrc(artist.imageUrl) : '');
  const [imageError, setImageError] = useState(false);
  const transitionNodeToExplored = useOrcaStore(s => s.transitionNodeToExplored);
  const revertNodeTransition = useOrcaStore(s => s.revertNodeTransition);
  const setPinnedNode = useOrcaStore(s => s.setPinnedNode);
  const setFocusedNode = useOrcaStore(s => s.setFocusedNode);

  const primaryGenre = normaliseGenre(artist.genres);
  const genreColor = getGenreColor(primaryGenre);

  useEffect(() => {
    if (!artist.imageUrl) {
      const search = typeof window !== 'undefined' ? window.location.search : '';
      const searchSuffix = search ? '&' + search.substring(1) : '';
      fetch(`/api/orca/image?artist=${encodeURIComponent(artist.name)}${searchSuffix}`)
        .then(res => {
          if (res.ok) return res.json();
          throw new Error('Failed');
        })
        .then(data => {
          if (data && data.imageUrl) {
            const proxied = artistImgSrc(data.imageUrl);
            setImageUrl(proxied);
            artist.imageUrl = proxied; // mutate store reference cache
          }
        })
        .catch(() => {});
    } else {
      setImageUrl(artistImgSrc(artist.imageUrl));
    }
  }, [artist.imageUrl, artist.name]);

  async function handleExplore(e: React.MouseEvent) {
    e.stopPropagation();
    if (status !== 'idle') return;
    setStatus('adding');

    // 1. Optimistic transition
    transitionNodeToExplored(artist.id);
    
    // Open Spotify tab
    window.open(`https://open.spotify.com/artist/${artist.id}`, '_blank');

    try {
      // 2. Persist in database
      const search = typeof window !== 'undefined' ? window.location.search : '';
      const res = await fetch(`/api/user/explore${search}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artistId: artist.id, action: 'add-to-spotify' }),
      });

      if (!res.ok) throw new Error('API exploration failed');

      setStatus('done');
    } catch (err) {
      console.error('[Row Explore] Exploration failed, reverting:', err);
      revertNodeTransition(artist.id);
      setStatus('idle');
    }
  }

  return (
    <div
      onMouseEnter={() => {
        setHovering(true);
      }}
      onMouseLeave={() => {
        setHovering(false);
      }}
      onClick={() => {
        setPinnedNode(artist.id);
        setFocusedNode(artist.id);
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '8px 24px',
        background: hovering ? 'rgba(0,0,0,0.03)' : 'transparent',
        cursor: 'pointer',
        transition: 'background 150ms',
      }}
    >
      {/* Artist image */}
      <div
        style={{
          width: '28px',
          height: '28px',
          borderRadius: '50%',
          background: `${genreColor}18`,
          overflow: 'hidden',
          flexShrink: 0,
          border: '1px solid rgba(0, 0, 0, 0.05)',
        }}
      >
        {imageUrl && !imageError ? (
          <img 
            src={imageUrl} 
            width={28} 
            height={28} 
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

      {/* Artist name */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: '12.5px',
            fontWeight: 500,
            color: '#111118',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {artist.name}
        </div>
      </div>

      {/* Explore button */}
      <Tooltip position="left" content="Open this artist on Spotify and add to your library">
        <button
          type="button"
          onClick={handleExplore}
          disabled={status !== 'idle'}
          style={{
            background: 'rgba(0, 0, 0, 0.04)',
            border: '1px solid rgba(0, 0, 0, 0.08)',
            borderRadius: '100px',
            padding: '3px 10px',
            fontSize: '10.5px',
            fontWeight: 600,
            color: 'rgba(0, 0, 0, 0.65)',
            cursor: 'pointer',
            fontFamily: "'Inter', sans-serif",
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.4)',
            transition: 'background 0.2s, border-color 0.2s, transform 0.1s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(0, 0, 0, 0.08)';
            e.currentTarget.style.borderColor = 'rgba(0, 0, 0, 0.12)';
            e.currentTarget.style.transform = 'translateY(-0.5px)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(0, 0, 0, 0.04)';
            e.currentTarget.style.borderColor = 'rgba(0, 0, 0, 0.08)';
            e.currentTarget.style.transform = 'translateY(0)';
          }}
        >
          {status === 'adding' ? 'Exploring…' : status === 'done' ? 'Explored' : 'Explore'}
        </button>
      </Tooltip>
    </div>
  );
}
