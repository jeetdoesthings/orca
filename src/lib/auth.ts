/**
 * NextAuth configuration with Spotify OAuth provider.
 * Handles token persistence, refresh, and session exposure.
 */
import type { AuthOptions, Account } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import SpotifyProvider from 'next-auth/providers/spotify';
import { inspect } from 'node:util';

const SPOTIFY_SCOPES = [
  'user-top-read',
  'user-read-recently-played',
  'user-library-read',
  'user-read-email',
].join(' ');

/** Refresh an expired Spotify access token */
async function refreshAccessToken(token: JWT): Promise<JWT> {
  try {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: token.refreshToken as string,
    });

    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(
          `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
        ).toString('base64')}`,
      },
      body: params.toString(),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to refresh token');
    }

    return {
      ...token,
      accessToken: data.access_token,
      expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
      // Spotify may return a new refresh token
      refreshToken: data.refresh_token ?? token.refreshToken,
    };
  } catch (error) {
    console.error('Error refreshing access token:', error);
    return { ...token, error: 'RefreshAccessTokenError' };
  }
}

export const authOptions: AuthOptions = {
  debug: true,
  providers: [
    SpotifyProvider({
      clientId: process.env.SPOTIFY_CLIENT_ID!,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET!,
      // Pass authorization as params object — NextAuth will correctly append
      // client_id, redirect_uri, response_type, state, etc.
      authorization: {
        params: {
          scope: SPOTIFY_SCOPES,
        },
      },
    }),
  ],
  logger: {
    error(code, metadata) {
      console.error(
        '[next-auth][logger][error]',
        code,
        inspect(metadata, { depth: 8, colors: false })
      );
    },
    warn(code) {
      console.warn('[next-auth][logger][warn]', code);
    },
    debug(code, metadata) {
      console.log(
        '[next-auth][logger][debug]',
        code,
        inspect(metadata, { depth: 8, colors: false })
      );
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: 'jwt' },
  callbacks: {
    async jwt({ token, account }: { token: JWT; account: Account | null }) {
      // Initial sign-in: persist tokens from Spotify
      if (account) {
        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          expiresAt: account.expires_at,
        };
      }

      // Subsequent requests: check if token is still valid
      if (typeof token.expiresAt === 'number' && Date.now() / 1000 < token.expiresAt) {
        return token;
      }

      // Token expired — refresh it
      return refreshAccessToken(token);
    },
    async session({ session, token }) {
      // Expose access token to client components via session
      (session as any).accessToken = token.accessToken;
      (session as any).error = token.error;
      return session;
    },
  },
};

// ──────────────────────────────────────────────────
// Type augmentation for next-auth
// ──────────────────────────────────────────────────
declare module 'next-auth' {
  interface Session {
    accessToken?: string;
    error?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    error?: string;
  }
}
