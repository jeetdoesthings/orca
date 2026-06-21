# MusicUniverse — Phase 2: Complete Specification
## "The Frontier"

> **For AI Assistants:** Phase 1 is complete. The globe shows the user's existing taste as explored nodes on a translucent glass sphere. Phase 2 adds everything *beyond* that taste — the frontier. Read every section before writing any code. The globe is a **translucent glass sphere on a `#f0f0f5` background**. Do not modify any existing globe visual settings, the node distribution system, the magnetic hover, or the arc system. Only build what this document describes.

---

## What Phase 2 Is

Phase 2 has one job: **make the edge of the user's taste visible, and make crossing it feel rewarding.**

Phase 1 answered "who am I musically?" Phase 2 answers "what's just beyond me?" The entire phase is about the border between known and unknown — making it visible, tactile, and magnetic.

The product insight that drives every decision in Phase 2: discovery fails when it feels arbitrary. "You might also like X" fails because there's no visible connection between where you are and where X lives. The frontier mechanic fixes this by making the connection spatial. Users can *see* that a frontier node is close to their explored territory. The proximity is the argument for why they might like it.


Important distinction:

Frontier nodes are not recommendations.

The frontier system exists to reveal adjacent areas of the music graph that the user has not yet explored.

The purpose of the frontier is exploration, not prediction.

Users should feel that they discovered artists through exploration of the world itself rather than being algorithmically recommended artists.

Whenever possible, frontier logic should prioritise graph structure and adjacency over popularity-based recommendation behaviour.


**Phase 2 is complete when:** A user who has never heard of a specific artist is shown that artist as a frontier node, hears 30 seconds of their music, decides to explore, and can visibly see their universe expand in response.

---

## Table of Contents

1. [What Changes on the Globe](#1-what-changes-on-the-globe)
2. [Frontier Node System](#2-frontier-node-system)
3. [Genre Boundary Perimeter](#3-genre-boundary-perimeter)
4. [Frontier Data Pipeline](#4-frontier-data-pipeline)
5. [Spotify Preview Integration](#5-spotify-preview-integration)
6. [Explore Action — Marking as Explored](#6-explore-action--marking-as-explored)
7. [Taste Adventurousness Visualisation](#7-taste-adventurousness-visualisation)
8. [Geographic Gap Detection](#8-geographic-gap-detection)
9. [Frontier Panel — The Discovery Surface](#9-frontier-panel--the-discovery-surface)
10. [Database Schema Changes](#10-database-schema-changes)
11. [API Routes](#11-api-routes)
12. [Frontend State Changes](#12-frontend-state-changes)
13. [Animations and Transitions](#13-animations-and-transitions)
14. [The Expansion Moment — Shareable Event](#14-the-expansion-moment--shareable-event)
15. [What Does NOT Change](#15-what-does-not-change)
16. [Phase 2 Completion Checklist](#16-phase-2-completion-checklist)

---

## 1. What Changes on the Globe

### Visual Changes Summary

```
Phase 1 globe:    Explored nodes only. Full colour, sized by listen weight.
                  Empty space everywhere else.

Phase 2 globe:    Explored nodes — unchanged from Phase 1.
                  Frontier nodes — ghost nodes surrounding explored clusters.
                  Genre boundary perimeter — visible edge around explored territory.
                  Geographic gap indicators — dim region markers for untouched continents.
```

### The Three-State Node System (Expanded)

Phase 1 built the state system but only used `explored`. Phase 2 activates `frontier` and adds `newly-explored`.

```typescript
type NodeState =
  | 'explored'        // user has listened — full colour, full size (Phase 1)
  | 'frontier'        // adjacent to explored, never listened — ghost, pulsing
  | 'newly-explored'  // just marked as explored this session — transition state
  | 'dormant';        // far from explored territory — not rendered in Phase 2
```

### Rendering Rules Per State

```typescript
const NODE_VISUAL: Record<NodeState, NodeVisual> = {
  explored: {
    opacity:        1.0,
    sizeMultiplier: 1.0,
    pulse:          false,
    color:          'genre biome colour at full saturation',
    // unchanged from Phase 1
  },

  frontier: {
    opacity:        0.38,
    sizeMultiplier: 0.65,
    pulse:          true,        // slow invitation pulse — see §13
    color:          'genre biome colour at 15% saturation (near-white)',
    // Important: desaturated, not just transparent
    // The genre colour is a hint, not a declaration
  },

  'newly-explored': {
    opacity:        1.0,
    sizeMultiplier: 1.4,         // briefly larger than normal — celebration
    pulse:          false,
    color:          'genre biome colour at full saturation',
    // Transitions to 'explored' visual over 1200ms
  },

  dormant: {
    opacity:        0,           // not rendered at all
    sizeMultiplier: 0,
    pulse:          false,
    color:          'none',
  },
};
```

---

## 2. Frontier Node System

### What a Frontier Node Is

A frontier node is an artist that:
1. The user has **never listened to** (not in their Spotify data)
2. Is **musically adjacent** to at least one artist the user *has* explored
3. Is **not too distant** — within 1–2 degrees of musical separation

Frontier nodes are not random recommendations. They are specifically the artists who sit *just outside* the user's known world. The spatial proximity on the globe is not metaphorical — it reflects genuine musical adjacency.

### Adjacency Definition

Two artists are adjacent if any of the following are true:

```typescript
interface AdjacencyCheck {
  // Condition 1: Same Spotify genre tag
  // e.g. both tagged "dream pop" by Spotify
  sharedGenreTag: boolean;

  // Condition 2: Spotify's related artists
  // Spotify provides a "related artists" endpoint per artist
  // If Artist B is in Artist A's related artists list, they are adjacent
  inSpotifyRelated: boolean;

  // Condition 3: Same globe biome, similar listen weight cluster
  // Artists in the same genre biome (e.g. both 'ambient')
  // whose node positions are within 20 degrees of each other
  sameGlobeBiome: boolean;
  distanceOnGlobe: number; // degrees — frontier if < 20
}

function isAdjacent(
  exploredArtist: ProcessedArtist,
  candidate: ProcessedArtist
): boolean {
  return (
    candidate.sharedGenreTagsWith(exploredArtist) ||
    candidate.isInSpotifyRelatedOf(exploredArtist) ||
    (candidate.genre === exploredArtist.genre &&
     globeDistance(candidate, exploredArtist) < 20)
  );
}
```

### Frontier Score

Not all frontier nodes are equal. Score them to determine rendering priority (which ones glow brightest, which to surface in the frontier panel).

```typescript
function computeFrontierScore(
  candidate: ArtistNode,
  exploredNodes: ArtistNode[]
): number {
  // Find all explored nodes adjacent to this candidate
  const adjacentExplored = exploredNodes.filter(e =>
    isAdjacent(e, candidate)
  );

  if (adjacentExplored.length === 0) return 0;

  // Base score: how many explored artists point to this candidate
  // More connections = more evidence the user will like this
  const connectionScore = Math.min(adjacentExplored.length / 5, 1.0) * 40;

  // Weight score: how heavily listened are the adjacent explored artists
  const avgWeight = adjacentExplored.reduce(
    (s, a) => s + a.listenWeight, 0
  ) / adjacentExplored.length;
  const weightScore = avgWeight * 30;

  // Proximity score: how close on the globe (closer = higher score)
  const minDistance = Math.min(
    ...adjacentExplored.map(e => globeDistance(candidate, e))
  );
  const proximityScore = Math.max(0, (20 - minDistance) / 20) * 20;

  // Popularity penalty: slightly deprioritise mega-mainstream artists
  // as frontier nodes (user probably already knows them)
  const popularityPenalty = candidate.spotifyPopularity > 85
    ? -10
    : 0;

  return connectionScore + weightScore + proximityScore + popularityPenalty;
}
```


Note:

Frontier score exists solely to prioritise which frontier nodes are rendered.

Frontier score is not a recommendation confidence score.

The score should be interpreted as:

"How strongly connected is this unexplored node to the user's existing explored territory?"

rather than

"How likely is the user to enjoy this artist?"


### How Many Frontier Nodes to Show

```typescript
const FRONTIER_LIMITS = {
  total:          80,   // max frontier nodes on globe at any time
  perGenreBiome:  15,   // max per genre to prevent one genre dominating
  minScore:       10,   // minimum score to qualify as frontier
};

// After scoring all candidates, take top 80 by score
// Apply per-biome cap to ensure diversity
function selectFrontierNodes(
  allCandidates: ScoredCandidate[],
  limits = FRONTIER_LIMITS
): ArtistNode[] {

  const sorted     = allCandidates
    .filter(c => c.score >= limits.minScore)
    .sort((a, b) => b.score - a.score);

  const biomeCounts: Partial<Record<GlobeGenreKey, number>> = {};
  const selected: ArtistNode[] = [];

  for (const candidate of sorted) {
    if (selected.length >= limits.total) break;

    const biomeCount = biomeCounts[candidate.genre] || 0;
    if (biomeCount >= limits.perGenreBiome) continue;

    selected.push(candidate.node);
    biomeCounts[candidate.genre] = biomeCount + 1;
  }

  return selected;
}
```

### Fetching Frontier Candidates

For each explored artist, fetch Spotify's related artists. Deduplicate, filter out already-explored, score, select top 80.

```typescript
// src/lib/frontier/buildFrontierNodes.ts

async function buildFrontierNodes(
  exploredArtists: ArtistNode[],
  accessToken: string
): Promise<ArtistNode[]> {

  // Fetch related artists for each explored artist
  // Batch to avoid rate limiting — process 10 at a time
  const relatedArtistSets: SpotifyArtist[][] = [];

  for (let i = 0; i < exploredArtists.length; i += 10) {
    const batch = exploredArtists.slice(i, i + 10);
    const results = await Promise.all(
      batch.map(a => fetchRelatedArtists(a.id, accessToken))
    );
    relatedArtistSets.push(...results);
    if (i + 10 < exploredArtists.length) await sleep(200);
  }

  // Collect all unique related artists
  const exploredIds    = new Set(exploredArtists.map(a => a.id));
  const candidateMap   = new Map<string, {
    artist: SpotifyArtist;
    adjacentTo: string[];  // IDs of explored artists this is related to
  }>();

  relatedArtistSets.forEach((related, i) => {
    const sourceArtist = exploredArtists[i];
    related.forEach(r => {
      if (exploredIds.has(r.id)) return; // already explored — skip
      const existing = candidateMap.get(r.id);
      if (existing) {
        existing.adjacentTo.push(sourceArtist.id);
      } else {
        candidateMap.set(r.id, {
          artist:     r,
          adjacentTo: [sourceArtist.id],
        });
      }
    });
  });

  // Process candidates into globe nodes
  const candidates: ScoredCandidate[] = Array.from(
    candidateMap.values()
  ).map(({ artist, adjacentTo }) => {
    const genre       = mapArtistToGenre(artist);
    const position    = computeNodePosition(artist.id, genre, 0.3);
    // listenWeight 0.3 for frontier nodes — mid-size, not dominant

    const node: ArtistNode = {
      id:           artist.id,
      name:         artist.name,
      genre,
      genreColor:   GLOBE_GENRES[genre].color,
      lat:          position.lat,
      lng:          position.lng,
      listenWeight: 0.3,
      state:        'frontier',
      primaryMood:  'unknown',        // enriched if user hovers
      country:      null,
      imageUrl:     artist.images?.[1]?.url ?? null,
      popularity:   artist.popularity,
    };

    const adjacentExplored = exploredArtists.filter(e =>
      adjacentTo.includes(e.id)
    );

    return {
      node,
      score: computeFrontierScore(node, adjacentExplored),
      adjacentTo,
    };
  });

  return selectFrontierNodes(candidates);
}

async function fetchRelatedArtists(
  artistId: string,
  token: string
): Promise<SpotifyArtist[]> {
  try {
    const data = await spotifyFetch(
      `/artists/${artistId}/related-artists`,
      token
    );
    return data.artists || [];
  } catch {
    return []; // fail gracefully — one failed related-artists call shouldn't block everything
  }
}
```

---


## Structural Discovery Principles

Phase 2 introduces frontier nodes, but the frontier should not be interpreted as a recommendation engine.

The long-term ORCA graph contains multiple object types:

- Artists
- Genres
- Scenes
- Movements
- Labels
- Albums

Phase 2 only visualises artist frontier nodes, however all frontier computation should be designed so that future graph objects can participate in the same discovery system.

A frontier artist is therefore considered:

"A nearby unexplored part of the music graph."

not

"An artist the system predicts the user will enjoy."

This distinction is important because ORCA is an exploration product rather than a recommendation product.

Future phases may surface scene, movement, genre, or label frontier objects using the same underlying graph infrastructure.

---

## 3. Genre Boundary Perimeter

The most visually distinctive feature of Phase 2. A visible edge drawn around the user's explored territory on the globe — inside is known, outside is frontier.

### What It Looks Like

```
Visual:   A soft, irregular closed curve tracing the outer edge
          of the user's explored node cluster per genre biome.
          Not a perfect circle — follows the actual shape of the cluster.

Stroke:   1px, genre biome colour at 25% opacity
          Dashed: dashArray "4 6" — broken line, subtle
          No fill — the interior of the curve is not shaded

Animation: The perimeter breathes very slowly — stroke-opacity
           oscillates between 0.15 and 0.35 over 4 seconds.
           This makes it feel alive without being distracting.

On expand: When a frontier node is marked as explored,
           the perimeter redraws to include it.
           The redraw is animated — the curve morphs over 800ms.
```

### Computing the Perimeter

Use a convex hull algorithm on the explored nodes per genre biome, projected to 2D screen space, then convert back to globe coordinates.

```typescript
// src/lib/frontier/genrePerimeter.ts

interface PerimeterPoint {
  lat: number;
  lng: number;
}

export function computeGenrePerimeter(
  exploredNodes: ArtistNode[],
  genre: GlobeGenreKey
): PerimeterPoint[] | null {

  const genreNodes = exploredNodes.filter(n => n.genre === genre);
  if (genreNodes.length < 3) return null; // need at least 3 points for a hull

  const points = genreNodes.map(n => ({ x: n.lng, y: n.lat }));

  // Compute convex hull using Graham scan
  const hull = computeConvexHull(points);

  // Expand hull outward by 4 degrees to create breathing room
  // (perimeter sits slightly outside the outermost nodes)
  const centre = {
    x: hull.reduce((s, p) => s + p.x, 0) / hull.length,
    y: hull.reduce((s, p) => s + p.y, 0) / hull.length,
  };

  const EXPAND = 4; // degrees
  const expanded = hull.map(p => {
    const dx     = p.x - centre.x;
    const dy     = p.y - centre.y;
    const dist   = Math.sqrt(dx * dx + dy * dy);
    const factor = (dist + EXPAND) / dist;
    return {
      lat: centre.y + dy * factor,
      lng: centre.x + dx * factor,
    };
  });

  return expanded;
}

function computeConvexHull(
  points: Array<{ x: number; y: number }>
): Array<{ x: number; y: number }> {
  if (points.length < 3) return points;

  // Graham scan implementation
  // Sort by x, then y
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);

  const cross = (
    o: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number }
  ) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: typeof sorted = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: typeof sorted = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}
```

### Rendering the Perimeter on the Globe

Use `globe.customLayerData` and `globe.customLayerObject` to add SVG overlay curves on top of the globe surface.

```typescript
// Build perimeter data for all genres with enough nodes
const perimeters = Object.keys(GLOBE_GENRES).map(genre => {
  const points = computeGenrePerimeter(exploredNodes, genre as GlobeGenreKey);
  return points ? { genre, points, color: GLOBE_GENRES[genre as GlobeGenreKey].color } : null;
}).filter(Boolean);

// Add to globe as a custom layer
// globe.gl renders these as THREE.Line objects on the sphere surface
globe
  .customLayerData(perimeters)
  .customThreeObject(perim => {
    const { points, color } = perim;

    const curve = new THREE.CatmullRomCurve3(
      points.map(p => {
        // Convert lat/lng to 3D position on sphere surface
        const pos = globe.getCoords(p.lat, p.lng, 0.002); // slight altitude
        return new THREE.Vector3(pos.x, pos.y, pos.z);
      }),
      true // closed curve
    );

    const tubePoints = curve.getPoints(points.length * 8);
    const geometry   = new THREE.BufferGeometry().setFromPoints(tubePoints);

    const material   = new THREE.LineBasicMaterial({
      color:       new THREE.Color(color),
      opacity:     0.25,
      transparent: true,
      linewidth:   1,
    });

    return new THREE.Line(geometry, material);
  });
```

---

## 4. Frontier Data Pipeline

### When to Compute Frontiers

```
On first login:     After Spotify sync completes and explored nodes are built,
                    immediately compute frontier nodes.
                    Store in DB. Serve with globe data.

On return visit:    Serve cached frontier data with globe data.
                    Recompute in background if > 48 hours old.
                    (Frontier changes slowly — no need to recompute daily)

On explore action:  When user marks a frontier node as explored,
                    immediately remove it from frontier set.
                    Re-run frontier computation in background for the
                    newly explored artist's related artists.
                    (May surface new frontier nodes)
```

### Frontier Computation Job

```typescript
// src/lib/frontier/computeAndStoreFrontier.ts

export async function computeAndStoreFrontier(
  userId: string,
  exploredNodes: ArtistNode[],
  accessToken: string
): Promise<void> {

  // Mark frontier as computing
  await db.user.update({
    where: { spotifyId: userId },
    data:  { frontierStatus: 'COMPUTING' },
  });

  try {
    const frontierNodes = await buildFrontierNodes(exploredNodes, accessToken);

    // Compute perimeters for all genres
    const perimeters = (Object.keys(GLOBE_GENRES) as GlobeGenreKey[])
      .map(genre => ({
        genre,
        points: computeGenrePerimeter(exploredNodes, genre),
        color:  GLOBE_GENRES[genre].color,
      }))
      .filter(p => p.points !== null);

    await db.user.update({
      where: { spotifyId: userId },
      data: {
        frontierData:      frontierNodes,
        perimeterData:     perimeters,
        frontierStatus:    'COMPLETE',
        frontierComputedAt: new Date(),
      },
    });
  } catch (err) {
    await db.user.update({
      where: { spotifyId: userId },
      data:  { frontierStatus: 'FAILED' },
    });
    throw err;
  }
}
```

---

## 5. Spotify Preview Integration

When a user hovers over a frontier node for more than 600ms, a 30-second audio preview plays automatically. This is the single most important interaction in Phase 2 — it's the difference between looking at a dot and experiencing a new artist.

### Preview Hover Logic

```typescript
// Hover intent detection — don't fire on accidental hover
let hoverTimer: ReturnType<typeof setTimeout> | null = null;
let currentPreview: HTMLAudioElement | null = null;

globe.onPointHover((node: ArtistNode | null) => {
  // Clear any pending preview
  if (hoverTimer) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }

  if (!node) {
    // Cursor left — fade out and stop preview
    fadeOutAndStop(currentPreview);
    currentPreview = null;
    return;
  }

  if (node.state !== 'frontier') return;
  // Only auto-preview frontier nodes — explored nodes use click

  // Wait 600ms before playing — prevents preview on quick mouseover
  hoverTimer = setTimeout(() => {
    playFrontierPreview(node);
  }, 600);
});
```

### Preview Player

```typescript
// src/lib/audio/frontierPreview.ts

interface PreviewState {
  node:     ArtistNode;
  audio:    HTMLAudioElement;
  progress: number;  // 0-1
}

let activePreview: PreviewState | null = null;

export async function playFrontierPreview(node: ArtistNode): Promise<void> {
  // Stop any currently playing preview
  if (activePreview) {
    await fadeOutAndStop(activePreview.audio);
  }

  // Fetch preview URL if not already on the node
  const previewUrl = node.previewUrl || await fetchPreviewUrl(node.id);
  if (!previewUrl) return; // Spotify doesn't have a preview for every track

  const audio       = new Audio(previewUrl);
  audio.volume      = 0;         // start silent — fade in
  audio.crossOrigin = 'anonymous';

  try {
    await audio.play();
  } catch {
    return; // Autoplay blocked — user hasn't interacted with the page
  }

  activePreview = { node, audio, progress: 0 };

  // Fade in over 400ms
  fadeIn(audio, 400, 0.6); // max volume 0.6 — subtle, not jarring

  // Stop after 30 seconds (Spotify preview cap)
  setTimeout(() => {
    if (activePreview?.node.id === node.id) {
      fadeOutAndStop(audio);
      activePreview = null;
    }
  }, 30000);

  // Update progress for the hover card waveform
  audio.addEventListener('timeupdate', () => {
    if (activePreview?.node.id === node.id) {
      activePreview.progress = audio.currentTime / 30;
      updatePreviewProgress(activePreview.progress);
    }
  });
}

async function fetchPreviewUrl(artistId: string): Promise<string | null> {
  // Fetch the artist's top track from Spotify and return its preview URL
  const res  = await fetch(`/api/artist/${artistId}/preview`);
  const data = await res.json();
  return data.previewUrl ?? null;
}

function fadeIn(audio: HTMLAudioElement, durationMs: number, targetVolume: number) {
  const steps    = 20;
  const interval = durationMs / steps;
  const step     = targetVolume / steps;
  let   current  = 0;

  const timer = setInterval(() => {
    current += step;
    audio.volume = Math.min(current, targetVolume);
    if (current >= targetVolume) clearInterval(timer);
  }, interval);
}

export function fadeOutAndStop(audio: HTMLAudioElement | null): Promise<void> {
  if (!audio) return Promise.resolve();
  return new Promise(resolve => {
    const startVolume = audio.volume;
    const steps       = 15;
    const interval    = 250 / steps;
    const step        = startVolume / steps;

    const timer = setInterval(() => {
      audio.volume = Math.max(audio.volume - step, 0);
      if (audio.volume <= 0) {
        clearInterval(timer);
        audio.pause();
        audio.currentTime = 0;
        resolve();
      }
    }, interval);
  });
}
```

### Preview API Route

```typescript
// src/app/api/artist/[id]/preview/route.ts

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const artistId    = params.id;
  const accessToken = session.spotifyAccessToken;

  // Get artist's top track
  const topTracksData = await spotifyFetch(
    `/artists/${artistId}/top-tracks?market=${session.user.country || 'US'}`,
    accessToken
  );

  const tracks = topTracksData.tracks || [];
  // Find first track with a preview URL
  const trackWithPreview = tracks.find(
    (t: SpotifyTrack) => t.preview_url
  );

  if (!trackWithPreview) {
    return Response.json({ previewUrl: null });
  }

  return Response.json(
    { previewUrl: trackWithPreview.preview_url },
    {
      headers: {
        // Cache preview URLs for 24 hours — they don't change often
        'Cache-Control': 'public, max-age=86400',
      },
    }
  );
}
```

### Frontier Hover Card — Enhanced for Phase 2

The hover card in Phase 2 shows additional context for frontier nodes: which of the user's explored artists led to this recommendation, and the audio preview controls.

```tsx
// ArtistHoverCard.tsx — additions for frontier nodes

function FrontierHoverCard({ node, adjacentExplored, previewProgress }: {
  node:              ArtistNode;
  adjacentExplored:  ArtistNode[];   // up to 3 explored artists that led here
  previewProgress:   number;         // 0-1, driven by audio playback
}) {
  return (
    <div style={{ /* existing card styles */ }}>

      {/* Genre pill — same as Phase 1 */}
      <GenrePill genre={node.genre} color={node.genreColor} />

      {/* Artist name */}
      <div style={{ fontSize: 15, fontWeight: 500, color: '#0d0d18', marginBottom: 4 }}>
        {node.name}
      </div>

      {/* "Because you listen to..." — the connection */}
      {adjacentExplored.length > 0 && (
        <div style={{
          fontSize:     11,
          color:        'rgba(0,0,0,0.35)',
          marginBottom: 12,
          lineHeight:   1.4,
        }}>
          Because you know{' '}
          {adjacentExplored.slice(0, 2).map(a => a.name).join(' and ')}
        </div>
      )}

      {/* Divider */}
      <div style={{ height: 1, background: 'rgba(0,0,0,0.06)', margin: '0 0 12px' }} />

      {/* Audio preview indicator */}
      <div style={{
        display:     'flex',
        alignItems:  'center',
        gap:         8,
        marginBottom: 10,
      }}>
        {/* Playing indicator — three animated bars */}
        <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 16 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width:            3,
              background:       node.genreColor,
              opacity:          previewProgress > 0 ? 0.7 : 0.2,
              borderRadius:     1,
              height:           previewProgress > 0 ? `${8 + i * 4}px` : '4px',
              transition:       'height 200ms ease-out',
              animation:        previewProgress > 0
                ? `bar-bounce ${0.6 + i * 0.15}s ease-in-out infinite alternate`
                : 'none',
            }} />
          ))}
        </div>

        <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)' }}>
          {previewProgress > 0 ? 'Preview playing' : 'Hover to preview'}
        </span>
      </div>

      {/* Preview progress bar */}
      {previewProgress > 0 && (
        <div style={{
          height:       2,
          background:   'rgba(0,0,0,0.08)',
          borderRadius: 1,
          marginBottom: 12,
          overflow:     'hidden',
        }}>
          <div style={{
            height:     '100%',
            width:      `${previewProgress * 100}%`,
            background: node.genreColor,
            borderRadius: 1,
            transition: 'width 100ms linear',
          }} />
        </div>
      )}

      {/* Explore action */}
      <ExploreButton node={node} />

    </div>
  );
}
```

---

## 6. Explore Action — Marking as Explored

When a user decides to explore a frontier node, three things happen:
1. The node transitions from frontier to explored on the globe
2. The artist is added to the user's Spotify library (if they choose)
3. The frontier is recomputed to reflect the new explored territory

### Explore Button

```tsx
// src/components/globe/ExploreButton.tsx

type ExploreAction = 'add-to-spotify' | 'mark-explored';

function ExploreButton({ node }: { node: ArtistNode }) {
  const [status, setStatus] = useState<'idle' | 'adding' | 'done'>('idle');

  async function handleExplore(action: ExploreAction) {
    setStatus('adding');

    // 1. Trigger the globe node transition immediately (optimistic)
    useGlobeStore.getState().transitionNodeToExplored(node.id);

    try {
      // 2. Record exploration in the database
      await fetch('/api/user/explore', {
        method: 'POST',
        body: JSON.stringify({ artistId: node.id, action }),
        headers: { 'Content-Type': 'application/json' },
      });

      // 3. If adding to Spotify library, open Spotify artist page
      if (action === 'add-to-spotify') {
        window.open(`https://open.spotify.com/artist/${node.id}`, '_blank');
      }

      setStatus('done');
    } catch {
      // Revert optimistic update if API fails
      useGlobeStore.getState().revertNodeTransition(node.id);
      setStatus('idle');
    }
  }

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <button
        onClick={() => handleExplore('add-to-spotify')}
        disabled={status !== 'idle'}
        style={{
          flex:           1,
          background:     '#000000',
          color:          '#ffffff',
          border:         'none',
          borderRadius:   100,
          padding:        '8px 0',
          fontSize:       12,
          fontWeight:     500,
          cursor:         'pointer',
          fontFamily:     "'Geist', 'Inter', sans-serif",
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          gap:            6,
        }}
      >
        <SpotifyIcon size={12} />
        {status === 'adding' ? 'Adding…' : status === 'done' ? 'Added' : 'Open in Spotify'}
      </button>

      <button
        onClick={() => handleExplore('mark-explored')}
        disabled={status !== 'idle'}
        style={{
          background:   'rgba(0,0,0,0.06)',
          color:        'rgba(0,0,0,0.55)',
          border:       'none',
          borderRadius: 100,
          padding:      '8px 12px',
          fontSize:     12,
          cursor:       'pointer',
          fontFamily:   "'Geist', 'Inter', sans-serif",
        }}
      >
        I know this
      </button>
    </div>
  );
}
```

### Node Transition in Globe Store

```typescript
// In globeStore.ts — add these actions:

transitionNodeToExplored: (artistId: string) => {
  set(state => {
    const nodeIndex = state.nodes.findIndex(n => n.id === artistId);
    if (nodeIndex === -1) {
      // Node was a frontier node — move from frontierNodes to nodes
      const frontierIndex = state.frontierNodes.findIndex(n => n.id === artistId);
      if (frontierIndex === -1) return state;

      const frontierNode = state.frontierNodes[frontierIndex];
      const newExploredNode: ArtistNode = {
        ...frontierNode,
        state:        'newly-explored',
        listenWeight: 0.5,   // default weight for manually explored nodes
      };

      return {
        nodes:         [...state.nodes, newExploredNode],
        frontierNodes: state.frontierNodes.filter((_, i) => i !== frontierIndex),
        // Trigger expansion animation
        expansionEvent: { nodeId: artistId, timestamp: Date.now() },
      };
    }
    return state;
  });
},
```

### Explore API Route

```typescript
// src/app/api/user/explore/route.ts

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const { artistId, action } = await request.json();

  // Record the exploration
  await db.exploredArtist.upsert({
    where:  { userId_artistId: { userId: session.user.spotifyId, artistId } },
    update: { lastExploredAt: new Date(), source: action },
    create: {
      userId:         session.user.spotifyId,
      artistId,
      source:         action,
      exploredAt:     new Date(),
      lastExploredAt: new Date(),
    },
  });

  // Trigger async frontier recompute (background job)
  // Don't await — client doesn't need to wait for this
  recomputeFrontierForNewExploration(
    session.user.spotifyId,
    artistId,
    session.spotifyAccessToken
  ).catch(console.error);

  return Response.json({ status: 'ok' });
}

async function recomputeFrontierForNewExploration(
  userId: string,
  newlyExploredArtistId: string,
  accessToken: string
): Promise<void> {
  // Fetch the full explored set (now includes the newly explored artist)
  const user = await db.user.findUnique({
    where:  { spotifyId: userId },
    select: { globeData: true },
  });

  const allExplored = [
    ...(user?.globeData as ArtistNode[] || []),
    { id: newlyExploredArtistId } as ArtistNode,
  ];

  await computeAndStoreFrontier(userId, allExplored, accessToken);
}
```

---


### Exploration Depth

Phase 2 records that a frontier artist was explored.

Future phases may track deeper engagement signals:

- Repeated listens
- Saves
- Playlist additions
- Library additions
- Return listens over time

Phase 2 intentionally does not differentiate between shallow and deep exploration.

All explored artists are treated equally.

This will be expanded in a future phase.


## 7. Taste Adventurousness Visualisation

A single visual indicator showing how spread out vs concentrated the user's taste is — and how it is changing. Expressed spatially and narratively, never as a score.

### The Adventurousness Metric

```typescript
// src/lib/metrics/adventurousness.ts

interface AdventurnousnessMetric {
  spread:         number;     // 0.0-1.0 (how spread out nodes are on globe)
  genreCount:     number;     // number of distinct genre biomes with ≥3 nodes
  exploredCount:  number;     // total explored artists
  frontierCount:  number;     // current frontier size
  label:          string;     // emotional vocabulary description
  trajectory:     'expanding' | 'stable' | 'focusing';  // direction of change
}

export function computeAdventurousness(
  nodes:           ArtistNode[],
  previousSnapshot: ArtistNode[] | null
): AdventurnousnessMetric {

  const homeRegion   = computeHomeRegion(nodes);
  const genreGroups  = groupBy(nodes, n => n.genre);
  const activeGenres = Object.values(genreGroups).filter(g => g.length >= 3).length;
  const spread       = homeRegion.spread;

  // Compare to previous snapshot to determine trajectory
  let trajectory: AdventurnousnessMetric['trajectory'] = 'stable';
  if (previousSnapshot) {
    const prevSpread = computeHomeRegion(previousSnapshot).spread;
    if (spread > prevSpread + 0.05)      trajectory = 'expanding';
    else if (spread < prevSpread - 0.05) trajectory = 'focusing';
  }

  // Emotional vocabulary label
  let label: string;
  if (spread < 0.20)      label = 'deeply focused — every listen reinforces a specific world';
  else if (spread < 0.35) label = 'rooted with curiosity at the edges';
  else if (spread < 0.55) label = 'comfortably wide — familiar anchors with real range';
  else if (spread < 0.70) label = 'genuinely adventurous — spanning multiple worlds';
  else                    label = 'extraordinarily wide — few people range this far';

  return {
    spread,
    genreCount:    activeGenres,
    exploredCount: nodes.length,
    frontierCount: 0, // filled in when frontier is known
    label,
    trajectory,
  };
}
```

### Displaying Adventurousness

Not a number. Not a percentage. A visual representation in the UI — a small horizontal bar that fills from left (focused) to right (wide), with the user's position as a glowing dot. Below it, the emotional vocabulary label.

```tsx
// src/components/globe/AdventurnousnessIndicator.tsx

function AdventurnousnessIndicator({
  metric
}: { metric: AdventurnousnessMetric }) {
  return (
    <div style={{
      position:   'fixed',
      bottom:     32,
      left:       32,
      width:      200,
      fontFamily: "'Geist', 'Inter', sans-serif",
    }}>

      {/* Spread bar */}
      <div style={{
        position:    'relative',
        height:      2,
        background:  'rgba(0,0,0,0.10)',
        borderRadius: 1,
        marginBottom: 10,
      }}>
        {/* Gradient fill up to user's position */}
        <div style={{
          position:     'absolute',
          left:         0,
          top:          0,
          height:       '100%',
          width:        `${metric.spread * 100}%`,
          background:   'rgba(0,0,0,0.25)',
          borderRadius: 1,
          transition:   'width 600ms ease-out',
        }} />

        {/* User position dot */}
        <div style={{
          position:    'absolute',
          top:         -3,
          left:        `calc(${metric.spread * 100}% - 4px)`,
          width:       8,
          height:      8,
          borderRadius: '50%',
          background:  '#0d0d18',
          transition:  'left 600ms ease-out',
        }} />

        {/* Labels: "focused" and "wide" at extremes */}
        <span style={{
          position: 'absolute',
          top:      8,
          left:     0,
          fontSize: 9,
          color:    'rgba(0,0,0,0.25)',
          letterSpacing: '0.08em',
        }}>
          FOCUSED
        </span>
        <span style={{
          position:  'absolute',
          top:       8,
          right:     0,
          fontSize:  9,
          color:     'rgba(0,0,0,0.25)',
          letterSpacing: '0.08em',
        }}>
          WIDE
        </span>
      </div>

      {/* Emotional label */}
      <div style={{
        marginTop: 20,
        fontSize:  11,
        color:     'rgba(0,0,0,0.38)',
        lineHeight: 1.5,
      }}>
        {metric.label}
      </div>

      {/* Trajectory indicator — only show if changing */}
      {metric.trajectory !== 'stable' && (
        <div style={{
          marginTop: 6,
          fontSize:  10,
          color:     metric.trajectory === 'expanding'
            ? 'rgba(0,100,0,0.50)'
            : 'rgba(0,0,100,0.40)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}>
          {metric.trajectory === 'expanding' ? '↗ Expanding' : '↘ Focusing'}
        </div>
      )}

    </div>
  );
}
```

---

## 8. Geographic Gap Detection

The globe metaphor enables something no other music app does: showing users which *geographic regions of the world* they have never musically explored. This is not about real-world geography for its own sake — it's a powerful discovery prompt.

### Continent Coverage Computation

```typescript
// src/lib/metrics/geographicCoverage.ts

// Map each globe genre biome to a real-world continent
// These mappings are approximate and intentionally broad
const BIOME_TO_CONTINENT: Record<GlobeGenreKey, string[]> = {
  hiphop:       ['North America', 'Africa'],
  rnb:          ['North America', 'Africa'],
  electronic:   ['Europe', 'North America'],
  ambient:      ['Europe', 'North America'],
  jazz:         ['North America', 'Africa'],
  classical:    ['Europe'],
  folk:         ['North America', 'Europe'],
  rock:         ['North America', 'Europe', 'Oceania'],
  metal:        ['Europe', 'North America'],
  pop:          ['North America', 'Europe', 'Asia'],
  experimental: ['Europe', 'North America', 'Asia'],
};

// Additionally, track specific regional music scenes
// that are strongly geographically associated
const REGIONAL_SCENES = [
  { id: 'afrobeats',   label: 'West Africa',     anchor: { lat: 7,   lng: 3  }, genre: 'rnb'    },
  { id: 'kpop',        label: 'South Korea',      anchor: { lat: 37,  lng: 127}, genre: 'pop'    },
  { id: 'latin',       label: 'Latin America',    anchor: { lat: -10, lng: -60}, genre: 'pop'    },
  { id: 'samba',       label: 'Brazil',           anchor: { lat: -15, lng: -47}, genre: 'folk'   },
  { id: 'reggae',      label: 'Caribbean',        anchor: { lat: 18,  lng: -77}, genre: 'rnb'    },
  { id: 'bollywood',   label: 'South Asia',       anchor: { lat: 20,  lng: 78 }, genre: 'pop'    },
  { id: 'highlife',    label: 'Ghana / Nigeria',  anchor: { lat: 6,   lng: 2  }, genre: 'folk'   },
  { id: 'jazzafrica',  label: 'South Africa',     anchor: { lat: -30, lng: 25 }, genre: 'jazz'   },
  { id: 'mandopop',    label: 'East Asia',        anchor: { lat: 31,  lng: 121}, genre: 'pop'    },
  { id: 'nordicmetal', label: 'Scandinavia',      anchor: { lat: 60,  lng: 15 }, genre: 'metal'  },
];

interface GeoGap {
  region:         string;
  gapType:        'continent' | 'scene';
  anchorLat:      number;
  anchorLng:      number;
  representative: ArtistNode[];  // 2-3 frontier nodes that fill this gap
}

export function detectGeographicGaps(
  exploredNodes:   ArtistNode[],
  frontierNodes:   ArtistNode[]
): GeoGap[] {
  // Determine which regions the user has explored based on genre biomes
  const exploredGenres = new Set(exploredNodes.map(n => n.genre));

  const gaps: GeoGap[] = [];

  // Check regional scenes
  for (const scene of REGIONAL_SCENES) {
    const sceneGenre    = scene.genre as GlobeGenreKey;
    const hasInRegion   = exploredNodes.some(n =>
      n.genre === sceneGenre &&
      globeDistance(n, { lat: scene.anchor.lat, lng: scene.anchor.lng }) < 25
    );

    if (!hasInRegion) {
      // Find frontier nodes near this region
      const nearbyFrontier = frontierNodes
        .filter(n =>
          n.genre === sceneGenre &&
          globeDistance(n, { lat: scene.anchor.lat, lng: scene.anchor.lng }) < 30
        )
        .slice(0, 3);

      if (nearbyFrontier.length > 0) {
        gaps.push({
          region:         scene.label,
          gapType:        'scene',
          anchorLat:      scene.anchor.lat,
          anchorLng:      scene.anchor.lng,
          representative: nearbyFrontier,
        });
      }
    }
  }

  return gaps.slice(0, 5); // max 5 gap indicators
}
```


Future Expansion

Geographic gaps are one form of discovery prompt.

Future phases may introduce:

- Scene gaps
- Movement gaps
- Label gaps
- Historical gaps

The geographic implementation should therefore be considered the first version of a broader discovery-gap system.


### Geographic Gap Indicators on Globe

Render gap regions as very dim, text-only labels floating just outside the sphere boundary, in the unexplored region. These are different from the genre labels — they're invitations, not identifiers.

```typescript
// Add geographic gap labels as globe HTML elements
globe
  .htmlElementsData(geographicGaps)
  .htmlElement(gap => {
    const el        = document.createElement('div');
    el.style.cssText = `
      font-family: 'Geist', 'Inter', sans-serif;
      font-size: 9px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: rgba(0,0,0,0.18);
      white-space: nowrap;
      pointer-events: none;
      user-select: none;
    `;
    el.textContent  = `↳ ${gap.region}`;
    return el;
  });
```

---

## 9. Frontier Panel — The Discovery Surface

A minimal slide-in panel accessible from the globe that shows the user's frontier in a browseable format. Not a replacement for the globe — a companion surface for when users want to browse rather than explore spatially.

### Panel Design

```
Trigger:        A small "Frontier" button, bottom-right of the globe
                (distinct from the Share button)
Position:       Slides in from the right, 320px wide, full viewport height
Background:     rgba(255,255,255,0.94), backdrop-filter blur(20px)
Border:         1px solid rgba(0,0,0,0.06) on the left edge only

Content:
  Header:       "Your frontier" in 14px, plus frontier count
  Sections:     Grouped by genre biome
                Each section: genre label pill + 3-5 artist rows
  Artist row:   40px tall, artist image (circle, 28px), name, mood label
                Hover: plays preview
                Tap: opens in Spotify + marks explored
  Footer:       "Showing 80 of [total] frontier artists"
```

```tsx
// src/components/globe/FrontierPanel.tsx

function FrontierPanel({
  frontierNodes,
  onClose,
}: {
  frontierNodes: ArtistNode[];
  onClose:       () => void;
}) {
  const [open, setOpen]        = useState(false);
  const byGenre                = groupBy(frontierNodes, n => n.genre);

  useEffect(() => {
    // Animate in after mount
    requestAnimationFrame(() => setOpen(true));
  }, []);

  return (
    <div style={{
      position:    'fixed',
      top:         0,
      right:       0,
      width:       320,
      height:      '100vh',
      background:  'rgba(255,255,255,0.94)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      borderLeft:  '1px solid rgba(0,0,0,0.06)',
      transform:   open ? 'translateX(0)' : 'translateX(100%)',
      transition:  'transform 300ms cubic-bezier(0.4, 0, 0.2, 1)',
      zIndex:      150,
      display:     'flex',
      flexDirection: 'column',
      fontFamily:  "'Geist', 'Inter', sans-serif",
    }}>

      {/* Header */}
      <div style={{
        padding:        '20px 20px 16px',
        borderBottom:   '1px solid rgba(0,0,0,0.06)',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#0d0d18' }}>
            Your frontier
          </div>
          <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)', marginTop: 2 }}>
            {frontierNodes.length} artists you haven't explored
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'rgba(0,0,0,0.35)', fontSize: 18, lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 0' }}>
        {Object.entries(byGenre).map(([genre, artists]) => (
          <div key={genre} style={{ marginBottom: 8 }}>

            {/* Genre header */}
            <div style={{
              padding:       '4px 20px 8px',
              display:       'flex',
              alignItems:    'center',
              gap:           8,
            }}>
              <div style={{
                width:        8,
                height:       8,
                borderRadius: '50%',
                background:   GLOBE_GENRES[genre as GlobeGenreKey].color,
                opacity:      0.7,
              }} />
              <span style={{
                fontSize:      10,
                fontWeight:    500,
                letterSpacing: '0.10em',
                textTransform: 'uppercase',
                color:         'rgba(0,0,0,0.35)',
              }}>
                {GLOBE_GENRES[genre as GlobeGenreKey].label}
              </span>
            </div>

            {/* Artist rows */}
            {(artists as ArtistNode[]).slice(0, 5).map(artist => (
              <FrontierArtistRow key={artist.id} artist={artist} />
            ))}

          </div>
        ))}
      </div>

    </div>
  );
}

function FrontierArtistRow({ artist }: { artist: ArtistNode }) {
  const [hovering, setHovering] = useState(false);

  return (
    <div
      onMouseEnter={() => { setHovering(true); playFrontierPreview(artist); }}
      onMouseLeave={() => { setHovering(false); }}
      style={{
        display:     'flex',
        alignItems:  'center',
        gap:         12,
        padding:     '8px 20px',
        background:  hovering ? 'rgba(0,0,0,0.03)' : 'transparent',
        cursor:      'pointer',
        transition:  'background 100ms',
      }}
    >
      {/* Artist image */}
      <div style={{
        width:        28,
        height:       28,
        borderRadius: '50%',
        background:   `${artist.genreColor}22`,
        overflow:     'hidden',
        flexShrink:   0,
      }}>
        {artist.imageUrl && (
          <img src={artist.imageUrl} width={28} height={28} style={{ borderRadius: '50%' }} />
        )}
      </div>

      {/* Name + mood */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize:     13,
          fontWeight:   400,
          color:        '#0d0d18',
          whiteSpace:   'nowrap',
          overflow:     'hidden',
          textOverflow: 'ellipsis',
        }}>
          {artist.name}
        </div>
      </div>

      {/* Explore on click */}
      <button
        onClick={() => {
          window.open(`https://open.spotify.com/artist/${artist.id}`, '_blank');
          useGlobeStore.getState().transitionNodeToExplored(artist.id);
        }}
        style={{
          background:   'none',
          border:       '1px solid rgba(0,0,0,0.12)',
          borderRadius: 100,
          padding:      '3px 10px',
          fontSize:     11,
          color:        'rgba(0,0,0,0.45)',
          cursor:       'pointer',
          whiteSpace:   'nowrap',
        }}
      >
        Explore
      </button>
    </div>
  );
}
```

---

## 10. Database Schema Changes

Add to the Prisma schema from Phase 1:

```prisma
// prisma/schema.prisma — additions for Phase 2

model User {
  // ... all Phase 1 fields unchanged ...

  // Phase 2 additions:
  frontierData       Json?    // ArtistNode[] — frontier nodes
  perimeterData      Json?    // PerimeterData[] — genre boundary perimeters
  frontierStatus     FrontierStatus @default(PENDING)
  frontierComputedAt DateTime?

  // Adventurousness snapshot for trajectory tracking
  adventurnousnessHistory Json?  // AdventurnousnessMetric[] — array of snapshots

  exploredArtists    ExploredArtist[]
}

enum FrontierStatus {
  PENDING
  COMPUTING
  COMPLETE
  FAILED
}

model ExploredArtist {
  id             String   @id @default(cuid())
  userId         String
  artistId       String   // Spotify artist ID
  source         String   // 'add-to-spotify' | 'mark-explored' | 'spotify-sync'
  exploredAt     DateTime @default(now())
  lastExploredAt DateTime @updatedAt

  user User @relation(fields: [userId], references: [spotifyId])

  @@unique([userId, artistId])
  @@index([userId])
}
```

```
npx prisma migrate dev --name phase2-frontier
```

---

## 11. API Routes

### `GET /api/user/frontier`

Returns frontier nodes and perimeter data for the authenticated user.

```typescript
// src/app/api/user/frontier/route.ts

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const user = await db.user.findUnique({
    where:  { spotifyId: session.user.spotifyId },
    select: {
      frontierData:      true,
      perimeterData:     true,
      frontierStatus:    true,
      frontierComputedAt: true,
    },
  });

  if (!user) return Response.json({ status: 'no_data' });

  if (user.frontierStatus === 'COMPUTING') {
    return Response.json({ status: 'computing' });
  }

  if (!user.frontierData) {
    // Trigger computation
    triggerFrontierComputation(session.user.spotifyId, session.spotifyAccessToken);
    return Response.json({ status: 'computing' });
  }

  return Response.json({
    status:            'ready',
    frontierNodes:     user.frontierData,
    perimeterData:     user.perimeterData,
    frontierComputedAt: user.frontierComputedAt,
  }, {
    headers: {
      'Cache-Control': 'private, max-age=1800', // 30 min cache
    },
  });
}
```

### `POST /api/user/explore`

Already specified in §6.

### `GET /api/artist/[id]/preview`

Already specified in §5.

---

## 12. Frontend State Changes

Add to Zustand store from Phase 1:

```typescript
// src/stores/globeStore.ts — additions for Phase 2

interface GlobeStore {
  // Phase 1 fields unchanged...

  // Phase 2 additions:
  frontierNodes:       ArtistNode[];
  perimeterData:       PerimeterData[];
  frontierPanelOpen:   boolean;
  previewingNode:      ArtistNode | null;
  previewProgress:     number;
  adventurousness:     AdventurnousnessMetric | null;
  expansionEvent:      { nodeId: string; timestamp: number } | null;
  geographicGaps:      GeoGap[];

  // Actions:
  setFrontierNodes:    (nodes: ArtistNode[]) => void;
  setPerimeterData:    (data: PerimeterData[]) => void;
  setFrontierPanelOpen:(open: boolean) => void;
  setPreviewingNode:   (node: ArtistNode | null) => void;
  setPreviewProgress:  (progress: number) => void;
  transitionNodeToExplored: (artistId: string) => void;
  revertNodeTransition:(artistId: string) => void;
}
```

### Data Loading Hook — Extended

```typescript
// src/hooks/useGlobeData.ts — add frontier loading

export function useGlobeData() {
  // ... Phase 1 polling logic unchanged ...

  // Load frontier data in parallel (non-blocking)
  useEffect(() => {
    async function loadFrontier() {
      const res  = await fetch('/api/user/frontier');
      const data = await res.json();

      if (data.status === 'ready') {
        setFrontierNodes(data.frontierNodes);
        setPerimeterData(data.perimeterData);
      } else if (data.status === 'computing') {
        // Poll until ready
        setTimeout(loadFrontier, 3000);
      }
    }

    // Start loading frontier after explored nodes are ready
    // Frontier is not required for initial render — loads progressively
    if (syncStatus === 'ready') {
      loadFrontier();
    }
  }, [syncStatus]);
}
```

---

## 13. Animations and Transitions

### Frontier Node Pulse

```css
@keyframes frontier-pulse {
  0%   { opacity: 0.28; transform: scale(1.0); }
  50%  { opacity: 0.45; transform: scale(1.08); }
  100% { opacity: 0.28; transform: scale(1.0); }
}

/* Applied to frontier node sprites: */
.frontier-node {
  animation: frontier-pulse 3.5s ease-in-out infinite;
  /* Stagger animation phase per node to prevent synchronized pulsing */
  animation-delay: calc(var(--node-index) * 0.4s);
}
```

In Three.js, implement the pulse by animating `material.opacity` in the RAF loop:

```typescript
// In the magnetic hover RAF loop — add frontier pulse:
frontierNodes.forEach((node, i) => {
  const phase     = (Date.now() / 3500 + i * 0.15) % 1;
  const pulse     = 0.28 + 0.17 * Math.sin(phase * Math.PI * 2);
  node.material.opacity = pulse;
});
```

### Node Transition: Frontier → Explored

When a frontier node is marked as explored, it plays a celebration animation:

```
Frame 0:    Frontier visual (ghost, 65% size, pulsing)
            Preview audio begins fading out
Frame 1-8:  Node scales up to 140% over 400ms
            Opacity transitions from 0.38 to 1.0
            Colour transitions from desaturated to full genre biome colour
            A brief particle burst (4-6 small dots) radiates from the node
Frame 8-20: Node scales back down from 140% to 100% over 800ms (eased)
            Particle burst fades out over 600ms
Frame 20+:  Node rests in explored state
            Genre perimeter redraws to include new node (800ms morph)
```

```typescript
function animateNodeExploration(
  mesh:        THREE.Mesh,
  targetColor: THREE.Color,
  onComplete:  () => void
) {
  const startTime  = Date.now();
  const startColor = (mesh.material as THREE.MeshBasicMaterial).color.clone();

  function tick() {
    const elapsed = Date.now() - startTime;

    // Phase 1: scale up (0-400ms)
    if (elapsed < 400) {
      const t      = elapsed / 400;
      const ease   = 1 - Math.pow(1 - t, 3); // cubic ease-out
      mesh.scale.setScalar(1 + 0.4 * ease);   // up to 1.4×
      (mesh.material as THREE.MeshBasicMaterial).opacity =
        0.38 + 0.62 * ease;

    // Phase 2: scale back down (400-1200ms)
    } else if (elapsed < 1200) {
      const t    = (elapsed - 400) / 800;
      const ease = 1 - Math.pow(1 - t, 2); // quad ease-out
      mesh.scale.setScalar(1.4 - 0.4 * ease);   // back to 1.0×
      (mesh.material as THREE.MeshBasicMaterial).opacity = 1.0;

    } else {
      mesh.scale.setScalar(1.0);
      onComplete();
      return; // stop RAF
    }

    // Colour interpolation throughout
    const t = Math.min(elapsed / 1200, 1);
    (mesh.material as THREE.MeshBasicMaterial).color
      .copy(startColor)
      .lerp(targetColor, t);

    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}
```

### Perimeter Morph Animation

When the genre perimeter expands to include a newly explored node:

```typescript
function morphPerimeter(
  oldPoints: PerimeterPoint[],
  newPoints: PerimeterPoint[],
  lineObject: THREE.Line,
  durationMs = 800
) {
  const startTime = Date.now();

  function tick() {
    const t    = Math.min((Date.now() - startTime) / durationMs, 1);
    const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

    // Interpolate each point
    const interpolated = oldPoints.map((old, i) => {
      const next = newPoints[i] || old;
      return {
        lat: old.lat + (next.lat - old.lat) * ease,
        lng: old.lng + (next.lng - old.lng) * ease,
      };
    });

    // Rebuild line geometry with interpolated points
    const positions = interpolated.map(p => {
      const pos = globe.getCoords(p.lat, p.lng, 0.002);
      return new THREE.Vector3(pos.x, pos.y, pos.z);
    });

    const curve    = new THREE.CatmullRomCurve3(positions, true);
    const pts      = curve.getPoints(positions.length * 8);
    const geometry = new THREE.BufferGeometry().setFromPoints(pts);
    lineObject.geometry.dispose();
    lineObject.geometry = geometry;

    if (t < 1) requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}
```

---

## 14. The Expansion Moment — Shareable Event

When a user marks a frontier node as explored and their universe visibly expands, this is the second major shareable moment of the product (after Phase 1's initial reveal).

The app should automatically prompt sharing after this moment — not intrusively, but as a gentle offer.

### Expansion Share Card

Triggered 1.5 seconds after the exploration animation completes:

```tsx
function ExpansionSharePrompt({
  newArtist:   ArtistNode;
  onShare:     () => void;
  onDismiss:   () => void;
}) {
  return (
    <div style={{
      position:       'fixed',
      bottom:         80,
      left:           '50%',
      transform:      'translateX(-50%)',
      background:     'rgba(255,255,255,0.92)',
      backdropFilter: 'blur(16px)',
      border:         '1px solid rgba(0,0,0,0.06)',
      borderRadius:   16,
      padding:        '14px 20px',
      display:        'flex',
      alignItems:     'center',
      gap:            14,
      boxShadow:      '0 4px 24px rgba(0,0,0,0.09)',
      fontFamily:     "'Geist', 'Inter', sans-serif",
      animation:      'slide-up 300ms ease-out',
      zIndex:         200,
    }}>

      {/* Small genre colour dot */}
      <div style={{
        width:        10,
        height:       10,
        borderRadius: '50%',
        background:   newArtist.genreColor,
        flexShrink:   0,
      }} />

      {/* Text */}
      <div>
        <div style={{ fontSize: 13, color: '#0d0d18', fontWeight: 500 }}>
          Your universe just expanded
        </div>
        <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.40)', marginTop: 2 }}>
          {newArtist.name} is now part of your world
        </div>
      </div>

      {/* Share button */}
      <button
        onClick={onShare}
        style={{
          background:   'rgba(0,0,0,0.07)',
          border:       'none',
          borderRadius: 100,
          padding:      '6px 14px',
          fontSize:     12,
          color:        'rgba(0,0,0,0.60)',
          cursor:       'pointer',
          whiteSpace:   'nowrap',
          fontFamily:   "'Geist', 'Inter', sans-serif",
        }}
      >
        Share
      </button>

      {/* Dismiss */}
      <button
        onClick={onDismiss}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'rgba(0,0,0,0.25)', fontSize: 16, padding: '0 4px',
          fontFamily: "'Geist', 'Inter', sans-serif",
        }}
      >
        ×
      </button>

    </div>
  );
}
```

---


## Long-Term Graph Vision

The ORCA graph is ultimately intended to represent the structure of music itself rather than only artist relationships.

Future graph entities may include:

- Genres
- Scenes
- Movements
- Labels
- Albums

Phase 2 does not visualise these entities.

However, all graph infrastructure introduced during Phase 2 should be implemented in a way that allows additional node types to be introduced without major architectural changes.

Spotify listening history remains the source of explored territory.

The frontier system represents unexplored territory adjacent to that explored territory.

---

## 15. What Does NOT Change

```
✓  All Phase 1 systems — Spotify OAuth, data sync, node processing
✓  globe.gl canvas and all visual settings
✓  Translucent glass sphere appearance
✓  Explored node rendering (Phase 1 visual — unchanged)
✓  Genre anchor positions and scatter system
✓  Magnetic hover effect
✓  Arc rendering and arc culling
✓  Manual drag orbit controls
✓  Artist image loading pipeline (IMAGE_LOADING_SPEC.md)
✓  Light mode colour system (#f0f0f5 background)
✓  Artist hover card for explored nodes (Phase 1 version)
✓  Share screenshot from Phase 1
✓  All performance limits (300 nodes max, 80 arcs max)
```

---

## 16. Phase 2 Completion Checklist

### Frontier Node System
- [ ] `fetchRelatedArtists()` implemented with error handling
- [ ] `computeFrontierScore()` implemented and tested
- [ ] `selectFrontierNodes()` — 80 max, 15 per biome cap
- [ ] Frontier nodes have desaturated pastel colour (not full biome colour)
- [ ] Frontier node size is 65% of equivalent explored size
- [ ] Frontier pulse animation running (3.5s, staggered per node)
- [ ] Frontier nodes NOT rendering for artists the user has explored
- [ ] `buildFrontierNodes()` running after Spotify sync completes
- [ ] Frontier data stored in DB (`frontierData` JSON field)

### Genre Boundary Perimeter
- [ ] `computeConvexHull()` producing correct hulls for node clusters
- [ ] `computeGenrePerimeter()` expanding hull by 4 degrees
- [ ] Perimeter renders as dashed SVG line on globe surface
- [ ] Perimeter opacity oscillates between 0.15 and 0.35 (4s cycle)
- [ ] Perimeters only render for genres with ≥3 explored nodes
- [ ] Perimeter correctly redraws after explore action

### Spotify Preview
- [ ] `/api/artist/[id]/preview` route returning Spotify preview URLs
- [ ] Preview auto-plays on 600ms hover of frontier node (not explored)
- [ ] Fade-in over 400ms to volume 0.6
- [ ] Preview stops and fades out on mouse leave
- [ ] Preview capped at 30 seconds
- [ ] No preview if user hasn't interacted with page (autoplay policy)
- [ ] Preview URL cached for 24 hours

### Frontier Hover Card
- [ ] "Because you know [Artist]" connection line showing
- [ ] Audio preview indicator (animated bars when playing)
- [ ] Progress bar filling during playback
- [ ] "Open in Spotify" button working
- [ ] "I know this" button working
- [ ] Both buttons trigger `transitionNodeToExplored()`

### Explore Action
- [ ] `/api/user/explore` route recording exploration in DB
- [ ] `ExploredArtist` table created and migrating correctly
- [ ] Optimistic UI update (node transitions immediately, not after API)
- [ ] Revert on API failure
- [ ] Background frontier recompute triggers after exploration
- [ ] `newly-explored` state: 1.4× size, full colour, no pulse

### Exploration Animation
- [ ] Scale-up phase: 0-400ms, cubic ease-out, up to 1.4×
- [ ] Scale-down phase: 400-1200ms, back to 1.0×
- [ ] Colour transition: desaturated → full biome colour
- [ ] Opacity transition: 0.38 → 1.0
- [ ] Particle burst: 4-6 dots radiating from node
- [ ] Perimeter morphs to include new node over 800ms

### Taste Adventurousness
- [ ] `computeAdventurousness()` producing correct spread values
- [ ] `AdventurnousnessIndicator` component rendering bottom-left
- [ ] Spread bar with user position dot
- [ ] Emotional vocabulary label updating
- [ ] Trajectory indicator showing 'expanding' / 'focusing' correctly
- [ ] Snapshots stored in `adventurnousnessHistory` for trajectory

### Geographic Gaps
- [ ] `detectGeographicGaps()` identifying ≤5 unexplored regions
- [ ] Gap labels rendering as dim text on globe surface
- [ ] Labels positioned outside explored territory, not inside it

### Frontier Panel
- [ ] Panel trigger button visible bottom-right
- [ ] Panel slides in from right (300ms transition)
- [ ] Artists grouped by genre biome
- [ ] Artist rows show image, name, explore button
- [ ] Hover on row triggers preview (same fade-in logic as globe)
- [ ] Explore button triggers `transitionNodeToExplored()` + Spotify open
- [ ] Panel dismiss closes and slides out

### Expansion Share Moment
- [ ] `ExpansionSharePrompt` appears 1.5s after exploration animation
- [ ] Share captures current globe state (same as Phase 1 share)
- [ ] Dismiss hides prompt permanently for that session

### Database and API
- [ ] Prisma migration applied (`phase2-frontier`)
- [ ] `FrontierStatus` enum working
- [ ] `frontierComputedAt` timestamp stored
- [ ] `GET /api/user/frontier` returns correct data shape
- [ ] `POST /api/user/explore` recording to `ExploredArtist`
- [ ] Frontier polling (3s interval) until `status === 'ready'`

### Quality Bar
- [ ] Frontier loads within 5 seconds of globe ready on first visit
- [ ] Preview plays within 700ms of hovering a frontier node
- [ ] Exploration animation feels satisfying, not janky
- [ ] No synchronised pulsing (all frontier nodes out of phase)
- [ ] Perimeter visible but not distracting on genres with many nodes
- [ ] Tested with a user who has very few (< 20) Spotify artists
- [ ] Tested with a user who has very many (> 200) Spotify artists

---

*Last updated: [DATE]*
*Phase status: NOT STARTED*
*Depends on: Phase 1 complete*

> **For AI Assistants:** Phase 1 must be fully complete before starting Phase 2. Start with Section 4 (frontier data pipeline) → Section 2 (frontier node system) → Section 5 (preview integration) → Section 6 (explore action) → Section 3 (perimeter). The frontier scoring and genre mapping in Section 2 is the most critical code — incorrect scoring leads to poor frontier recommendations. Do not modify any globe visual settings. Do not change explored node behaviour. The translucent glass sphere stays exactly as it is.
