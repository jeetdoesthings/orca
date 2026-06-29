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

export const authOptions: AuthOptions = {
  secret: process.env.NEXTAUTH_SECRET || (process.env.NODE_ENV === 'production'
    ? (() => { throw new Error('NEXTAUTH_SECRET must be set in production!'); })()
    : 'fallback-secret-for-pre-alpha-testing-1234567890'),
  adapter: PrismaAdapter(prisma),
  providers: [
    SpotifyProvider({
      clientId: process.env.SPOTIFY_CLIENT_ID || (process.env.NODE_ENV === 'production'
        ? (() => { throw new Error('SPOTIFY_CLIENT_ID must be set in production!'); })()
        : 'dummy-spotify-client-id'),
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET || (process.env.NODE_ENV === 'production'
        ? (() => { throw new Error('SPOTIFY_CLIENT_SECRET must be set in production!'); })()
        : 'dummy-spotify-client-secret'),
      authorization: {
        params: {
          scope: SPOTIFY_SCOPES,
          show_dialog: false,
        },
      },
    }),
  ],
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
        }).catch(err => console.error('Failed to update user spotifyId in jwt:', err));
      }

      // Check if access token is still valid
      if (Date.now() > (token.spotifyTokenExpiry as number)) {
        try {
          const response = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Authorization: `Basic ${Buffer.from(
                `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
              ).toString('base64')}`,
            },
            body: new URLSearchParams({
              grant_type: 'refresh_token',
              refresh_token: token.spotifyRefreshToken as string,
            }),
          });

          const refreshed = await response.json();
          if (!response.ok) throw refreshed;

          token.spotifyAccessToken = refreshed.access_token;
          token.spotifyTokenExpiry = Date.now() + refreshed.expires_in * 1000;
          if (refreshed.refresh_token) {
            token.spotifyRefreshToken = refreshed.refresh_token;
          }
        } catch (error) {
          console.error('Error refreshing access token:', error);
          token.error = 'RefreshTokenError';
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
