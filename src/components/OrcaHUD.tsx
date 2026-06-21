'use client';

/**
 * OrcaHUD — minimal heads-up display overlay on top of the canvas.
 * Shows node count, expansion state, and hovered artist info.
 */
import { useEffect, useMemo, useState, useRef } from 'react';
import { useOrcaStore } from '@/store/orca';
import { getGenreColor, normaliseGenre } from '@/lib/graph/genre-normaliser';
import { getCachedArtistData } from './orca/ArtistImageLayer';
import type { AudioSignature, OrcaNode } from '@/lib/graph/types';
import { useSession } from 'next-auth/react';
import { FrontierPanel } from './orca/FrontierPanel';



// Helper to hash string to a deterministic positive integer
const getHash = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
};

const INTRO_TEMPLATES = [
  (name: string) => `${name} is a stellar fit for your catalog.`,
  (name: string) => `Adding ${name} to your rotation will instantly elevate your collection.`,
  (name: string) => `${name} stands out as a highly recommended discovery for your musical journey.`,
];

const HIGH_ENERGY_TEMPLATES = [
  () => `If you love high-octane music that gets your heart pumping and has an infectious pulse, their high-energy sound signature will instantly hook you.`,
  () => `With a high-intensity pulse and explosive dynamic drive, their tracks deliver an exhilarating rush perfect for high-focus moments.`,
  () => `Their sound thrives on a powerful, driving energy that charges the air, offering a vibrant and electrifying sonic experience.`
];

const LOW_ENERGY_TEMPLATES = [
  () => `If you appreciate raw, intimate, and stripped-back music that lets you breathe and drift away, their gentle and atmospheric soundscapes provide a gorgeous, peaceful sanctuary.`,
  () => `They construct incredibly serene, ambient soundscapes that invite quiet introspection and offer a beautiful, calming retreat from the noise.`,
  () => `Their compositions lean into elegant, low-tempo intimacy, enveloping you in delicate, dreamlike textures and quiet, evocative moments.`
];

const BALANCED_ENERGY_TEMPLATES = [
  () => `They strike a beautiful balance in their sound, blending just enough drive and tempo to keep you engaged while keeping the overall feel smooth and relaxed.`,
  () => `Their tempo sits in a perfect mid-range pocket—delivering a steady, satisfying movement that is highly engaging yet completely effortless to listen to.`,
  () => `Stylistically versatile, they capture a medium-tempo groove that flows smoothly, offering enough momentum to move you without feeling overwhelming.`
];

const HIGH_ACOUSTIC_TEMPLATES = [
  () => `Grounded in warm, organic textures, they build a beautiful acoustic space around real instruments and authentic wood-and-wire resonance.`,
  () => `Their arrangements showcase gorgeous analog depth, putting acoustic instruments, rich wooden resonance, and raw human performance front and center.`,
  () => `Emphasizing natural instruments and organic tones, their music feels remarkably tactile, breathing with an earthy, unplugged quality.`
];

const LOW_ACOUSTIC_TEMPLATES = [
  () => `Their futuristic, clean synthesized soundscapes offer an electric, modern edge that feels incredibly fresh.`,
  () => `They utilize sleek, synthetic textures and brilliant digital sound design, carving out a modern, neon-lit soundscape.`,
  () => `Drenched in clean electronic architecture and crisp digital production, their sonic palette feels wonderfully advanced and futuristic.`
];

const HIGH_DANCE_TEMPLATES = [
  () => `Grounded in an effortless groove with an infectious rhythm, they create a magnetic pull that makes it almost impossible to sit still.`,
  () => `Featuring a highly danceable rhythm and fluid, physical grooves, their music carries a natural movement that keeps your body locked in.`,
  () => `Their tracks are built upon an irresistible rhythmic bounce, weaving tight syncopation and basslines that instantly move you.`
];

const HIGH_VALENCE_TEMPLATES = [
  () => `Their bright, sun-drenched emotional frequencies radiate warm, uplifting vibes that will immediately lift your spirits.`,
  () => `Filled with joyous major keys and bright harmonic layers, they craft an optimistic, feel-good atmosphere that spreads pure sonic sunshine.`,
  () => `Their songwriting captures a sparkling, euphoric essence, offering an instant dose of positivity and heartwarming energy.`
];

const LOW_VALENCE_TEMPLATES = [
  () => `Their dark, melancholic undertones bring a deep, cinematic moodiness and emotional gravity that is intensely beautiful.`,
  () => `They masterfully explore somber minor keys, constructing a hauntingly beautiful emotional depth that lingers long after the track ends.`,
  () => `There is a profound, cinematic sadness and introspective gravity to their writing, creating an immersive space for emotional reflection.`
];

const BALANCED_VALENCE_TEMPLATES = [
  () => `Their versatile emotional scale allows their sound to shift seamlessly between bright optimism and deep, reflective moodiness.`,
  () => `They navigate complex emotional shades, blending bittersweet melodies that carry both a touch of nostalgia and a glimmer of hope.`,
  () => `Their emotional signature is beautifully balanced, refusing to settle on simple happy or sad notes, opting instead for mature, nuanced storytelling.`
];

function ConnectedArtistRow({ artist }: { artist: OrcaNode }) {
  const [imageUrl, setImageUrl] = useState(artist.imageUrl || '');
  const [hovered, setHovered] = useState(false);
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
    } else {
      setImageUrl(artist.imageUrl);
    }
  }, [artist.imageUrl, artist.name]);

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
        {displayImgUrl ? (
          <img src={displayImgUrl} width={26} height={26} style={{ borderRadius: '50%', objectFit: 'cover' }} alt={artist.name} />
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

export function OrcaHUD() {
  const { data: session } = useSession();
  const username = session?.user?.name || 'My';
  const tasteSummary = useOrcaStore(s => (s as any).tasteSummary || '');

  const graph = useOrcaStore(s => s.graph);
  const isExpanding = useOrcaStore(s => s.isExpanding);
  const pinnedNodeId = useOrcaStore(s => s.pinnedNodeId);
  const frontierPanelOpen = useOrcaStore(s => s.frontierPanelOpen);
  const setFrontierPanelOpen = useOrcaStore(s => s.setFrontierPanelOpen);
  const setFocusedNode = useOrcaStore(s => s.setFocusedNode);
  const setPinnedNode = useOrcaStore(s => s.setPinnedNode);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const [exploreStatus, setExploreStatus] = useState<'idle' | 'adding' | 'done'>('idle');
  const transitionNodeToExplored = useOrcaStore(s => s.transitionNodeToExplored);
  const revertNodeTransition = useOrcaStore(s => s.revertNodeTransition);

  async function handleExploreFrontier(node: any, action: 'add-to-spotify' | 'mark-explored') {
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
      const res = await fetch(`/api/user/explore${search}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artistId: node.id, action }),
      });

      if (!res.ok) throw new Error('API exploration failed');

      setExploreStatus('done');
    } catch (err) {
      console.error('[HUD Explore] Exploration failed, reverting:', err);
      revertNodeTransition(node.id);
      setExploreStatus('idle');
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

  // Resolve pinned artist image instantly
  const [pinnedImageUrl, setPinnedImageUrl] = useState('');

  useEffect(() => {
    if (!pinnedNode) {
      setPinnedImageUrl('');
      return;
    }

    // 1. Graph Node Cached URL (Instant, local resolution)
    if (pinnedNode.imageUrl) {
      const proxiedUrl = pinnedNode.imageUrl.startsWith('/api/') || pinnedNode.imageUrl.startsWith('data:')
        ? pinnedNode.imageUrl
        : `/api/orca/image-proxy?url=${encodeURIComponent(pinnedNode.imageUrl)}`;
      setPinnedImageUrl(proxiedUrl);
      return;
    }

    // 2. Image Layer Cache hit
    const cached = getCachedArtistData(pinnedNode.name);
    if (cached && cached.status === 'loaded' && cached.imageUrl) {
      setPinnedImageUrl(cached.imageUrl);
      return;
    }

    // 3. Next.js server route fetch with cancellation support
    let cancelled = false;
    fetch(`/api/orca/image?artist=${encodeURIComponent(pinnedNode.name)}`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        if (data.imageUrl) {
          setPinnedImageUrl(data.imageUrl);
          pinnedNode.imageUrl = data.imageUrl; // save on node
        } else {
          setPinnedImageUrl('');
        }
      })
      .catch(() => {
        if (!cancelled) setPinnedImageUrl('');
      });

    return () => {
      cancelled = true;
    };
  }, [pinnedNode]);

  // Resolve rich details for the pinned artist
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

  useEffect(() => {
    if (!pinnedNode) {
      setDetails(null);
      setDetailsLoading(false);
      return;
    }

    // Reset panel offset position and all show-more/accordion toggles whenever a new node is selected
    setPanelPos({ x: 0, y: 0 });
    setShowAbout(false);
    setShowAllAlbums(false);
    setShowAllTracks(false);

    setDetailsLoading(true);
    let cancelled = false;

    fetch(`/api/orca/artist-details?artist=${encodeURIComponent(pinnedNode.name)}&id=${encodeURIComponent(pinnedNode.id)}`)
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

  // Draggable coordinate positioning mechanics
  const [panelPos, setPanelPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const panelStart = useRef({ x: 0, y: 0 });

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

  // Mood definitions mapped to emotional vocabulary
  const MOOD_DEFINITIONS = [
    {
      label: 'late-night melancholy',
      condition: (f: AudioSignature) =>
        f.valence < 0.35 && f.energy < 0.50 && f.acousticness > 0.25,
    },
    {
      label: 'euphoric rush',
      condition: (f: AudioSignature) =>
        f.valence > 0.70 && f.energy > 0.75,
    },
    {
      label: 'morning clarity',
      condition: (f: AudioSignature) =>
        f.valence > 0.55 && f.energy > 0.40 && f.energy < 0.75 && f.acousticness > 0.35,
    },
    {
      label: 'restless energy',
      condition: (f: AudioSignature) =>
        f.energy > 0.75 && f.valence > 0.35 && f.valence < 0.70,
    },
    {
      label: 'tender introspection',
      condition: (f: AudioSignature) =>
        f.valence > 0.30 && f.valence < 0.65 && f.energy < 0.45 && f.acousticness > 0.45,
    },
    {
      label: 'triumphant arrival',
      condition: (f: AudioSignature) =>
        f.valence > 0.70 && f.energy > 0.55 && f.energy < 0.80,
    },
    {
      label: 'floating dissociation',
      condition: (f: AudioSignature) =>
        f.instrumentalness > 0.50 && f.energy < 0.35,
    },
    {
      label: 'defiant noise',
      condition: (f: AudioSignature) =>
        f.energy > 0.80 && f.valence < 0.45,
    },
    {
      label: 'sun-drenched warmth',
      condition: (f: AudioSignature) =>
        f.valence > 0.70 && f.acousticness > 0.35 && f.energy < 0.70,
    },
    {
      label: 'underground pulse',
      condition: (f: AudioSignature) =>
        f.danceability > 0.70 && f.energy > 0.60 && f.valence < 0.60,
    },
    {
      label: 'nostalgic ache',
      condition: (f: AudioSignature) =>
        f.valence < 0.50 && f.tempo < 95,
    },
    {
      label: 'sacred stillness',
      condition: (f: AudioSignature) =>
        f.instrumentalness > 0.40 && f.energy < 0.25,
    },
  ];

  const getMoodLabel = (audioSignature?: AudioSignature): string => {
    if (!audioSignature) return 'varied energy';
    const match = MOOD_DEFINITIONS.find(def => def.condition(audioSignature));
    return match?.label ?? 'varied energy';
  };

  const getListenContext = (listenWeight: number): string => {
    if (listenWeight > 0.85) return 'A defining part of your universe';
    if (listenWeight > 0.70) return 'Deeply woven into your taste';
    if (listenWeight > 0.55) return 'A significant presence in your listening';
    if (listenWeight > 0.40) return 'Regularly returned to';
    if (listenWeight > 0.25) return 'Part of your wider world';
    if (listenWeight > 0.10) return 'An occasional companion';
    return 'On the edges of your universe';
  };

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
          transform: `translate(${panelPos.x}px, ${panelPos.y}px)`,
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

            {/* Scrollable contents */}
            <div className="orca-artist-panel-scroll">
              
              {/* Header: Banner with profile image and details (Draggable handle area) */}
              <div 
                className="orca-artist-header orca-artist-drag-handle"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
              >
                <div className="orca-artist-banner-wrap">
                  {pinnedImageUrl ? (
                    <img 
                      src={pinnedImageUrl} 
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
                  {/* Country — only if known */}
                  {(pinnedNode as any).country && (
                    <div style={{
                      fontSize: '12px',
                      color: 'rgba(0,0,0,0.38)',
                      marginTop: '4px',
                    }}>
                      {(pinnedNode as any).country}
                    </div>
                  )}
                </div>
              </div>

              {/* Frontier Details Section */}
              {pinnedNode.state === 'frontier' && (
                <div className="orca-frontier-details" style={{
                  background: 'rgba(29, 185, 84, 0.08)',
                  border: '1px solid rgba(29, 185, 84, 0.15)',
                  borderRadius: '12px',
                  padding: '14px',
                  marginBottom: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px'
                }}>
                  <div style={{
                    fontSize: '11px',
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

                  <div style={{ fontSize: '13px', color: 'rgba(0,0,0,0.55)', lineHeight: '1.4', whiteSpace: 'normal' }}>
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
                          `Multiple threads tie ${pinnedNode.name} to your existing world. This is a high-confidence recommendation.`,
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
                        padding: '10px 0',
                        fontSize: '12.5px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        transition: 'opacity 0.2s',
                        fontFamily: "'Inter', sans-serif"
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.9'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                    >
                      {exploreStatus === 'adding' ? 'Exploring…' : exploreStatus === 'done' ? 'Explored!' : 'Explore Artist'}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleExploreFrontier(pinnedNode, 'mark-explored')}
                      disabled={exploreStatus !== 'idle'}
                      style={{
                        flex: 0.8,
                        background: 'rgba(0,0,0,0.06)',
                        color: 'rgba(0,0,0,0.7)',
                        border: 'none',
                        borderRadius: '100px',
                        padding: '10px 0',
                        fontSize: '12.5px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        transition: 'background 0.2s, color 0.2s',
                        fontFamily: "'Inter', sans-serif"
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.1)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.06)'; }}
                    >
                      I know this
                    </button>
                  </div>
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
                          {album.imageUrl ? (
                            <img src={album.imageUrl} alt={album.name} className="orca-album-art" />
                          ) : (
                            <div 
                              className="orca-album-art-placeholder"
                              style={{ background: `${getGenreColor((pinnedNode.genres[0] || '').toLowerCase())}35` }}
                            >
                              {album.name.charAt(0)}
                            </div>
                          )}
                          <div className="orca-album-info">
                            <span className="orca-album-name">{album.name}</span>
                            <span className="orca-album-popularity">
                              {album.playcount 
                                ? (album.playcount < 2100 
                                  ? `Album · ${album.playcount}` 
                                  : `Album · ${album.playcount.toLocaleString()} plays`) 
                                : 'Primary release'}
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
                              {track.playcount && (
                                <span style={{ fontSize: '9.5px', color: 'rgba(0, 0, 0, 0.42)' }}>
                                  {track.playcount.toLocaleString()} plays
                                </span>
                              )}
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
      {tasteSummary && (
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
          {tasteSummary}
        </div>
      )}

      {/* Phase 2 Widgets */}

      <FrontierPanel onClose={() => setFrontierPanelOpen(false)} />

      {/* Frontier Toggle Button — bottom right */}
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
            borderRadius: '20px',
            boxShadow: '0 30px 60px rgba(0, 0, 0, 0.15), 0 4px 15px rgba(0, 0, 0, 0.05)',
            padding: '32px',
            maxWidth: '460px',
            width: '90%',
            color: '#111118',
            position: 'relative',
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif",
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
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
                By analyzing your listening habits and highlighting unexplored areas of music, ORCA encourages discovery beyond the recommendations, playlists, and algorithmic loops that dominate modern streaming platforms.
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
                ORCA is designed to help listeners move beyond algorithmic comfort zones and discover music they wouldn't normally encounter. The goal isn't more recommendations—it's meaningful musical exploration.
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
    </>
  );
}

