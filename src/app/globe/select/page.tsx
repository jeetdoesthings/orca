'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { BackgroundGradientAnimation } from '@/components/ui/background-gradient-animation';

interface Artist {
  id: string;
  name: string;
  genres: string[];
  popularity: number;
  imageUrl: string;
}

const PREDEFINED_GENRES = [
  'All',
  'Hip-hop',
  'Pop',
  'Rock',
  'Electronic',
  'Ambient',
  'Classical',
  'Soul',
  'R&B',
  'Latin',
];

const LOADING_MESSAGES = [
  'Following hidden currents...',
  'Listening between genres...',
  'Exploring beyond the familiar...',
  'Finding unexpected connections...',
  'Reading the musical tides...',
  'Tracing musical pathways...',
  'Listening for signals...',
  'Looking beyond your horizon...',
  'Following echoes...',
  'Discovering what resonates...',
  'Diving deeper...',
  'Navigating open waters...',
  'Searching distant waters...',
  'Listening beneath the surface...',
  'Following unseen routes...',
  'Exploring deeper oceans...',
  'Looking closer...',
  'Expanding the map...',
  'Connecting the dots...',
  'Discovering more...',
  'Following patterns...',
  'Finding pathways...',
  'Going deeper...',
  'Mapping connections...',
  'Uncovering signals...',
  'Venturing into uncharted sound...',
  'Finding what comes next...',
  'Tracking hidden influences...',
  'Searching deeper frequencies...',
  'Discovering unfamiliar waters...',
  'Charting your next discovery...',
  'Connecting distant sounds...',
  'Reading the currents...',
  'Listening to the deep...',
  'Exploring new waters...',
  'Following the music...',
  'Discovering hidden pathways...',
  'Finding new horizons...',
  'Looking beyond familiar sounds...',
  'Tracing hidden connections...'
];

/** Artist avatar with proxy + multi-provider name fallback when URL fails. */
function ArtistAvatar({ name, imageUrl }: { name: string; imageUrl: string }) {
  const [src, setSrc] = useState<string | null>(() => {
    if (!imageUrl) return null;
    if (imageUrl.startsWith('/api/')) return imageUrl;
    return `/api/orca/image-proxy?url=${encodeURIComponent(imageUrl)}&demo=true`;
  });
  const [triedResolve, setTriedResolve] = useState(false);

  useEffect(() => {
    if (!imageUrl) {
      // No stored URL — resolve by name once
      let cancelled = false;
      fetch(`/api/orca/image?artist=${encodeURIComponent(name)}&demo=true`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!cancelled && data?.imageUrl) setSrc(data.imageUrl);
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }
    setSrc(
      imageUrl.startsWith('/api/')
        ? imageUrl
        : `/api/orca/image-proxy?url=${encodeURIComponent(imageUrl)}&demo=true`,
    );
    setTriedResolve(false);
  }, [name, imageUrl]);

  if (!src) {
    return (
      <span style={{ fontSize: 24, fontWeight: 600, color: 'rgba(0,0,0,0.3)' }}>
        {name.charAt(0)}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={name}
      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      onError={() => {
        if (triedResolve) {
          setSrc(null);
          return;
        }
        setTriedResolve(true);
        // Multi-provider resolve (Spotify/Deezer/Wiki/MB)
        fetch(`/api/orca/image?artist=${encodeURIComponent(name)}&demo=true`)
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (data?.imageUrl) setSrc(data.imageUrl);
            else setSrc(null);
          })
          .catch(() => setSrc(null));
      }}
    />
  );
}

function RotatingLoadingMessage() {
  const [msgIndex, setMsgIndex] = useState(0);
  const [fade, setFade] = useState('in'); // 'in' | 'out'

  useEffect(() => {
    setMsgIndex(Math.floor(Math.random() * LOADING_MESSAGES.length));

    const interval = setInterval(() => {
      setFade('out');
      setTimeout(() => {
        setMsgIndex((prev) => {
          let next;
          do {
            next = Math.floor(Math.random() * LOADING_MESSAGES.length);
          } while (next === prev);
          return next;
        });
        setFade('in');
      }, 500);
    }, 3800);

    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{
      fontSize: '14px',
      fontWeight: 500,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      color: 'rgba(0, 0, 0, 0.4)',
      opacity: fade === 'in' ? 1 : 0,
      transition: 'opacity 350ms cubic-bezier(0.4, 0, 0.2, 1)',
      textAlign: 'center',
    }}>
      {LOADING_MESSAGES[msgIndex]}
    </div>
  );
}

export default function SelectArtistsPage() {
  const router = useRouter();
  const [artists, setArtists] = useState<Artist[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedGenre, setSelectedGenre] = useState('All');
  const [selectedArtists, setSelectedArtists] = useState<string[]>([]);
  const [isBuilding, setIsBuilding] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Fetch all artists on mount
  useEffect(() => {
    async function fetchArtists() {
      try {
        const res = await fetch('/api/artists?demo=true');
        if (!res.ok) throw new Error('Failed to load artists');
        const data = await res.json();
        // Defensive dedupe (audit): the catalog may contain legacy duplicate
        // rows for the same artist (lastfm-* vs spotify-id vs MBID). Keep the
        // row with the most data, one per normalized name.
        const byKey = new Map<string, Artist>();
        for (const a of data as Artist[]) {
          const key = (a.name || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]/g, '');
          if (!key) continue;
          const prev = byKey.get(key);
          const score = (x: Artist) =>
            (x.imageUrl ? 1 : 0) + (x.genres?.length || 0) * 0.1 + (x.popularity || 0) / 1000;
          if (!prev || score(a) > score(prev)) byKey.set(key, a);
        }
        setArtists(Array.from(byKey.values()));
      } catch (err: any) {
        console.error(err);
        setErrorMessage('Failed to fetch artists. Please reload the page.');
      } finally {
        setLoading(false);
      }
    }
    fetchArtists();
  }, []);

  // Filtered artists based on search and genre tag
  const filteredArtists = useMemo(() => {
    return artists.filter((artist) => {
      const matchesSearch = artist.name.toLowerCase().includes(search.toLowerCase()) ||
        artist.genres.some((g) => g.toLowerCase().includes(search.toLowerCase()));

      if (selectedGenre === 'All') {
        return matchesSearch;
      }
      
      const matchesGenre = artist.genres.some(
        (g) => g.toLowerCase().includes(selectedGenre.toLowerCase())
      );
      return matchesSearch && matchesGenre;
    });
  }, [artists, search, selectedGenre]);

  const handleToggleArtist = (artistId: string) => {
    setSelectedArtists((prev) => {
      if (prev.includes(artistId)) {
        return prev.filter((id) => id !== artistId);
      }
      if (prev.length >= 20) {
        return prev; // Maximum 20
      }
      return [...prev, artistId];
    });
  };

  const handleBuildGlobe = async () => {
    if (selectedArtists.length < 5 || selectedArtists.length > 20) return;

    setIsBuilding(true);
    setErrorMessage('');

    try {
      const res = await fetch('/api/user/sync-demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artistIds: selectedArtists }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to sync demo globe');
      }

      // Add a slight artificial delay to make the premium build sequence visible
      await new Promise((resolve) => setTimeout(resolve, 8000));
      router.push('/globe?demo=true');
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || 'Failed to build globe. Please try again.');
      setIsBuilding(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      width: '100vw',
      position: 'relative',
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      color: '#111118',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <BackgroundGradientAnimation interactive={false} />

      {/* Header */}
      <header style={{
        position: 'sticky',
        top: 0,
        zIndex: 40,
        background: 'rgba(255, 255, 255, 0.45)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.5)',
        padding: '16px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src="/ORCA_logo.png" alt="Logo" style={{ width: 36, height: 36, mixBlendMode: 'multiply' }} />
          <div>
            <h1 style={{ fontSize: 16, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>ORCA</h1>
            <p style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)' }}>Personalized Demo Setup</p>
          </div>
        </div>
        <button
          onClick={() => router.push('/auth/connect')}
          style={{
            background: 'transparent',
            border: 'none',
            fontSize: 13,
            color: 'rgba(0,0,0,0.6)',
            cursor: 'pointer',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          ← Back
        </button>
      </header>

      {/* Main body content */}
      <main style={{
        flex: 1,
        overflowY: 'auto',
        padding: '24px 24px 120px 24px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        position: 'relative',
        zIndex: 10,
        maxHeight: 'calc(100vh - 69px)',
      }}>
        <div style={{ maxWidth: 1200, width: '100%', display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Headline */}
          <div style={{ textAlign: 'center', maxWidth: 600, alignSelf: 'center', margin: '16px 0' }}>
            <h2 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 8 }}>
              Choose your sound
            </h2>
            <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.55)', lineHeight: 1.5 }}>
              Select between <b>5 and 20</b> of your favorite artists below. We will build a personalized interactive taste universe mapping their genres, attributes, and coordinates on the ORCA globe.
            </p>
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div style={{
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              borderRadius: 12,
              padding: '12px 16px',
              color: '#dc2626',
              fontSize: 14,
              textAlign: 'center',
              alignSelf: 'center',
              maxWidth: 500,
              width: '100%',
            }}>
              {errorMessage}
            </div>
          )}

          {/* Filters Panel */}
          <div style={{
            background: 'rgba(255, 255, 255, 0.5)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(255, 255, 255, 0.6)',
            borderRadius: 16,
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            boxShadow: '0 4px 30px rgba(0,0,0,0.01)',
          }}>
            {/* Search */}
            <div style={{ position: 'relative', width: '100%' }}>
              <input
                type="text"
                placeholder="Search artists or genres..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px 16px 12px 42px',
                  borderRadius: 12,
                  border: '1px solid rgba(0,0,0,0.1)',
                  background: 'rgba(255, 255, 255, 0.8)',
                  fontSize: 14,
                  outline: 'none',
                  transition: 'border-color 0.2s',
                }}
                onFocus={(e) => e.target.style.borderColor = 'rgba(0,0,0,0.25)'}
                onBlur={(e) => e.target.style.borderColor = 'rgba(0,0,0,0.1)'}
              />
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                stroke="currentColor"
                strokeWidth="2.5"
                fill="none"
                style={{
                  position: 'absolute',
                  left: 16,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'rgba(0,0,0,0.4)',
                }}
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>

            {/* Genre tags selection */}
            <div style={{
              display: 'flex',
              gap: 8,
              overflowX: 'auto',
              paddingBottom: 4,
              scrollbarWidth: 'none',
            }}>
              {PREDEFINED_GENRES.map((genre) => {
                const isActive = selectedGenre === genre;
                return (
                  <button
                    key={genre}
                    onClick={() => setSelectedGenre(genre)}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 100,
                      border: 'none',
                      background: isActive ? '#111118' : 'rgba(255, 255, 255, 0.7)',
                      color: isActive ? '#ffffff' : 'rgba(0,0,0,0.7)',
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      transition: 'all 0.2s',
                    }}
                  >
                    {genre}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Grid of artists */}
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
              <div style={{
                width: 32,
                height: 32,
                border: '3px solid rgba(0,0,0,0.06)',
                borderTopColor: '#111118',
                borderRadius: '50%',
                animation: 'selectSpin 0.8s linear infinite',
              }} />
              <style>{`
                @keyframes selectSpin {
                  to { transform: rotate(360deg); }
                }
              `}</style>
            </div>
          ) : filteredArtists.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: 'rgba(0,0,0,0.45)' }}>
              No artists found matching your search.
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 16,
              width: '100%',
            }}>
              {filteredArtists.map((artist) => {
                const isSelected = selectedArtists.includes(artist.id);
                return (
                  <div
                    key={artist.id}
                    onClick={() => handleToggleArtist(artist.id)}
                    style={{
                      background: isSelected ? 'rgba(255, 255, 255, 0.85)' : 'rgba(255, 255, 255, 0.45)',
                      backdropFilter: 'blur(8px)',
                      border: isSelected ? '2px solid #0ea5e9' : '1px solid rgba(255, 255, 255, 0.5)',
                      borderRadius: 16,
                      padding: 12,
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 12,
                      textAlign: 'center',
                      transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                      boxShadow: isSelected ? '0 10px 20px rgba(14, 165, 233, 0.1)' : '0 4px 6px rgba(0,0,0,0.01)',
                      transform: isSelected ? 'scale(1.02)' : 'none',
                    }}
                  >
                    {/* Image */}
                    <div style={{
                      width: 90,
                      height: 90,
                      borderRadius: '50%',
                      overflow: 'hidden',
                      background: 'rgba(0,0,0,0.05)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      position: 'relative',
                      border: '1px solid rgba(0,0,0,0.04)',
                    }}>
                      <ArtistAvatar name={artist.name} imageUrl={artist.imageUrl || ''} />
                      
                      {/* Selected checkmark */}
                      {isSelected && (
                        <div style={{
                          position: 'absolute',
                          inset: 0,
                          background: 'rgba(14, 165, 233, 0.25)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                          <div style={{
                            background: '#0ea5e9',
                            borderRadius: '50%',
                            padding: 4,
                            color: '#ffffff',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                            display: 'flex',
                          }}>
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="3">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Meta info */}
                    <div style={{ width: '100%' }}>
                      <h4 style={{
                        fontSize: 14,
                        fontWeight: 600,
                        margin: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>{artist.name}</h4>
                      <p style={{
                        fontSize: 10,
                        color: 'rgba(0,0,0,0.4)',
                        textTransform: 'capitalize',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        marginTop: 4,
                      }}>
                        {artist.genres[0] || 'alternative'}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* Floating Action Panel */}
      <footer style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 50,
        width: 'calc(100% - 48px)',
        maxWidth: 800,
        background: 'rgba(255, 255, 255, 0.65)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '1.5px solid rgba(255, 255, 255, 0.75)',
        borderRadius: 24,
        padding: '16px 24px',
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0,0,0,0.02)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
      }}>
        <div>
          <h5 style={{ fontSize: 14, fontWeight: 600 }}>
            {selectedArtists.length < 5
              ? `Select ${5 - selectedArtists.length} more artist${selectedArtists.length === 4 ? '' : 's'}`
              : selectedArtists.length === 20
              ? 'Max selected'
              : 'Sound profile ready'}
          </h5>
          <p style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginTop: 2 }}>
            Selected: {selectedArtists.length} / 20 (min 5, max 20)
          </p>
        </div>

        <button
          onClick={handleBuildGlobe}
          disabled={selectedArtists.length < 5}
          style={{
            background: selectedArtists.length < 5 ? 'rgba(0,0,0,0.04)' : '#111118',
            color: selectedArtists.length < 5 ? 'rgba(0,0,0,0.3)' : '#ffffff',
            border: 'none',
            borderRadius: 100,
            padding: '12px 28px',
            fontSize: 14,
            fontWeight: 500,
            cursor: selectedArtists.length < 5 ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s',
            boxShadow: selectedArtists.length < 5 ? 'none' : '0 8px 16px rgba(0,0,0,0.1)',
          }}
        >
          Build Globe
        </button>
      </footer>

      {/* Building Loader Screen Overlay */}
      {isBuilding && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'radial-gradient(ellipse at 50% 40%, #ffffff 0%, #F7F7F5 60%, #ECEDE8 100%)',
          zIndex: 100,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 24,
          fontFamily: "'Inter', system-ui, sans-serif",
        }}>
          <RotatingLoadingMessage />
          <div style={{
            width: '100px',
            height: '1px',
            background: 'rgba(0, 0, 0, 0.06)',
            borderRadius: '1px',
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              background: 'rgba(0, 0, 0, 0.3)',
              animation: 'loadingBar 1.8s ease-in-out infinite',
            }} />
          </div>
          <style>{`
            @keyframes loadingBar {
              0% { width: 0%; margin-left: 0%; }
              50% { width: 50%; margin-left: 25%; }
              100% { width: 0%; margin-left: 100%; }
            }
          `}</style>
        </div>
      )}
    </div>
  );
}
