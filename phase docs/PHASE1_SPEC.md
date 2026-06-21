# MusicUniverse — Phase 1: Complete Specification
## "Make the Mirror Work"

> **For AI Assistants:** This document is the complete specification for Phase 1 of MusicUniverse. The core globe visualisation already exists and works. Phase 1 is about connecting real user data to it. Read every section before writing any code. The globe is a **translucent glass sphere on a light `#f0f0f5` background** with pastel colour-coded nodes. Do not change any globe visual settings. Only build what this document describes.

---

## What Phase 1 Is

Phase 1 has one job: **a user connects their Spotify account and feels genuinely seen.**

Not impressed by technology. Not interested in features. **Seen.** The moment someone's music taste appears as a shape on a globe, they should feel the same thing people feel when they read an accurate personality description — "yes, that's me."

Everything in Phase 1 serves that moment. Nothing else matters yet.

**Phase 1 is complete when:** You show it to 20 strangers. At least 14 of them say "I want this" or take a screenshot without being asked.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Spotify OAuth and Authentication](#2-spotify-oauth-and-authentication)
3. [Data Sync Pipeline](#3-data-sync-pipeline)
4. [Data Processing — Turning Spotify Data into Globe Data](#4-data-processing--turning-spotify-data-into-globe-data)
5. [Node State System — Explored vs Unexplored](#5-node-state-system--explored-vs-unexplored)
6. [Home Region — Camera Positioning on Load](#6-home-region--camera-positioning-on-load)
7. [Artist Hover Card](#7-artist-hover-card)
8. [The Share Screenshot](#8-the-share-screenshot)
9. [Database Schema](#9-database-schema)
10. [API Routes](#10-api-routes)
11. [Frontend State Management](#11-frontend-state-management)
12. [User Flow — Complete End to End](#12-user-flow--complete-end-to-end)
13. [Empty and Edge States](#13-empty-and-edge-states)
14. [What Does NOT Change](#14-what-does-not-change)
15. [Phase 1 Completion Checklist](#15-phase-1-completion-checklist)

---

## 1. Architecture Overview

### What Already Exists (Do Not Touch)

```
globe.gl canvas              → translucent sphere, renders fine
Node distribution system     → genre anchor positions, power scatter, repulsion
Magnetic hover effect        → nodes lean toward cursor
Arc rendering system         → coloured lines between artists
Manual drag orbit            → full rotation control
Artist image loading         → profile photos on nodes (see IMAGE_LOADING_SPEC.md)
Genre label rendering        → floating labels at sphere boundary
```

### What Phase 1 Adds

```
Spotify OAuth flow           → user authentication and token management
Data sync pipeline           → fetch and process user's Spotify data
User data layer              → overlay user's actual taste on the global globe
Explored/unexplored states   → visual distinction between known and unknown
Home region detection        → intelligent camera positioning on load
Artist hover card            → rich contextual information on hover
Share screenshot             → one-tap PNG export
User session persistence     → remember user between visits
```

### Tech Stack — Phase 1 Additions

```
NextAuth.js       → Spotify OAuth provider, session management
Prisma            → ORM for user data
PostgreSQL        → user data, sync state, explored edges
                    (Neon or Supabase for hosted Postgres)
Zustand           → client-side user state store
html2canvas       → share screenshot generation
                    (or @vercel/og for server-side)
```

### Data Flow

```
User clicks "Connect Spotify"
        ↓
NextAuth Spotify OAuth → access token + refresh token stored in DB
        ↓
Spotify sync job fires → fetches top artists, recent plays, audio features
        ↓
Processing pipeline → maps Spotify data to globe node positions + weights
        ↓
User subgraph stored in Postgres (explored edges + weights)
        ↓
API returns user's node data → globe renders explored/unexplored states
        ↓
User sees their taste as a shape on the globe
```

---

## 2. Spotify OAuth and Authentication

### Setup

```typescript
// src/app/api/auth/[...nextauth]/route.ts

import NextAuth from 'next-auth';
import SpotifyProvider from 'next-auth/providers/spotify';

// Scopes needed for Phase 1
// Do not request more than you need — fewer scopes = higher OAuth consent rate
const SPOTIFY_SCOPES = [
  'user-top-read',              // top artists and tracks
  'user-read-recently-played',  // listening history
  'user-library-read',          // saved albums and tracks
  'user-read-private',          // account info (country, display name)
].join(' ');

export const authOptions = {
  providers: [
    SpotifyProvider({
      clientId:     process.env.SPOTIFY_CLIENT_ID!,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: SPOTIFY_SCOPES,
          // Force account selection — prevents auto-login to wrong account
          show_dialog: true,
        },
      },
    }),
  ],

  callbacks: {
    async jwt({ token, account }) {
      // On first sign-in, account contains the Spotify tokens
      if (account) {
        token.spotifyAccessToken  = account.access_token;
        token.spotifyRefreshToken = account.refresh_token;
        token.spotifyTokenExpiry  = account.expires_at! * 1000; // convert to ms
        token.spotifyId           = account.providerAccountId;
      }

      // Refresh token if expired
      if (Date.now() > (token.spotifyTokenExpiry as number)) {
        token = await refreshSpotifyToken(token);
      }

      return token;
    },

    async session({ session, token }) {
      // Expose what the client needs — never expose raw tokens to client
      session.user.spotifyId          = token.spotifyId as string;
      session.spotifyAccessToken      = token.spotifyAccessToken as string;
      session.spotifyTokenExpiry      = token.spotifyTokenExpiry as number;
      session.error                   = token.error as string | undefined;
      return session;
    },
  },

  pages: {
    signIn:  '/auth/connect',   // custom sign-in page
    error:   '/auth/error',
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
```

### Token Refresh Function

```typescript
// src/lib/spotify/refreshToken.ts

async function refreshSpotifyToken(token: JWT): Promise<JWT> {
  try {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(
          `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
        ).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: token.spotifyRefreshToken as string,
      }),
    });

    const refreshed = await response.json();

    if (!response.ok) throw refreshed;

    return {
      ...token,
      spotifyAccessToken:  refreshed.access_token,
      spotifyTokenExpiry:  Date.now() + refreshed.expires_in * 1000,
      // Spotify sometimes sends a new refresh token — use it if provided
      spotifyRefreshToken: refreshed.refresh_token ?? token.spotifyRefreshToken,
    };
  } catch (error) {
    return { ...token, error: 'RefreshTokenError' };
  }
}
```

### Connect Page

The connect page is the user's first impression of the product before they've seen anything. It must communicate the value proposition in one sentence and make the OAuth button feel safe and trustworthy.

```tsx
// src/app/auth/connect/page.tsx

export default function ConnectPage() {
  return (
    <div style={{
      minHeight:      '100vh',
      background:     '#f0f0f5',
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
      fontFamily:     "'Geist', 'Inter', sans-serif",
    }}>
      <div style={{
        textAlign:  'center',
        maxWidth:   400,
        padding:    '0 24px',
      }}>

        {/* Globe preview — static or slow-rotating demo globe */}
        {/* Shows a sample universe so user knows what they're connecting to */}
        <div style={{ marginBottom: 48 }}>
          <DemoGlobePreview /> {/* small, ~200px, non-interactive */}
        </div>

        {/* Value proposition — one sentence, no marketing speak */}
        <p style={{
          fontSize:      15,
          color:         'rgba(0,0,0,0.50)',
          lineHeight:    1.6,
          marginBottom:  40,
          fontWeight:    400,
        }}>
          See the shape of your music taste.
        </p>

        {/* Connect button */}
        <button
          onClick={() => signIn('spotify', { callbackUrl: '/globe' })}
          style={{
            display:        'inline-flex',
            alignItems:     'center',
            gap:            10,
            background:     '#000000',
            color:          '#ffffff',
            border:         'none',
            borderRadius:   100,
            padding:        '14px 28px',
            fontSize:       14,
            fontWeight:     500,
            cursor:         'pointer',
            letterSpacing:  '0.01em',
          }}
        >
          {/* Spotify logo SVG — the green one */}
          <SpotifyIcon size={18} />
          Connect Spotify
        </button>

        {/* Trust signal — what you're not doing with their data */}
        <p style={{
          fontSize:   11,
          color:      'rgba(0,0,0,0.25)',
          marginTop:  20,
          lineHeight: 1.5,
        }}>
          Read-only access. We never modify your library or playlists.
        </p>

      </div>
    </div>
  );
}
```

**Design rules for the connect page:**
- No hero text, no tagline, no "revolutionary" language
- The demo globe IS the explanation — show don't tell
- The only action is connecting Spotify — no email sign-up, no other options
- Trust signal is mandatory — "read-only" removes the biggest user concern

---

## 3. Data Sync Pipeline

### What to Fetch

Fetch these endpoints in parallel where possible. All are read-only.

```typescript
// src/lib/spotify/sync.ts

interface SpotifySyncResult {
  topArtistsShort:   SpotifyArtist[];  // last 4 weeks
  topArtistsMedium:  SpotifyArtist[];  // last 6 months
  topArtistsLong:    SpotifyArtist[];  // all time
  recentTracks:      SpotifyTrack[];   // last 50 played
  savedTracks:       SpotifyTrack[];   // liked songs (up to 200)
  audioFeatures:     AudioFeatures[];  // for all unique tracks
  userProfile:       SpotifyProfile;   // display name, country, images
}

async function syncUserSpotifyData(
  accessToken: string,
  userId: string
): Promise<SpotifySyncResult> {

  // Fetch all in parallel — these are independent
  const [
    topArtistsShort,
    topArtistsMedium,
    topArtistsLong,
    recentTracks,
    userProfile,
  ] = await Promise.all([
    fetchTopArtists(accessToken, 'short_term',  50),
    fetchTopArtists(accessToken, 'medium_term', 50),
    fetchTopArtists(accessToken, 'long_term',   50),
    fetchRecentlyPlayed(accessToken, 50),
    fetchUserProfile(accessToken),
  ]);

  // Saved tracks needs pagination — fetch first 200
  const savedTracks = await fetchSavedTracks(accessToken, 200);

  // Collect all unique track IDs across recent + saved
  const allTrackIds = [
    ...new Set([
      ...recentTracks.map(t => t.id),
      ...savedTracks.map(t => t.id),
    ])
  ].slice(0, 500); // cap at 500 for Phase 1

  // Audio features — batch in groups of 100 (Spotify API limit)
  const audioFeatures = await fetchAudioFeaturesBatch(accessToken, allTrackIds);

  return {
    topArtistsShort,
    topArtistsMedium,
    topArtistsLong,
    recentTracks,
    savedTracks,
    audioFeatures,
    userProfile,
  };
}
```

### Fetch Functions

```typescript
// src/lib/spotify/fetch.ts

const SPOTIFY_BASE = 'https://api.spotify.com/v1';

async function spotifyFetch(endpoint: string, token: string) {
  const res = await fetch(`${SPOTIFY_BASE}${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  // Handle rate limiting gracefully
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('Retry-After') || '2');
    await sleep(retryAfter * 1000);
    return spotifyFetch(endpoint, token); // retry once
  }

  if (!res.ok) throw new Error(`Spotify API error: ${res.status} ${endpoint}`);
  return res.json();
}

async function fetchTopArtists(
  token: string,
  timeRange: 'short_term' | 'medium_term' | 'long_term',
  limit: number
): Promise<SpotifyArtist[]> {
  const data = await spotifyFetch(
    `/me/top/artists?time_range=${timeRange}&limit=${limit}`,
    token
  );
  return data.items;
}

async function fetchRecentlyPlayed(
  token: string,
  limit: number
): Promise<SpotifyTrack[]> {
  const data = await spotifyFetch(
    `/me/player/recently-played?limit=${limit}`,
    token
  );
  return data.items.map((item: any) => item.track);
}

async function fetchSavedTracks(
  token: string,
  maxItems: number
): Promise<SpotifyTrack[]> {
  const tracks: SpotifyTrack[] = [];
  let url = `/me/tracks?limit=50`;

  while (url && tracks.length < maxItems) {
    const data = await spotifyFetch(url, token);
    tracks.push(...data.items.map((item: any) => item.track));
    // Extract just the path from the next URL
    url = data.next
      ? data.next.replace(SPOTIFY_BASE, '')
      : null;
  }

  return tracks.slice(0, maxItems);
}

async function fetchAudioFeaturesBatch(
  token: string,
  trackIds: string[]
): Promise<AudioFeatures[]> {
  const features: AudioFeatures[] = [];
  const batchSize = 100; // Spotify's max per request

  for (let i = 0; i < trackIds.length; i += batchSize) {
    const batch = trackIds.slice(i, i + batchSize);
    const data  = await spotifyFetch(
      `/audio-features?ids=${batch.join(',')}`,
      token
    );
    features.push(...(data.audio_features || []).filter(Boolean));

    // Small delay between batches to avoid rate limits
    if (i + batchSize < trackIds.length) await sleep(100);
  }

  return features;
}
```

### When to Sync

```
First login:       Sync immediately after OAuth callback, before globe loads
                   Show loading screen during this sync
                   Store sync timestamp

Return visit:      Check last sync timestamp
                   If > 24 hours: sync in background, show cached data immediately
                   If < 24 hours: use cached data, no sync

Manual refresh:    "Refresh my data" button in settings
                   Triggers full sync, shows progress
```

```typescript
// src/app/api/user/sync/route.ts

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const userId      = session.user.spotifyId;
  const accessToken = session.spotifyAccessToken;

  // Check if sync is needed
  const lastSync = await db.user.findUnique({
    where:  { spotifyId: userId },
    select: { lastSyncAt: true },
  });

  const hoursSinceSync = lastSync?.lastSyncAt
    ? (Date.now() - lastSync.lastSyncAt.getTime()) / (1000 * 60 * 60)
    : Infinity;

  // Force sync on first time or if > 24 hours
  if (hoursSinceSync > 24) {
    // Run sync asynchronously — don't block the response
    // Client will poll for completion
    syncUserSpotifyData(accessToken, userId)
      .then(data => processAndStoreUserData(data, userId))
      .catch(err => console.error('Sync failed:', err));

    return Response.json({ status: 'syncing' });
  }

  return Response.json({ status: 'fresh', lastSync: lastSync?.lastSyncAt });
}
```

---

## 4. Data Processing — Turning Spotify Data into Globe Data

This is the most important section. Raw Spotify data is an array of artists and tracks. The globe needs node positions, weights, and states. This processing pipeline bridges that gap.

### Step 1: Compute Artist Weight

Every artist the user has interacted with gets a `listenWeight` between 0.0 and 1.0. This drives node size and visual prominence on the globe.

```typescript
// src/lib/processing/computeArtistWeight.ts

interface ArtistWeightInput {
  artist:        SpotifyArtist;
  topRankShort:  number | null;  // 1-50, null if not in top 50
  topRankMedium: number | null;
  topRankLong:   number | null;
  recentPlayCount: number;       // times in last 50 recent plays
  savedTrackCount: number;       // number of saved tracks by this artist
}

function computeArtistWeight(input: ArtistWeightInput): number {
  let score = 0;

  // Short-term rank (last 4 weeks) — highest weight
  // Being #1 recently matters more than being #50 all-time
  if (input.topRankShort !== null) {
    score += (51 - input.topRankShort) / 50 * 40; // 0-40 points
  }

  // Medium-term rank (last 6 months) — medium weight
  if (input.topRankMedium !== null) {
    score += (51 - input.topRankMedium) / 50 * 30; // 0-30 points
  }

  // Long-term rank (all time) — lower weight
  // Long-term presence matters but shouldn't dominate
  if (input.topRankLong !== null) {
    score += (51 - input.topRankLong) / 50 * 15; // 0-15 points
  }

  // Recent plays — immediate recency signal
  score += Math.min(input.recentPlayCount / 10, 1) * 10; // 0-10 points

  // Saved tracks — investment signal (saved = intentional)
  score += Math.min(input.savedTrackCount / 5, 1) * 5; // 0-5 points

  // Normalise to 0.0-1.0
  return Math.min(score / 100, 1.0);
}
```

### Step 2: Map Spotify Genres to Globe Genre System

Spotify returns genres as verbose strings like `"alternative metal"`, `"deep euro house"`, `"classic oklahoma country"`. The globe's genre system uses 11 top-level biomes. This mapping is the most failure-prone part of the pipeline — it must be robust.

```typescript
// src/lib/processing/genreMapper.ts

// The 11 globe biomes with their display names and anchor coordinates
export const GLOBE_GENRES = {
  electronic:   { label: 'Electronic',  color: '#00b8c4', anchor: { lat:  52, lng: -20 } },
  ambient:      { label: 'Ambient',     color: '#5548cc', anchor: { lat:  48, lng:  15 } },
  experimental: { label: 'Experimental',color: '#666680', anchor: { lat:  58, lng:  40 } },
  hiphop:       { label: 'Hip-Hop',     color: '#cc1a4a', anchor: { lat:  22, lng: -60 } },
  rnb:          { label: 'R&B / Soul',  color: '#b040b0', anchor: { lat:  15, lng: -40 } },
  pop:          { label: 'Pop',         color: '#d44090', anchor: { lat:   5, lng:  10 } },
  rock:         { label: 'Rock',        color: '#cc2200', anchor: { lat: -18, lng: -15 } },
  metal:        { label: 'Metal',       color: '#992200', anchor: { lat: -30, lng: -50 } },
  folk:         { label: 'Folk',        color: '#4a9e4a', anchor: { lat: -12, lng:  50 } },
  jazz:         { label: 'Jazz',        color: '#c96a20', anchor: { lat: -45, lng:  20 } },
  classical:    { label: 'Classical',   color: '#c8a800', anchor: { lat: -55, lng:  60 } },
} as const;

export type GlobeGenreKey = keyof typeof GLOBE_GENRES;

// Exhaustive mapping — every common Spotify genre tag → globe biome
// Sorted by specificity (more specific patterns first)
const GENRE_MAP: Array<{ pattern: RegExp; genre: GlobeGenreKey }> = [
  // Electronic — first because many compound genres contain "electronic"
  { pattern: /\b(edm|electronic|electro|house|techno|trance|dubstep|drum.and.bass|d&b|dnb|club|rave|dance)\b/i, genre: 'electronic' },
  { pattern: /\b(synth.?pop|synthwave|new.wave|italo|eurodance|euro.house|deep.house|tech.house)\b/i,           genre: 'electronic' },
  { pattern: /\b(idm|glitch|breakbeat|jungle|garage|uk.garage|grime)\b/i,                                       genre: 'electronic' },

  // Ambient — before experimental to catch ambient-specific terms
  { pattern: /\b(ambient|drone|new.age|post.rock|shoegaze|slowcore|chillout|downtempo|lo.fi)\b/i,               genre: 'ambient' },
  { pattern: /\b(dream.pop|ethereal|atmospheric|neoclassical.darkwave)\b/i,                                     genre: 'ambient' },

  // Hip-Hop
  { pattern: /\b(hip.?hop|rap|trap|drill|boom.bap|grime|afro.?trap|cloud.rap)\b/i,                             genre: 'hiphop' },
  { pattern: /\b(conscious.hip.hop|hardcore.hip.hop|underground.hip.hop|mumble.rap)\b/i,                       genre: 'hiphop' },

  // R&B / Soul
  { pattern: /\b(r.?&.?b|rhythm.and.blues|soul|neo.soul|funk|motown|new.jack.swing)\b/i,                       genre: 'rnb' },
  { pattern: /\b(contemporary.r.?&.?b|quiet.storm|smooth.soul|gospel)\b/i,                                     genre: 'rnb' },

  // Metal — before rock to catch metal-specific compound terms
  { pattern: /\b(metal|heavy.metal|death.metal|black.metal|thrash|doom|metalcore|djent|nu.metal)\b/i,           genre: 'metal' },
  { pattern: /\b(sludge|grindcore|deathcore|power.metal|speed.metal|symphonic.metal)\b/i,                      genre: 'metal' },

  // Rock
  { pattern: /\b(rock|punk|grunge|alternative|indie.rock|post.punk|garage.rock|hard.rock)\b/i,                  genre: 'rock' },
  { pattern: /\b(prog(ressive)?|art.rock|psychedelic.rock|britpop|emo|screamo|post.hardcore)\b/i,               genre: 'rock' },
  { pattern: /\b(classic.rock|album.rock|heartland.rock|southern.rock|blues.rock)\b/i,                          genre: 'rock' },

  // Jazz
  { pattern: /\b(jazz|bebop|bossa.nova|swing|big.band|fusion|smooth.jazz|free.jazz|cool.jazz)\b/i,             genre: 'jazz' },
  { pattern: /\b(hard.bop|post.bop|modal.jazz|latin.jazz|afro.cuban)\b/i,                                      genre: 'jazz' },

  // Classical
  { pattern: /\b(classical|orchestral|chamber|opera|baroque|romantic|symphony|concerto)\b/i,                    genre: 'classical' },
  { pattern: /\b(contemporary.classical|minimalism|modern.classical|soundtrack|score)\b/i,                     genre: 'classical' },

  // Folk
  { pattern: /\b(folk|country|bluegrass|americana|singer.songwriter|acoustic|celtic|roots)\b/i,                 genre: 'folk' },
  { pattern: /\b(indie.folk|folk.pop|folk.rock|alt.country|outlaw.country|western)\b/i,                        genre: 'folk' },

  // Experimental — catch-all for avant-garde
  { pattern: /\b(experimental|avant.garde|noise|industrial|abstract|musique.concrete)\b/i,                     genre: 'experimental' },

  // Pop — last because "pop" appears in many compound genres
  { pattern: /\b(pop|indie.pop|art.pop|dream.pop|chamber.pop|baroque.pop|power.pop)\b/i,                       genre: 'pop' },
  { pattern: /\b(k.?pop|j.?pop|electropop|dance.pop|teen.pop|bubblegum)\b/i,                                   genre: 'pop' },
];

export function mapSpotifyGenreToGlobe(spotifyGenres: string[]): GlobeGenreKey {
  if (!spotifyGenres || spotifyGenres.length === 0) return 'pop'; // safe default

  // Try each Spotify genre tag against the pattern list
  // Return the first match — patterns are ordered by specificity
  for (const spotifyGenre of spotifyGenres) {
    for (const { pattern, genre } of GENRE_MAP) {
      if (pattern.test(spotifyGenre)) return genre;
    }
  }

  // No match — return 'pop' as the central fallback
  // Pop is the geographic centre of the globe (lat: 5, lng: 10)
  // which is a reasonable default for unclassified artists
  return 'pop';
}

// For artists with multiple genres, compute a weighted blend
// to determine the MOST appropriate anchor
export function mapArtistToGenre(artist: SpotifyArtist): GlobeGenreKey {
  const genres = artist.genres || [];

  // Score each globe genre by how many of the artist's Spotify genres map to it
  const scores: Partial<Record<GlobeGenreKey, number>> = {};

  genres.forEach((g, index) => {
    // Earlier genres in Spotify's list are more primary — weight them higher
    const positionWeight = 1 / (index + 1);
    const mapped = mapSpotifyGenreToGlobe([g]);
    scores[mapped] = (scores[mapped] || 0) + positionWeight;
  });

  if (Object.keys(scores).length === 0) return 'pop';

  // Return the genre with the highest score
  return Object.entries(scores).sort(
    ([, a], [, b]) => b - a
  )[0][0] as GlobeGenreKey;
}
```

### Step 3: Generate Node Positions

Combine the genre anchor with organic scatter to place each artist on the globe.

```typescript
// src/lib/processing/nodePositions.ts

// Seeded random — same artist always gets same position
// This is critical: positions must be deterministic so the globe
// looks the same every time the user loads it
function seededRandom(seed: string): () => number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }

  // Simple LCG generator seeded with the hash
  let state = Math.abs(hash);
  return () => {
    state = (state * 1664525 + 1013904223) & 0xffffffff;
    return (state >>> 0) / 0xffffffff;
  };
}

export function computeNodePosition(
  artistId: string,
  genre: GlobeGenreKey,
  listenWeight: number
): { lat: number; lng: number } {
  const rand   = seededRandom(artistId);
  const anchor = GLOBE_GENRES[genre].anchor;

  // Power scatter: r = maxRadius * (rand)^1.8
  // Creates dense cores with sparse halos
  const maxRadius = 22; // degrees
  const r         = maxRadius * Math.pow(rand(), 1.8);
  const theta     = rand() * 2 * Math.PI;

  // Heavier-listened artists cluster tighter to the genre core
  // listenWeight 1.0 = 55% closer to core
  // listenWeight 0.0 = no tightening
  const tightness = 0.3 + listenWeight * 0.55;
  const finalR    = r * (1 - tightness * 0.5);

  return {
    lat: anchor.lat + finalR * Math.cos(theta),
    lng: anchor.lng + finalR * Math.sin(theta),
  };
}

// After computing all positions, run a single repulsion pass
// to prevent nodes from stacking directly on top of each other
export function applyRepulsion(
  nodes: Array<{ id: string; lat: number; lng: number }>,
  iterations = 3
): Array<{ id: string; lat: number; lng: number }> {
  const MIN_DIST = 2.5;    // degrees
  const STRENGTH = 0.4;

  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dLat = nodes[i].lat - nodes[j].lat;
        const dLng = nodes[i].lng - nodes[j].lng;
        const dist = Math.sqrt(dLat * dLat + dLng * dLng);

        if (dist < MIN_DIST && dist > 0) {
          const push = (MIN_DIST - dist) / dist * STRENGTH * 0.5;
          nodes[i].lat += dLat * push;
          nodes[i].lng += dLng * push;
          nodes[j].lat -= dLat * push;
          nodes[j].lng -= dLng * push;
        }
      }
    }
  }

  return nodes;
}
```

### Step 4: Build the Complete User Globe Data

```typescript
// src/lib/processing/buildUserGlobeData.ts

export interface UserGlobeNode {
  id:           string;          // Spotify artist ID
  name:         string;
  genre:        GlobeGenreKey;
  genreColor:   string;          // hex from GLOBE_GENRES
  lat:          number;
  lng:          number;
  listenWeight: number;          // 0.0-1.0
  state:        'explored';      // Phase 1: all user artists are explored
                                  // Phase 2 adds 'frontier' state
  // Emotional vocabulary fields
  primaryMood:  string;          // e.g. "late-night melancholy"
  country:      string | null;   // artist's country from MusicBrainz or Spotify
  imageUrl:     string | null;   // for the artist image loading system
  popularity:   number;          // Spotify popularity 0-100
}

export function buildUserGlobeData(
  syncResult: SpotifySyncResult
): UserGlobeNode[] {

  // Deduplicate artists across all sources
  const artistMap = new Map<string, SpotifyArtist>();

  [
    ...syncResult.topArtistsShort,
    ...syncResult.topArtistsMedium,
    ...syncResult.topArtistsLong,
  ].forEach(a => artistMap.set(a.id, a));

  // Build rank lookups
  const shortRanks  = new Map(syncResult.topArtistsShort.map((a, i) => [a.id, i + 1]));
  const mediumRanks = new Map(syncResult.topArtistsMedium.map((a, i) => [a.id, i + 1]));
  const longRanks   = new Map(syncResult.topArtistsLong.map((a, i) => [a.id, i + 1]));

  // Count recent plays per artist
  const recentPlayCounts = new Map<string, number>();
  syncResult.recentTracks.forEach(track => {
    const artistId = track.artists[0]?.id;
    if (artistId) {
      recentPlayCounts.set(artistId, (recentPlayCounts.get(artistId) || 0) + 1);
    }
  });

  // Count saved tracks per artist
  const savedTrackCounts = new Map<string, number>();
  syncResult.savedTracks.forEach(track => {
    const artistId = track.artists[0]?.id;
    if (artistId) {
      savedTrackCounts.set(artistId, (savedTrackCounts.get(artistId) || 0) + 1);
    }
  });

  // Build audio feature averages per artist
  const artistAudioFeatures = computeArtistAudioFeatureAverages(
    syncResult.audioFeatures,
    syncResult.recentTracks,
    syncResult.savedTracks
  );

  // Build nodes
  const rawNodes = Array.from(artistMap.values()).map(artist => {
    const listenWeight = computeArtistWeight({
      artist,
      topRankShort:    shortRanks.get(artist.id) ?? null,
      topRankMedium:   mediumRanks.get(artist.id) ?? null,
      topRankLong:     longRanks.get(artist.id) ?? null,
      recentPlayCount: recentPlayCounts.get(artist.id) ?? 0,
      savedTrackCount: savedTrackCounts.get(artist.id) ?? 0,
    });

    const genre     = mapArtistToGenre(artist);
    const position  = computeNodePosition(artist.id, genre, listenWeight);
    const features  = artistAudioFeatures.get(artist.id);
    const mood      = features ? computeMoodLabel(features) : 'varied';

    return {
      id:           artist.id,
      name:         artist.name,
      genre,
      genreColor:   GLOBE_GENRES[genre].color,
      lat:          position.lat,
      lng:          position.lng,
      listenWeight,
      state:        'explored' as const,
      primaryMood:  mood,
      country:      null, // enriched later via MusicBrainz if available
      imageUrl:     artist.images?.[1]?.url ?? artist.images?.[0]?.url ?? null,
      popularity:   artist.popularity,
    };
  });

  // Apply repulsion to prevent overlapping nodes
  const positionedNodes = applyRepulsion(
    rawNodes.map(n => ({ id: n.id, lat: n.lat, lng: n.lng }))
  );

  // Merge repulsed positions back
  const positionMap = new Map(positionedNodes.map(n => [n.id, n]));
  return rawNodes.map(n => ({
    ...n,
    lat: positionMap.get(n.id)?.lat ?? n.lat,
    lng: positionMap.get(n.id)?.lng ?? n.lng,
  }));
}
```

### Step 5: Mood Label Computation

Map Spotify audio features to emotional vocabulary. Never expose raw numbers to users.

```typescript
// src/lib/processing/moodLabels.ts

interface AudioFeatureAverage {
  valence:          number;  // 0-1, emotional positivity
  energy:           number;  // 0-1
  acousticness:     number;  // 0-1
  danceability:     number;  // 0-1
  instrumentalness: number;  // 0-1
  tempo:            number;  // BPM
}

const MOOD_DEFINITIONS = [
  {
    label:     'late-night melancholy',
    condition: (f: AudioFeatureAverage) =>
      f.valence < 0.35 && f.energy < 0.50 && f.acousticness > 0.25,
  },
  {
    label:     'euphoric rush',
    condition: (f: AudioFeatureAverage) =>
      f.valence > 0.70 && f.energy > 0.75,
  },
  {
    label:     'morning clarity',
    condition: (f: AudioFeatureAverage) =>
      f.valence > 0.55 && f.energy > 0.40 && f.energy < 0.75 && f.acousticness > 0.35,
  },
  {
    label:     'restless energy',
    condition: (f: AudioFeatureAverage) =>
      f.energy > 0.75 && f.valence > 0.35 && f.valence < 0.70,
  },
  {
    label:     'tender introspection',
    condition: (f: AudioFeatureAverage) =>
      f.valence > 0.30 && f.valence < 0.65 && f.energy < 0.45 && f.acousticness > 0.45,
  },
  {
    label:     'triumphant arrival',
    condition: (f: AudioFeatureAverage) =>
      f.valence > 0.70 && f.energy > 0.55 && f.energy < 0.80,
  },
  {
    label:     'floating dissociation',
    condition: (f: AudioFeatureAverage) =>
      f.instrumentalness > 0.50 && f.energy < 0.35,
  },
  {
    label:     'defiant noise',
    condition: (f: AudioFeatureAverage) =>
      f.energy > 0.80 && f.valence < 0.45,
  },
  {
    label:     'sun-drenched warmth',
    condition: (f: AudioFeatureAverage) =>
      f.valence > 0.70 && f.acousticness > 0.35 && f.energy < 0.70,
  },
  {
    label:     'underground pulse',
    condition: (f: AudioFeatureAverage) =>
      f.danceability > 0.70 && f.energy > 0.60 && f.valence < 0.60,
  },
  {
    label:     'nostalgic ache',
    condition: (f: AudioFeatureAverage) =>
      f.valence < 0.50 && f.tempo < 95,
  },
  {
    label:     'sacred stillness',
    condition: (f: AudioFeatureAverage) =>
      f.instrumentalness > 0.40 && f.energy < 0.25,
  },
];

export function computeMoodLabel(features: AudioFeatureAverage): string {
  // Find first matching mood definition
  const match = MOOD_DEFINITIONS.find(def => def.condition(features));
  return match?.label ?? 'varied energy'; // fallback
}

// Compute average audio features across an artist's tracks
export function computeArtistAudioFeatureAverages(
  audioFeatures: AudioFeatures[],
  recentTracks: SpotifyTrack[],
  savedTracks: SpotifyTrack[]
): Map<string, AudioFeatureAverage> {

  // Build track → artist mapping
  const trackToArtist = new Map<string, string>();
  [...recentTracks, ...savedTracks].forEach(track => {
    const artistId = track.artists[0]?.id;
    if (artistId) trackToArtist.set(track.id, artistId);
  });

  // Group audio features by artist
  const artistFeatures = new Map<string, AudioFeatures[]>();
  audioFeatures.forEach(feat => {
    if (!feat) return;
    const artistId = trackToArtist.get(feat.id);
    if (!artistId) return;
    const existing = artistFeatures.get(artistId) || [];
    artistFeatures.set(artistId, [...existing, feat]);
  });

  // Average features per artist
  const averages = new Map<string, AudioFeatureAverage>();
  artistFeatures.forEach((features, artistId) => {
    const count = features.length;
    averages.set(artistId, {
      valence:          features.reduce((s, f) => s + f.valence, 0) / count,
      energy:           features.reduce((s, f) => s + f.energy, 0) / count,
      acousticness:     features.reduce((s, f) => s + f.acousticness, 0) / count,
      danceability:     features.reduce((s, f) => s + f.danceability, 0) / count,
      instrumentalness: features.reduce((s, f) => s + f.instrumentalness, 0) / count,
      tempo:            features.reduce((s, f) => s + f.tempo, 0) / count,
    });
  });

  return averages;
}
```

---

## 5. Node State System — Explored vs Unexplored

### Phase 1 States

In Phase 1, every artist in the user's Spotify data is `explored`. There are no frontier nodes yet — that's Phase 2.

However, the visual state system must be built correctly now so Phase 2 can add frontier nodes without a rewrite.

```typescript
// Node states — define now, only 'explored' used in Phase 1
type NodeState = 'explored' | 'frontier' | 'dormant';

// Visual rendering per state
const NODE_VISUAL: Record<NodeState, {
  opacityMultiplier: number;
  sizeMultiplier:    number;
  pulseAnimation:    boolean;
}> = {
  explored: {
    opacityMultiplier: 1.0,    // full colour, full opacity
    sizeMultiplier:    1.0,    // full size from listenWeight calculation
    pulseAnimation:    false,
  },
  frontier: {
    opacityMultiplier: 0.35,   // ghosted — present but not solid
    sizeMultiplier:    0.7,    // slightly smaller
    pulseAnimation:    true,   // slow invitation pulse (Phase 2)
  },
  dormant: {
    opacityMultiplier: 0.08,   // barely visible — just dots in the distance
    sizeMultiplier:    0.5,
    pulseAnimation:    false,
  },
};
```

### Node Size Calculation

```typescript
// Translate listenWeight into a globe.gl point radius
// This creates the node size hierarchy visible in the globe
function getNodeRadius(listenWeight: number, state: NodeState): number {
  const BASE_SIZE = 0.12;
  const MAX_SIZE  = 0.55;

  // Linear mapping from weight to size, then apply state multiplier
  const rawSize = BASE_SIZE + (listenWeight * (MAX_SIZE - BASE_SIZE));
  return rawSize * NODE_VISUAL[state].sizeMultiplier;
}

// Usage in globe.gl config:
globe.pointRadius(d => getNodeRadius(d.listenWeight, d.state));
```

### Node Colour

```typescript
// Colour is always the genre biome colour
// State affects opacity, not hue — keeps the genre identity clear
function getNodeColor(node: UserGlobeNode): string {
  const hex     = node.genreColor; // e.g. '#cc1a4a'
  const opacity = NODE_VISUAL[node.state].opacityMultiplier;

  // Convert hex + opacity to rgba string
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}
```

---

## 6. Home Region — Camera Positioning on Load

When a user's globe loads, the camera must position itself to show them the most meaningful view immediately. Not the geographic centre of the Earth — the geographic centre of *their* taste.

### Computing the Home Region

```typescript
// src/lib/processing/homeRegion.ts

export interface HomeRegion {
  lat:    number;
  lng:    number;
  label:  string;   // the dominant genre name
  spread: number;   // how spread out the taste is (0.0 tight, 1.0 very spread)
}

export function computeHomeRegion(nodes: UserGlobeNode[]): HomeRegion {
  if (nodes.length === 0) return { lat: 0, lng: 0, label: 'Pop', spread: 0 };

  // Weight each node's position by its listenWeight
  // High-weight nodes pull the centroid toward them more
  let totalWeight = 0;
  let weightedLat = 0;
  let weightedLng = 0;

  nodes.forEach(node => {
    // Use squared weight to further emphasise the most-listened artists
    const w     = node.listenWeight * node.listenWeight;
    totalWeight += w;
    weightedLat += node.lat * w;
    weightedLng += node.lng * w;
  });

  const centroidLat = weightedLat / totalWeight;
  const centroidLng = weightedLng / totalWeight;

  // Find the dominant genre (highest total listen weight)
  const genreWeights: Partial<Record<GlobeGenreKey, number>> = {};
  nodes.forEach(node => {
    genreWeights[node.genre] = (genreWeights[node.genre] || 0) + node.listenWeight;
  });

  const dominantGenre = Object.entries(genreWeights).sort(
    ([, a], [, b]) => b - a
  )[0][0] as GlobeGenreKey;

  // Compute spread: average distance of nodes from centroid
  const distances = nodes.map(node => Math.sqrt(
    Math.pow(node.lat - centroidLat, 2) +
    Math.pow(node.lng - centroidLng, 2)
  ));
  const avgDistance = distances.reduce((s, d) => s + d, 0) / distances.length;
  const spread      = Math.min(avgDistance / 60, 1.0); // normalise to 0-1

  return {
    lat:   centroidLat,
    lng:   centroidLng,
    label: GLOBE_GENRES[dominantGenre].label,
    spread,
  };
}
```

### Flying the Camera to Home Region

```typescript
// In your globe setup, after user data loads:

function flyToHomeRegion(globe: GlobeInstance, homeRegion: HomeRegion) {
  // Altitude determines how much of the globe is visible
  // Spread-out taste = zoom out to see more
  // Tight taste = zoom in to show density
  const altitude = 1.4 + homeRegion.spread * 0.8; // 1.4 to 2.2

  globe.pointOfView(
    {
      lat:      homeRegion.lat,
      lng:      homeRegion.lng,
      altitude, // 1.4 = close, 2.2 = showing ~60% of globe
    },
    1200  // 1200ms — slower than interaction fly-to, more cinematic
  );
}

// Call this once, after data loads and globe renders:
// Small delay so the user sees the globe before it moves
setTimeout(() => flyToHomeRegion(globe, homeRegion), 400);
```

### Taste Shape Summary

After the camera settles, show a single line of text that describes the user's taste in non-statistical language. This is what makes the moment feel like "you've been seen" rather than "data has been loaded."

```typescript
// src/lib/processing/tasteShape.ts

export function generateTasteSummary(
  nodes: UserGlobeNode[],
  homeRegion: HomeRegion
): string {

  const dominantGenreLabel = homeRegion.label;
  const spread             = homeRegion.spread;
  const nodeCount          = nodes.length;

  // Count unique genres
  const uniqueGenres = new Set(nodes.map(n => n.genre)).size;

  // Identify the top mood across the most-listened artists
  const topNodes   = nodes
    .sort((a, b) => b.listenWeight - a.listenWeight)
    .slice(0, 10);
  const topMood    = getMostCommonMood(topNodes);

  // Generate a narrative sentence
  if (spread < 0.25) {
    // Highly concentrated taste
    return `Deeply rooted in ${dominantGenreLabel} — a focused, specific taste`;
  }

  if (spread > 0.70 && uniqueGenres >= 6) {
    // Very spread out
    return `${nodeCount} artists across ${uniqueGenres} genres — a restless, wide-ranging curiosity`;
  }

  if (spread > 0.50) {
    return `A ${dominantGenreLabel}-centred universe with strong connections reaching outward`;
  }

  // Default: mention the dominant mood
  return `${dominantGenreLabel} at the core, defined by ${topMood}`;
}
```

**Display this summary** as a single line of small text, centred below the globe, fading in 800ms after the camera settles. Colour: `rgba(0,0,0,0.38)`. Font size: 13px. No label, no heading — just the sentence.

---

## 7. Artist Hover Card

The hover card is the primary reading surface of Phase 1. When a user hovers over a node, this card tells them everything meaningful about that artist's place in their universe.

### Card Design Spec

```
Position:       24px right and 16px above the cursor
                Flip to left if cursor is within 260px of right edge
                Flip to below if cursor is within 160px of top edge
Dimensions:     220px wide, height auto (min ~120px, max ~220px)
Background:     rgba(255, 255, 255, 0.92)
Backdrop:       blur(16px) saturate(180%)
Border:         1px solid rgba(0, 0, 0, 0.06)
Border-radius:  14px
Padding:        16px 18px
Shadow:         0 4px 32px rgba(0,0,0,0.09), 0 1px 4px rgba(0,0,0,0.05)
Animation:      fade in 140ms ease-out, fade out 100ms ease-in
                Do NOT animate position — it follows cursor smoothly via JS
```

### Card Content Structure

```
[Genre pill]
[Artist name]
[Country]          ← only if known
[Divider]
[Mood label]
[Listen context]   ← emotional framing of listen data
```

**Full card component:**

```tsx
// src/components/globe/ArtistHoverCard.tsx

interface ArtistHoverCardProps {
  node:    UserGlobeNode;
  visible: boolean;
  x:       number;   // viewport x
  y:       number;   // viewport y
}

export function ArtistHoverCard({ node, visible, x, y }: ArtistHoverCardProps) {
  const listenContext = getListenContext(node.listenWeight);

  return (
    <div style={{
      position:        'fixed',
      left:            x + 24,
      top:             y - 16,
      zIndex:          200,
      width:           220,
      pointerEvents:   'none',
      opacity:         visible ? 1 : 0,
      transform:       visible ? 'translateY(0)' : 'translateY(4px)',
      transition:      'opacity 140ms ease-out, transform 140ms ease-out',
      fontFamily:      "'Geist', 'Inter', sans-serif",
      WebkitFontSmoothing: 'antialiased',
    }}>
      <div style={{
        background:       'rgba(255, 255, 255, 0.92)',
        backdropFilter:   'blur(16px) saturate(180%)',
        WebkitBackdropFilter: 'blur(16px) saturate(180%)',
        border:           '1px solid rgba(0, 0, 0, 0.06)',
        borderRadius:     14,
        padding:          '14px 16px',
        boxShadow:        '0 4px 32px rgba(0,0,0,0.09), 0 1px 4px rgba(0,0,0,0.05)',
      }}>

        {/* Genre pill */}
        <div style={{
          display:         'inline-flex',
          alignItems:      'center',
          background:      hexToRgba(node.genreColor, 0.12),
          color:           darkenHex(node.genreColor, 0.15),
          border:          `1px solid ${hexToRgba(node.genreColor, 0.20)}`,
          borderRadius:    100,
          padding:         '3px 9px',
          fontSize:        10,
          fontWeight:      500,
          letterSpacing:   '0.08em',
          textTransform:   'uppercase',
          marginBottom:    10,
        }}>
          {GLOBE_GENRES[node.genre].label}
        </div>

        {/* Artist name */}
        <div style={{
          fontSize:        15,
          fontWeight:      500,
          color:           '#0d0d18',
          lineHeight:      1.2,
          marginBottom:    node.country ? 4 : 12,
        }}>
          {node.name}
        </div>

        {/* Country — only if known */}
        {node.country && (
          <div style={{
            fontSize:      12,
            color:         'rgba(0,0,0,0.38)',
            marginBottom:  12,
          }}>
            {node.country}
          </div>
        )}

        {/* Divider */}
        <div style={{
          height:          1,
          background:      'rgba(0,0,0,0.06)',
          margin:          '0 0 12px',
        }} />

        {/* Mood label */}
        <div style={{
          fontSize:      12,
          color:         'rgba(0,0,0,0.45)',
          marginBottom:  6,
          fontStyle:     'italic',
        }}>
          {node.primaryMood}
        </div>

        {/* Listen context */}
        <div style={{
          fontSize:      12,
          color:         'rgba(0,0,0,0.38)',
          lineHeight:    1.4,
        }}>
          {listenContext}
        </div>

      </div>
    </div>
  );
}

// Translate listenWeight into a human sentence
// Never say "you listened X times" or "ranked #N"
function getListenContext(listenWeight: number): string {
  if (listenWeight > 0.85) return 'A defining part of your universe';
  if (listenWeight > 0.70) return 'Deeply woven into your taste';
  if (listenWeight > 0.55) return 'A significant presence in your listening';
  if (listenWeight > 0.40) return 'Regularly returned to';
  if (listenWeight > 0.25) return 'Part of your wider world';
  if (listenWeight > 0.10) return 'An occasional companion';
  return 'On the edges of your universe';
}
```

### Hover State Management

```typescript
// In your globe component:
const [hoveredNode, setHoveredNode] = useState<UserGlobeNode | null>(null);
const [hoverPos, setHoverPos]       = useState({ x: 0, y: 0 });

globe.onPointHover((node: UserGlobeNode | null) => {
  setHoveredNode(node);
});

// Track cursor position for card positioning
globeContainerEl.addEventListener('mousemove', (e: MouseEvent) => {
  if (!hoveredNode) return;
  const rect = globeContainerEl.getBoundingClientRect();

  // Flip card left if near right edge
  const flipX = e.clientX > window.innerWidth - 280;
  // Flip card down if near top edge
  const flipY = e.clientY < 180;

  setHoverPos({
    x: flipX ? e.clientX - 244 : e.clientX,
    y: flipY ? e.clientY + 24  : e.clientY,
  });
});
```

---

## 8. The Share Screenshot

Every person who shares their globe is an acquisition event. This feature must be in Phase 1 — not Phase 4.

### What the Share Image Looks Like

```
Dimensions:     1080×1080 (square, for Instagram feed)
                1080×1920 (vertical, for Stories) — secondary format
Background:     #f0f0f5 (same as page background)
Globe:          Centred, showing the user's home region
                Approximately 70% of the image width
Username:       Bottom left, small, "username's universe"
                Font: 13px, rgba(0,0,0,0.40)
Branding:       Bottom right, app wordmark only, very small
                Colour: rgba(0,0,0,0.22)
Taste summary:  Single line, centred below globe
                Same text as shown in the app
No:             Statistics, rankings, numbers, genre percentages
```

### Implementation

Use `html2canvas` to capture the globe canvas. The key challenge is that Three.js/WebGL canvases are not captured by default — you need to configure canvas preservation.

```typescript
// src/lib/share/generateSnapshot.ts
import html2canvas from 'html2canvas';

export async function generateShareSnapshot(
  globeContainerEl: HTMLElement,
  username: string,
  tasteSummary: string
): Promise<Blob> {

  // Step 1: Preserve the WebGL canvas before capture
  // WebGL canvases clear between frames — we need preserveDrawingBuffer
  // This must be set on globe initialisation (see globe config section)

  // Step 2: Create the share composition overlay
  // We add this temporarily, capture, then remove it
  const overlay = createShareOverlay(username, tasteSummary);
  document.body.appendChild(overlay);

  try {
    const canvas = await html2canvas(globeContainerEl, {
      useCORS:          true,
      allowTaint:       false,
      backgroundColor:  '#f0f0f5',
      scale:            2,     // 2x for retina quality
      logging:          false,
      // Include the overlay in the capture
      onclone: (clonedDoc) => {
        // Ensure the cloned canvas has the current frame
        const clonedCanvas = clonedDoc.querySelector('canvas');
        if (clonedCanvas) {
          const origCanvas = globeContainerEl.querySelector('canvas');
          if (origCanvas) {
            const ctx = clonedCanvas.getContext('2d');
            ctx?.drawImage(origCanvas, 0, 0);
          }
        }
      },
    });

    return new Promise(resolve => {
      canvas.toBlob(blob => resolve(blob!), 'image/png', 0.95);
    });
  } finally {
    document.body.removeChild(overlay);
  }
}

function createShareOverlay(username: string, tasteSummary: string): HTMLElement {
  const overlay   = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 9999;
    font-family: 'Geist', 'Inter', sans-serif;
    -webkit-font-smoothing: antialiased;
  `;

  // Taste summary — centred, below globe midpoint
  const summary   = document.createElement('div');
  summary.innerText = tasteSummary;
  summary.style.cssText = `
    position: absolute;
    bottom: 22%;
    left: 50%;
    transform: translateX(-50%);
    font-size: 13px;
    color: rgba(0,0,0,0.38);
    white-space: nowrap;
    letter-spacing: 0.02em;
  `;

  // Username — bottom left
  const user      = document.createElement('div');
  user.innerText  = `${username}'s universe`;
  user.style.cssText = `
    position: absolute;
    bottom: 32px;
    left: 36px;
    font-size: 12px;
    color: rgba(0,0,0,0.32);
    letter-spacing: 0.02em;
  `;

  // App wordmark — bottom right
  const brand     = document.createElement('div');
  brand.innerText = 'MusicUniverse';  // replace with your app name
  brand.style.cssText = `
    position: absolute;
    bottom: 32px;
    right: 36px;
    font-size: 11px;
    color: rgba(0,0,0,0.20);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  `;

  overlay.appendChild(summary);
  overlay.appendChild(user);
  overlay.appendChild(brand);
  return overlay;
}
```

### Globe Canvas — Required Config Change

For `html2canvas` to capture the WebGL canvas correctly, you must initialise globe.gl with `preserveDrawingBuffer: true`.

```javascript
// In your globe initialisation:
const globe = Globe({
  rendererConfig: {
    preserveDrawingBuffer: true,  // REQUIRED for screenshot capture
    antialias: true,
    alpha: true,
  }
})('globe-container');
```

### Share Button Component

```tsx
// src/components/globe/ShareButton.tsx

export function ShareButton({
  globeContainerRef,
  username,
  tasteSummary,
}: ShareButtonProps) {
  const [status, setStatus] = useState<'idle' | 'capturing' | 'done'>('idle');

  async function handleShare() {
    setStatus('capturing');

    try {
      const blob = await generateShareSnapshot(
        globeContainerRef.current!,
        username,
        tasteSummary
      );

      // Use native share sheet on mobile if available
      if (navigator.share && navigator.canShare({ files: [new File([blob], 'universe.png')] })) {
        const file = new File([blob], 'my-universe.png', { type: 'image/png' });
        await navigator.share({
          files: [file],
          title: `${username}'s Music Universe`,
        });
      } else {
        // Fallback: download the image
        const url  = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href  = url;
        link.download = 'my-universe.png';
        link.click();
        URL.revokeObjectURL(url);
      }

      setStatus('done');
      setTimeout(() => setStatus('idle'), 2000);
    } catch (err) {
      console.error('Share failed:', err);
      setStatus('idle');
    }
  }

  return (
    <button
      onClick={handleShare}
      disabled={status === 'capturing'}
      style={{
        position:       'fixed',
        bottom:         32,
        right:          32,
        display:        'flex',
        alignItems:     'center',
        gap:            8,
        background:     'rgba(255,255,255,0.88)',
        backdropFilter: 'blur(12px)',
        border:         '1px solid rgba(0,0,0,0.08)',
        borderRadius:   100,
        padding:        '10px 18px',
        fontSize:       13,
        fontWeight:     500,
        color:          status === 'done' ? '#2a8a2a' : '#0d0d18',
        cursor:         status === 'capturing' ? 'wait' : 'pointer',
        boxShadow:      '0 2px 16px rgba(0,0,0,0.08)',
        transition:     'all 200ms ease-out',
        fontFamily:     "'Geist', 'Inter', sans-serif",
      }}
    >
      {status === 'capturing' && <SpinnerIcon size={14} />}
      {status === 'done'      && <CheckIcon size={14} />}
      {status === 'idle'      && <ShareIcon size={14} />}

      {status === 'capturing' ? 'Capturing…'
       : status === 'done'    ? 'Saved'
       : 'Share'}
    </button>
  );
}
```

---

## 9. Database Schema

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id          String   @id @default(cuid())
  spotifyId   String   @unique
  displayName String?
  avatarUrl   String?
  country     String?

  // Sync state
  lastSyncAt  DateTime?
  syncStatus  SyncStatus @default(PENDING)

  // Processed globe data (JSON blob for fast reads)
  // Updated on every sync — no need to recompute on every page load
  globeData   Json?    // UserGlobeNode[]
  homeRegion  Json?    // HomeRegion
  tasteSummary String?

  // Auth
  accounts    Account[]
  sessions    Session[]

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([spotifyId])
}

enum SyncStatus {
  PENDING
  SYNCING
  COMPLETE
  FAILED
}

// NextAuth required models
model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String?
  access_token      String?
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String?
  session_state     String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

---

## 10. API Routes

### `GET /api/user/globe-data`

Returns the processed globe data for the authenticated user.

```typescript
// src/app/api/user/globe-data/route.ts

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const user = await db.user.findUnique({
    where:  { spotifyId: session.user.spotifyId },
    select: {
      globeData:    true,
      homeRegion:   true,
      tasteSummary: true,
      lastSyncAt:   true,
      syncStatus:   true,
    },
  });

  if (!user) return Response.json({ status: 'no_data' });

  if (user.syncStatus === 'SYNCING') {
    return Response.json({ status: 'syncing' });
  }

  if (!user.globeData) {
    return Response.json({ status: 'no_data' });
  }

  return Response.json({
    status:       'ready',
    nodes:        user.globeData,
    homeRegion:   user.homeRegion,
    tasteSummary: user.tasteSummary,
    lastSyncAt:   user.lastSyncAt,
  }, {
    headers: {
      // Cache for 5 minutes — globe data doesn't change mid-session
      'Cache-Control': 'private, max-age=300',
    },
  });
}
```

### `POST /api/user/sync`

Triggers a Spotify data sync.

```typescript
// src/app/api/user/sync/route.ts

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const userId      = session.user.spotifyId;
  const accessToken = session.spotifyAccessToken;

  // Mark as syncing immediately
  await db.user.upsert({
    where:  { spotifyId: userId },
    update: { syncStatus: 'SYNCING' },
    create: {
      spotifyId:   userId,
      displayName: session.user.name ?? '',
      avatarUrl:   session.user.image ?? '',
      syncStatus:  'SYNCING',
    },
  });

  // Run sync in background — this is fire-and-forget
  runFullSync(accessToken, userId).catch(err => {
    console.error('Sync error:', err);
    db.user.update({
      where:  { spotifyId: userId },
      data:   { syncStatus: 'FAILED' },
    });
  });

  return Response.json({ status: 'syncing' });
}

async function runFullSync(accessToken: string, userId: string) {
  // 1. Fetch Spotify data
  const syncResult = await syncUserSpotifyData(accessToken, userId);

  // 2. Process into globe nodes
  const nodes       = buildUserGlobeData(syncResult);
  const homeRegion  = computeHomeRegion(nodes);
  const summary     = generateTasteSummary(nodes, homeRegion);

  // 3. Store processed data
  await db.user.update({
    where: { spotifyId: userId },
    data: {
      globeData:    nodes,
      homeRegion:   homeRegion,
      tasteSummary: summary,
      lastSyncAt:   new Date(),
      syncStatus:   'COMPLETE',
      displayName:  syncResult.userProfile.display_name,
      avatarUrl:    syncResult.userProfile.images?.[0]?.url,
      country:      syncResult.userProfile.country,
    },
  });
}
```

---

## 11. Frontend State Management

```typescript
// src/stores/globeStore.ts
import { create } from 'zustand';

interface GlobeStore {
  // User data
  nodes:        UserGlobeNode[];
  homeRegion:   HomeRegion | null;
  tasteSummary: string;
  syncStatus:   'idle' | 'syncing' | 'ready' | 'error';

  // Globe interaction
  hoveredNode:     UserGlobeNode | null;
  selectedNode:    UserGlobeNode | null;
  isGlobeInteractive: boolean;

  // Actions
  setNodes:           (nodes: UserGlobeNode[]) => void;
  setHomeRegion:      (region: HomeRegion) => void;
  setTasteSummary:    (summary: string) => void;
  setSyncStatus:      (status: GlobeStore['syncStatus']) => void;
  setHoveredNode:     (node: UserGlobeNode | null) => void;
  setSelectedNode:    (node: UserGlobeNode | null) => void;
  setGlobeInteractive:(interactive: boolean) => void;
}

export const useGlobeStore = create<GlobeStore>((set) => ({
  nodes:              [],
  homeRegion:         null,
  tasteSummary:       '',
  syncStatus:         'idle',
  hoveredNode:        null,
  selectedNode:       null,
  isGlobeInteractive: false,

  setNodes:            (nodes) => set({ nodes }),
  setHomeRegion:       (homeRegion) => set({ homeRegion }),
  setTasteSummary:     (tasteSummary) => set({ tasteSummary }),
  setSyncStatus:       (syncStatus) => set({ syncStatus }),
  setHoveredNode:      (hoveredNode) => set({ hoveredNode }),
  setSelectedNode:     (selectedNode) => set({ selectedNode }),
  setGlobeInteractive: (isGlobeInteractive) => set({ isGlobeInteractive }),
}));
```

---

## 12. User Flow — Complete End to End

```
1. User lands on / (root)
   → If not authenticated: redirect to /auth/connect
   → If authenticated:     redirect to /globe

2. /auth/connect
   → Shows connect page with demo globe preview
   → User clicks "Connect Spotify"
   → NextAuth OAuth redirect → Spotify login → callback

3. OAuth callback (/api/auth/callback/spotify)
   → NextAuth handles token storage
   → Redirect to /globe

4. /globe (first visit)
   → Globe canvas renders immediately (empty, no nodes)
   → POST /api/user/sync fires immediately
   → Loading overlay appears (see IMAGE_LOADING_SPEC.md)
   → Client polls GET /api/user/globe-data every 2 seconds
   → When syncStatus === 'COMPLETE': data returned
   → buildGlobeNodes() called with returned data
   → globe.pointsData() called → nodes appear on globe
   → Artist image loading begins (60 images preloaded)
   → When 60 images loaded: loading overlay dissolves
   → flyToHomeRegion() called after 400ms delay
   → Taste summary fades in
   → Globe becomes interactive
   → Share button fades in

5. /globe (return visit, < 24 hours since sync)
   → GET /api/user/globe-data → returns cached data immediately
   → Globe loads with cached nodes
   → Background sync check: if > 24h, trigger background sync
   → Much faster: IndexedDB has images, data is cached

6. User hovers a node
   → onPointHover fires
   → ArtistHoverCard appears with artist info

7. User clicks share
   → generateShareSnapshot() captures globe
   → Native share sheet (mobile) or download (desktop)
```

### Polling Logic

```typescript
// src/hooks/useGlobeData.ts

export function useGlobeData() {
  const { setSyncStatus, setNodes, setHomeRegion, setTasteSummary } = useGlobeStore();

  useEffect(() => {
    let pollInterval: NodeJS.Timeout;

    async function fetchData() {
      const res  = await fetch('/api/user/globe-data');
      const data = await res.json();

      if (data.status === 'syncing') {
        setSyncStatus('syncing');
        // Keep polling
        return;
      }

      if (data.status === 'no_data') {
        // First visit — trigger sync
        await fetch('/api/user/sync', { method: 'POST' });
        setSyncStatus('syncing');
        return;
      }

      if (data.status === 'ready') {
        setSyncStatus('ready');
        setNodes(data.nodes);
        setHomeRegion(data.homeRegion);
        setTasteSummary(data.tasteSummary);
        clearInterval(pollInterval); // stop polling
      }
    }

    fetchData();
    // Poll every 2 seconds while syncing
    pollInterval = setInterval(fetchData, 2000);

    return () => clearInterval(pollInterval);
  }, []);
}
```

---

## 13. Empty and Edge States

### New User — No Spotify Data

Some users may have very little Spotify history (new accounts, private sessions, etc.).

```
Minimum viable data:
  At least 5 artists for the globe to show anything meaningful.

If < 5 artists available:
  Show the globe with whatever exists.
  Add a message: "Your universe is just beginning."
  Show 5 "seed" frontier nodes around the few artists that do exist.
  These seed nodes are globally popular artists in adjacent genres —
  they give the user something to explore immediately.
```

### Sync Failed

```typescript
// If sync fails after 3 retries, show a friendly error:
if (syncStatus === 'FAILED') {
  return (
    <div style={{
      position:  'fixed',
      bottom:    80,
      left:      '50%',
      transform: 'translateX(-50%)',
      background:'rgba(255,255,255,0.90)',
      backdropFilter: 'blur(12px)',
      border:    '1px solid rgba(0,0,0,0.08)',
      borderRadius: 12,
      padding:   '12px 20px',
      fontSize:  13,
      color:     'rgba(0,0,0,0.55)',
    }}>
      Couldn't reach Spotify.{' '}
      <button onClick={retrySync} style={{ color: '#0066cc', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>
        Try again
      </button>
    </div>
  );
}
```

### Token Expiry Mid-Session

```typescript
// If a Spotify API call returns 401 during sync:
// 1. Attempt token refresh (handled by NextAuth callback)
// 2. If refresh fails: session.error === 'RefreshTokenError'
// 3. Show reconnect prompt

if (session?.error === 'RefreshTokenError') {
  // Prompt user to reconnect — session has expired
  return <ReconnectPrompt />;
}
```

---

## 14. What Does NOT Change

These systems are complete and must not be modified during Phase 1 implementation:

```
✓  globe.gl canvas and all rendering settings
✓  Translucent glass sphere appearance
✓  Node distribution system (genre anchors, power scatter, repulsion)
✓  Magnetic hover effect (cursor magnet on nodes)
✓  Arc rendering and arc culling (80-arc cap)
✓  Manual drag orbit controls
✓  Genre label rendering at sphere boundary
✓  Artist image loading system (see IMAGE_LOADING_SPEC.md)
✓  Light mode colour system (#f0f0f5 background)
✓  All Three.js/globe.gl performance settings
```

---

## 15. Phase 1 Completion Checklist

Use this to track progress. Check off items as completed. Phase 1 is done when all boxes are checked.

### Infrastructure
- [ ] Next.js project has PostgreSQL database connected (Neon or Supabase)
- [ ] Prisma schema created and migrated (`npx prisma migrate dev`)
- [ ] Environment variables set: `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`
- [ ] Spotify Developer App created with correct redirect URI registered

### Authentication
- [ ] NextAuth installed and configured with Spotify provider
- [ ] All required Spotify scopes requested (`user-top-read`, `user-read-recently-played`, `user-library-read`, `user-read-private`)
- [ ] Token refresh function working (tokens auto-refresh when expired)
- [ ] `/auth/connect` page built with demo globe preview and connect button
- [ ] Post-auth redirect goes to `/globe`
- [ ] `session.error === 'RefreshTokenError'` handled with reconnect prompt

### Data Sync
- [ ] `fetchTopArtists()` working for all three time ranges
- [ ] `fetchRecentlyPlayed()` working (50 tracks)
- [ ] `fetchSavedTracks()` working with pagination (200 tracks)
- [ ] `fetchAudioFeaturesBatch()` working in batches of 100
- [ ] Rate limit handling (429 retry with backoff)
- [ ] Sync job fires on first login
- [ ] Sync status stored and polled by client
- [ ] Last sync timestamp stored — sync skipped if < 24 hours

### Data Processing
- [ ] `computeArtistWeight()` producing correct 0.0–1.0 weights
- [ ] `mapArtistToGenre()` correctly classifying artists into 11 globe genres
- [ ] GENRE_MAP tested against 50+ common Spotify genre strings
- [ ] `computeNodePosition()` producing deterministic, seeded positions
- [ ] `applyRepulsion()` preventing node overlap without uniform spacing
- [ ] `computeMoodLabel()` producing emotional vocabulary (not audio feature numbers)
- [ ] `generateTasteSummary()` producing natural language taste descriptions
- [ ] Processed data stored as JSON in `User.globeData`

### Globe Integration
- [ ] `GET /api/user/globe-data` returning correct shape
- [ ] Client polling until `status === 'ready'`
- [ ] `globe.pointsData()` called with processed user nodes
- [ ] Node size correctly encoding `listenWeight`
- [ ] Node colour correctly encoding genre biome
- [ ] `preserveDrawingBuffer: true` set in globe renderer config
- [ ] `computeHomeRegion()` correctly finding the weighted taste centroid
- [ ] `flyToHomeRegion()` animating camera to correct position after data loads
- [ ] Taste summary text appearing below globe after camera settles

### Visual States
- [ ] Explored nodes: full colour, correct size hierarchy
- [ ] Node visual state system built (even if only 'explored' used now)
- [ ] No always-on node labels (labels only in hover card)

### Hover Card
- [ ] `ArtistHoverCard` component built to spec
- [ ] Genre pill with correct biome colour
- [ ] Artist name rendering
- [ ] Mood label using emotional vocabulary
- [ ] Listen context using emotional language (no raw numbers)
- [ ] Card repositions to avoid edge overflow
- [ ] Card fades in/out on hover start/end

### Share Feature
- [ ] `html2canvas` installed
- [ ] `preserveDrawingBuffer: true` confirmed working with screenshot
- [ ] `generateShareSnapshot()` producing clean 1080×1080 PNG
- [ ] Taste summary included in share image
- [ ] Username included in share image
- [ ] Minimal app wordmark included
- [ ] Native share sheet used on mobile
- [ ] Download fallback working on desktop
- [ ] Share button visible in UI

### Edge States
- [ ] Sync failed state handled with retry button
- [ ] New user with < 5 artists handled gracefully
- [ ] Loading state (syncing) shown correctly
- [ ] Return visit uses cached data immediately

### Quality Bar
- [ ] Shown to 5 people who don't know you
- [ ] All 5 can navigate to a specific artist without instruction
- [ ] At least 3 of 5 say they recognise their taste in the globe
- [ ] At least 3 of 5 try to share or ask how to share
- [ ] No console errors during normal use
- [ ] Works on mobile (touch drag, pinch zoom)

---

*Last updated: [DATE]*
*Phase status: IN PROGRESS*

> **For AI Assistants:** The globe visualisation is already complete and working. Your job in Phase 1 is to wire real Spotify data to it. Start with Section 2 (auth) → Section 3 (sync) → Section 4 (processing) → Section 10 (API routes) → Section 6 (camera) in that order. Do not touch any globe visual settings. Do not modify the node distribution system. The processing pipeline in Section 4 is the most critical code — get the genre mapping right or the globe will look wrong.
