'use client';

import { signIn, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { BackgroundGradientAnimation } from '@/components/ui/background-gradient-animation';

export default function ConnectPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'authenticated') {
      router.replace('/globe');
    }
  }, [status, router]);

  if (status === 'loading') {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'Inter', sans-serif",
        position: 'relative',
        width: '100vw',
      }}>
        <BackgroundGradientAnimation interactive={false} />
        {/* Crisp minimal loader */}
        <div style={{
          width: 24,
          height: 24,
          border: '2px solid rgba(0,0,0,0.06)',
          borderTopColor: '#000000',
          borderRadius: '50%',
          animation: 'connectSpin 0.8s linear infinite',
        }} />
        <style>{`
          @keyframes connectSpin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      WebkitFontSmoothing: 'antialiased',
      overflow: 'hidden',
      position: 'relative',
      width: '100vw',
    }}>
      <BackgroundGradientAnimation interactive={false} />
      <div style={{
        textAlign: 'center',
        maxWidth: 400,
        width: '100%',
        padding: '40px 24px',
        background: 'rgba(255, 255, 255, 0.45)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255, 255, 255, 0.5)',
        borderRadius: 24,
        boxShadow: '0 20px 50px rgba(0, 0, 0, 0.04), 0 1px 3px rgba(0, 0, 0, 0.02)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}>
        {/* Logo */}
        <img
          src="/ORCA_logo.png"
          alt="ORCA Logo"
          style={{
            width: 140,
            height: 140,
            marginBottom: 16,
            objectFit: 'contain',
            mixBlendMode: 'multiply',
          }}
        />

        {/* Wordmark */}
        <h1 style={{
          fontSize: 22,
          fontWeight: 600,
          color: '#111118',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          margin: '0 0 8px 0',
        }}>
          ORCA
        </h1>

        {/* Value proposition */}
        <p style={{
          fontSize: 14,
          color: 'rgba(0,0,0,0.50)',
          lineHeight: 1.6,
          margin: '0 0 36px 0',
          fontWeight: 400,
          maxWidth: 280,
        }}>
          Go beyond your algorithm
        </p>

        {/* Connect button */}
        <button
          onClick={() => signIn('spotify', { callbackUrl: '/globe' })}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            background: '#000000',
            color: '#ffffff',
            border: 'none',
            borderRadius: 100,
            padding: '16px 36px',
            fontSize: 14,
            fontWeight: 500,
            cursor: 'pointer',
            letterSpacing: '0.01em',
            boxShadow: '0 10px 24px rgba(0,0,0,0.12), 0 2px 4px rgba(0,0,0,0.06)',
            transition: 'transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), background 0.2s ease',
            width: '100%',
            maxWidth: 248,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'scale(1.02)';
            e.currentTarget.style.background = '#111118';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.background = '#000000';
          }}
        >
          {/* Spotify logo SVG */}
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="currentColor"
            style={{ color: '#1DB954' }}
          >
            <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424c-.18.295-.563.387-.857.207-2.377-1.454-5.37-1.782-8.892-1.025-.336.073-.668-.14-.74-.474-.072-.333.14-.665.473-.737 3.843-.877 7.135-.5 9.81 1.136.294.18.386.563.206.857s-.564.386-.857.207zm1.226-2.724c-.226.367-.707.487-1.074.26-2.72-1.67-6.87-2.155-10.076-1.182-.413.125-.845-.107-.97-.52-.125-.413.107-.845.52-.97 3.666-1.112 8.232-.572 11.34 1.343.367.227.488.708.26 1.07zm.106-2.825C14.492 8.78 8.742 8.59 5.395 9.607c-.512.155-1.054-.136-1.21-.648-.156-.512.136-1.054.648-1.21 3.844-1.167 10.19-.948 14.28 1.48.46.273.61.87.337 1.33-.273.46-.87.61-1.33.337z"/>
          </svg>
          Connect Spotify
        </button>

        {/* Explore Demo Globe button */}
        <button
          onClick={() => router.push('/globe/select')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            background: 'transparent',
            color: '#111118',
            border: '1.5px solid rgba(17, 17, 24, 0.15)',
            borderRadius: 100,
            padding: '14px 36px',
            fontSize: 14,
            fontWeight: 500,
            cursor: 'pointer',
            letterSpacing: '0.01em',
            marginTop: 12,
            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            width: '100%',
            maxWidth: 248,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'scale(1.02)';
            e.currentTarget.style.background = 'rgba(17, 17, 24, 0.04)';
            e.currentTarget.style.borderColor = 'rgba(17, 17, 24, 0.35)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.borderColor = 'rgba(17, 17, 24, 0.15)';
          }}
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ color: '#0ea5e9' }}
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
          Explore Demo Globe
        </button>

        {/* Trust signal */}
        <p style={{
          fontSize: 11,
          color: 'rgba(0,0,0,0.25)',
          marginTop: 24,
          lineHeight: 1.5,
        }}>
          Read-only access. We never modify your library or playlists.
        </p>

        {/* Pre-Alpha Warning Notice */}
        <div style={{
          marginTop: 24,
          padding: '12px 16px',
          background: 'rgba(245, 158, 11, 0.08)',
          border: '1px solid rgba(245, 158, 11, 0.2)',
          borderRadius: 12,
          fontSize: '11px',
          color: 'rgba(120, 53, 4, 0.75)',
          lineHeight: '1.45',
          maxWidth: 320,
          textAlign: 'left',
        }}>
          <span style={{ fontWeight: 700, color: '#d97706', display: 'block', marginBottom: '4px' }}>
            ⚠️ Pre-Alpha Warning:
          </span>
          The app is currently in pre-alpha testing, so Spotify login will only work if your account has been whitelisted. Please use the <b>Explore Demo Globe</b> option to test the app!
        </div>
      </div>
    </div>
  );
}
