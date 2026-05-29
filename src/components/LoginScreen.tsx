'use client';

/**
 * LoginScreen — premium Spotify authentication screen.
 * Displayed when the user is not authenticated.
 */
import { signIn } from 'next-auth/react';
import { useEffect, useState } from 'react';

const LOOPBACK_ORIGIN = 'http://127.0.0.1:3000';

export function LoginScreen() {
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    if (window.location.hostname === 'localhost') {
      window.location.replace(`${LOOPBACK_ORIGIN}${window.location.pathname}${window.location.search}`);
    }
  }, []);

  async function connectSpotify() {
    setIsConnecting(true);
    await signIn('spotify', {
      callbackUrl: `${LOOPBACK_ORIGIN}/`,
      redirect: true,
    });
  }

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      background: 'radial-gradient(ellipse at 50% 40%, #ffffff 0%, #F7F7F5 60%, #ECEDE8 100%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      {/* Title */}
      <h1 style={{
        fontSize: '24px',
        fontWeight: 300,
        letterSpacing: '0.15em',
        textTransform: 'uppercase' as const,
        color: '#333',
        margin: 0,
      }}>
        ORCA
      </h1>

      {/* Subtitle */}
      <p style={{
        fontSize: '14px',
        fontWeight: 400,
        color: '#888',
        marginTop: '8px',
        letterSpacing: '0.03em',
      }}>
        Your musical identity, visualized
      </p>

      {/* Decorative line */}
      <div style={{
        width: '60px',
        height: '1px',
        background: 'rgba(0, 0, 0, 0.1)',
        marginTop: '32px',
      }} />

      {/* Connect Button */}
      <button
        disabled={isConnecting}
        onClick={connectSpotify}
        style={{
          marginTop: '32px',
          background: '#1DB954',
          color: '#fff',
          fontFamily: "'Inter', system-ui, sans-serif",
          fontSize: '13px',
          fontWeight: 500,
          padding: '12px 32px',
          borderRadius: '24px',
          border: 'none',
          cursor: isConnecting ? 'wait' : 'pointer',
          letterSpacing: '0.05em',
          transition: 'transform 0.2s ease, box-shadow 0.2s ease',
          opacity: isConnecting ? 0.72 : 1,
        }}
        onMouseEnter={e => {
          (e.target as HTMLButtonElement).style.transform = 'scale(1.03)';
          (e.target as HTMLButtonElement).style.boxShadow = '0 4px 20px rgba(29, 185, 84, 0.3)';
        }}
        onMouseLeave={e => {
          (e.target as HTMLButtonElement).style.transform = 'scale(1)';
          (e.target as HTMLButtonElement).style.boxShadow = 'none';
        }}
      >
        {isConnecting ? 'Connecting...' : 'Connect with Spotify'}
      </button>

      {/* Footer */}
      <p style={{
        position: 'absolute',
        bottom: '32px',
        fontSize: '11px',
        color: 'rgba(0, 0, 0, 0.25)',
        letterSpacing: '0.04em',
      }}>
        Your data stays private. We never store your music.
      </p>
    </div>
  );
}
