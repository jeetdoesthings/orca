/**
 * Genre Normaliser for MusicBrainz data.
 *
 * MusicBrainz returns verbose, inconsistent genre/tag strings
 * (e.g. "classic rock", "album rock", "heartland rock").
 * This module maps them to 11 stable internal genre keys used
 * by the layout engine, color system, and arc balancer.
 */

// ──────────────────────────────────────────────────
// Internal genre keys (the only values downstream systems see)
// ──────────────────────────────────────────────────

export type InternalGenre =
  | 'hip-hop'
  | 'trap'
  | 'drill'
  | 'edm'
  | 'house'
  | 'techno'
  | 'trance'
  | 'drum-and-bass'
  | 'pop'
  | 'dance-pop'
  | 'rock'
  | 'alternative-rock'
  | 'indie-rock'
  | 'punk'
  | 'metal'
  | 'rnb'
  | 'soul'
  | 'funk'
  | 'folk'
  | 'country'
  | 'ambient'
  | 'classical'
  | 'jazz'
  | 'latin'
  | 'world-music';

// ──────────────────────────────────────────────────
// Verbose tag → internal key mapping
// ──────────────────────────────────────────────────

export const GENRE_NORMALISER: Record<string, InternalGenre> = {
  // Hip-Hop & Rap
  'hip-hop': 'hip-hop', 'hip hop': 'hip-hop', 'rap': 'hip-hop',
  'trap': 'trap', 'trap music': 'trap',
  'drill': 'drill', 'uk drill': 'drill', 'chicago drill': 'drill',

  // Electronic
  'edm': 'edm', 'electronic dance music': 'edm', 'electronic': 'edm', 'electronica': 'edm',
  'house': 'house', 'deep house': 'house', 'progressive house': 'house', 'acid house': 'house',
  'techno': 'techno', 'minimal techno': 'techno',
  'trance': 'trance', 'psytrance': 'trance',
  'drum and bass': 'drum-and-bass', 'drum & bass': 'drum-and-bass', 'dnb': 'drum-and-bass',

  // Pop
  'pop': 'pop', 'indie pop': 'pop', 'art pop': 'pop', 'synthpop': 'pop',
  'dance pop': 'dance-pop', 'dance-pop': 'dance-pop',

  // Rock
  'rock': 'rock', 'classic rock': 'rock', 'hard rock': 'rock',
  'alternative rock': 'alternative-rock', 'alternative': 'alternative-rock', 'alt-rock': 'alternative-rock',
  'indie rock': 'indie-rock', 'indie': 'indie-rock',
  'punk': 'punk', 'punk rock': 'punk', 'post-punk': 'punk',
  'metal': 'metal', 'heavy metal': 'metal', 'death metal': 'metal', 'black metal': 'metal', 'thrash metal': 'metal',

  // Soul & Groove
  'r&b': 'rnb', 'rnb': 'rnb', 'rhythm and blues': 'rnb', 'contemporary r&b': 'rnb',
  'soul': 'soul', 'neo soul': 'soul', 'neo-soul': 'soul',
  'funk': 'funk', 'g-funk': 'funk',

  // Acoustic
  'folk': 'folk', 'traditional folk': 'folk', 'americana': 'folk',
  'country': 'country', 'bluegrass': 'country',

  // Atmospheric
  'ambient': 'ambient', 'dark ambient': 'ambient', 'drone': 'ambient',
  'classical': 'classical', 'neoclassical': 'classical', 'modern classical': 'classical', 'orchestral': 'classical',
  'jazz': 'jazz', 'bebop': 'jazz', 'cool jazz': 'jazz', 'jazz fusion': 'jazz',

  // Global
  'latin': 'latin', 'reggaeton': 'latin', 'bossa nova': 'latin',
  'world music': 'world-music', 'world': 'world-music', 'afrobeat': 'world-music',
};

// ──────────────────────────────────────────────────
// Genre Anchors — lat/lng positions on the globe
// ──────────────────────────────────────────────────

export const GENRE_ANCHORS: Record<InternalGenre, { lat: number; lng: number }> = {
  'hip-hop':          { lat:  25, lng: -70 },
  'trap':             { lat:  15, lng: -85 },
  'drill':            { lat:  35, lng: -55 },
  'edm':              { lat:  52, lng: -10 },
  'house':            { lat:  42, lng:   0 },
  'techno':           { lat:  55, lng:  20 },
  'trance':           { lat:  62, lng:  -5 },
  'drum-and-bass':    { lat:  48, lng: -25 },
  'pop':              { lat:   5, lng:  10 },
  'dance-pop':        { lat:  -5, lng: -10 },
  'rock':             { lat: -15, lng: -35 },
  'alternative-rock': { lat: -22, lng: -20 },
  'indie-rock':       { lat:  -8, lng: -50 },
  'punk':             { lat: -28, lng: -65 },
  'metal':            { lat: -40, lng: -45 },
  'rnb':              { lat:  12, lng: -40 },
  'soul':             { lat:   0, lng: -30 },
  'funk':             { lat:  -8, lng: -45 },
  'folk':             { lat: -12, lng:  45 },
  'country':          { lat: -25, lng:  35 },
  'ambient':          { lat:  40, lng:  55 },
  'classical':        { lat: -55, lng:  60 },
  'jazz':             { lat: -42, lng:  10 },
  'latin':            { lat:  -2, lng: -75 },
  'world-music':      { lat:  20, lng:  50 },
};

// ──────────────────────────────────────────────────
// Genre Colors — premium cinematic palette (light mode)
// ──────────────────────────────────────────────────

export const GENRE_COLORS: Record<InternalGenre, string> = {
  'hip-hop':          '#C95C8A',
  'trap':             '#D46B8A',
  'drill':            '#A85C6B',
  'edm':              '#6BC7D9',
  'house':            '#5FB5D4',
  'techno':           '#8B9FD4',
  'trance':           '#5FC4C4',
  'drum-and-bass':    '#3EAEB1',
  'pop':              '#B7A8D6',
  'dance-pop':        '#D4A8D6',
  'rock':             '#D17A5C',
  'alternative-rock': '#E88C74',
  'indie-rock':       '#7FAFCF',
  'punk':             '#D45F5F',
  'metal':            '#8E4A57',
  'rnb':              '#B97BBF',
  'soul':             '#9E67A5',
  'funk':             '#7851A9',
  'folk':             '#91A78B',
  'country':          '#C4A86B',
  'ambient':          '#A89BEF',
  'classical':        '#D8BE72',
  'jazz':             '#D99A6C',
  'latin':            '#E8766A',
  'world-music':      '#C9A85F',
};

// ──────────────────────────────────────────────────
// Genre Display Labels
// ──────────────────────────────────────────────────

export const GENRE_LABELS: Record<InternalGenre, string> = {
  'hip-hop':          'HIP-HOP',
  'trap':             'TRAP',
  'drill':            'DRILL',
  'edm':              'EDM',
  'house':            'HOUSE',
  'techno':           'TECHNO',
  'trance':           'TRANCE',
  'drum-and-bass':    'DRUM & BASS',
  'pop':              'POP',
  'dance-pop':        'DANCE POP',
  'rock':             'ROCK',
  'alternative-rock': 'ALTERNATIVE ROCK',
  'indie-rock':       'INDIE ROCK',
  'punk':             'PUNK',
  'metal':            'METAL',
  'rnb':              'R&B',
  'soul':             'SOUL',
  'funk':             'FUNK',
  'folk':             'FOLK',
  'country':          'COUNTRY',
  'ambient':          'AMBIENT',
  'classical':        'CLASSICAL',
  'jazz':             'JAZZ',
  'latin':            'LATIN',
  'world-music':      'WORLD MUSIC',
};

// ──────────────────────────────────────────────────
// Normaliser function
// ──────────────────────────────────────────────────

/**
 * Map an array of raw MusicBrainz genre/tag strings to a single
 * internal genre key. Tries exact match first, then substring match,
 * then falls back to 'pop' (the centre anchor).
 */
export function normaliseGenre(rawTags: string[]): InternalGenre {
  // Try each tag in order (assume caller sorted by relevance/count)
  for (const raw of rawTags) {
    const key = raw?.toLowerCase().trim();
    if (!key) continue;

    // Exact match
    if (GENRE_NORMALISER[key]) {
      return GENRE_NORMALISER[key];
    }

    // Partial match: check if any normaliser key is contained in the tag
    for (const [pattern, genre] of Object.entries(GENRE_NORMALISER)) {
      if (key.includes(pattern)) return genre;
    }
  }

  // Hard fallback — pop is the centre anchor, safe default
  return 'pop';
}

/**
 * Convert lat/lng to 3D position on a sphere of given radius.
 */
export function latLngToXYZ(lat: number, lng: number, radius: number): [number, number, number] {
  const phi = (90 - lat) * Math.PI / 180;
  const theta = lng * Math.PI / 180;
  return [
    radius * Math.sin(phi) * Math.sin(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.cos(theta),
  ];
}

/**
 * Convert a 3D position to lat/lng.
 */
export function xyzToLatLng(x: number, y: number, z: number): { lat: number; lng: number } {
  const r = Math.sqrt(x * x + y * y + z * z);
  if (r === 0) return { lat: 0, lng: 0 };
  return {
    lat: 90 - Math.acos(y / r) * 180 / Math.PI,
    lng: Math.atan2(x, z) * 180 / Math.PI,
  };
}

/**
 * Get the genre-specific color for a normalised genre key.
 * Falls back to hash-based color for unknown keys.
 */
export function getGenreColor(genre: string): string {
  const internal = GENRE_COLORS[genre as InternalGenre];
  if (internal) return internal;

  // Try normalising first
  const normalised = normaliseGenre([genre]);
  if (GENRE_COLORS[normalised]) return GENRE_COLORS[normalised];

  // Deterministic hash fallback
  let hash = 0;
  for (let i = 0; i < genre.length; i++) {
    hash = genre.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 50%, 62%)`;
}
