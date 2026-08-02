import NextAuth, { type AuthOptions } from 'next-auth';
import SpotifyProvider from 'next-auth/providers/spotify';
import { PrismaAdapter } from '@next-auth/prisma-adapter';
import { prisma } from '@/lib/prisma';

const SPOTIFY_SCOPES = [
  'user-top-read',
  'user-read-recently-played',
  'user-library-read',
  'user-read-private',
].join(' ');

interface RefreshResult {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

/**
 * Audit fix M7: dedupe Spotify token refresh. The jwt callback runs on every
 * request past expiry; without this, N concurrent requests each issued their
 * own refresh call. In-flight refreshes are shared per refresh token.
 */
const refreshInFlight = new Map<string, Promise<RefreshResult>>();

async function refreshSpotifyToken(refreshToken: string): Promise<RefreshResult> {
  const existing = refreshInFlight.get(refreshToken);
  if (existing) return existing;

  const p = (async () => {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(
          `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`,
        ).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    const refreshed = await response.json();
    if (!response.ok) throw refreshed;

    return {
      accessToken: refreshed.access_token as string,
      refreshToken: refreshed.refresh_token as string | undefined,
      expiresAt: Date.now() + refreshed.expires_in * 1000,
    };
  })();

  refreshInFlight.set(refreshToken, p);
  p.finally(() => refreshInFlight.delete(refreshToken)).catch(() => {
    /* rejection is delivered to the awaiting callers */
  });
  return p;
}

/**
 * Audit fix (Vercel build): env values are read lazily, at request time, never
 * at module scope. `next build` runs with NODE_ENV=production; the old module
 * scope `throw` failed the build whenever secrets weren't present at build
 * time (e.g. runtime-only env on Vercel). Missing secrets still fail loudly on
 * first request so a misconfigured deploy can't silently run with a weak secret.
 */
function missingEnv(name: string): string {
  // During `next build` (Vercel sets NEXT_PHASE=phase-production-build),
  // return a placeholder so page-data collection never fails for runtime-only
  // secrets. At request time this getter path is never used: missing secrets
  // throw below, so a misconfigured runtime still fails loudly.
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return `__missing_${name}__`;
  }
  throw new Error(`${name} must be set in production!`);
}

export const authOptions: AuthOptions = {
  get secret() {
    return (
      process.env.NEXTAUTH_SECRET ||
      (process.env.NODE_ENV === 'production'
        ? missingEnv('NEXTAUTH_SECRET')
        : 'fallback-secret-for-pre-alpha-testing-1234567890')
    );
  },
  adapter: PrismaAdapter(prisma),
  get providers() {
    return [
      SpotifyProvider({
        clientId:
          process.env.SPOTIFY_CLIENT_ID ||
          (process.env.NODE_ENV === 'production'
            ? missingEnv('SPOTIFY_CLIENT_ID')
            : 'dummy-spotify-client-id'),
        clientSecret:
          process.env.SPOTIFY_CLIENT_SECRET ||
          (process.env.NODE_ENV === 'production'
            ? missingEnv('SPOTIFY_CLIENT_SECRET')
            : 'dummy-spotify-client-secret'),
        authorization: {
          params: {
            scope: SPOTIFY_SCOPES,
            show_dialog: false,
          },
        },
      }),
    ];
  },
  callbacks: {
    async jwt({ token, account, user }) {
      // On initial sign-in, save the Spotify tokens to the JWT
      if (account && user) {
        token.spotifyAccessToken = account.access_token;
        token.spotifyRefreshToken = account.refresh_token;
        token.spotifyTokenExpiry = account.expires_at! * 1000;
        token.spotifyId = account.providerAccountId;

        // Populates the user.spotifyId column now that the User record exists
        const spotifyId = account.providerAccountId;
        await prisma.user.update({
          where: { id: user.id },
          data: { spotifyId },
        }).catch((err: any) => console.error('Failed to update user spotifyId in jwt:', err));
      }

      // Check if access token is still valid
      if (Date.now() > (token.spotifyTokenExpiry as number)) {
        if (!token.spotifyRefreshToken) {
          token.error = 'RefreshTokenError';
        } else {
          try {
            const result = await refreshSpotifyToken(token.spotifyRefreshToken as string);
            token.spotifyAccessToken = result.accessToken;
            token.spotifyTokenExpiry = result.expiresAt;
            if (result.refreshToken) {
              token.spotifyRefreshToken = result.refreshToken;
            }
          } catch (error) {
            console.error('Error refreshing access token:', error);
            token.error = 'RefreshTokenError';
          }
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user = session.user || {};
        session.user.spotifyId = token.spotifyId as string;
        session.spotifyAccessToken = token.spotifyAccessToken as string;
        session.spotifyTokenExpiry = token.spotifyTokenExpiry as number;
        session.error = token.error as string | undefined;
      }
      return session;
    },
  },
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/auth/connect',
    error: '/auth/connect',
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
export type { JWT } from 'next-auth/jwt';
