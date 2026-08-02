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
  'conscious hip hop': 'hip-hop', 'gangsta rap': 'hip-hop', 'east coast hip hop': 'hip-hop',
  'west coast hip hop': 'hip-hop', 'southern hip hop': 'hip-hop', 'melodic rap': 'hip-hop',
  'underground hip hop': 'hip-hop', 'old school hip hop': 'hip-hop',
  'trap': 'trap', 'trap music': 'trap', 'trap soul': 'trap', 'pluggnb': 'trap',
  'drill': 'drill', 'uk drill': 'drill', 'chicago drill': 'drill', 'brooklyn drill': 'drill',

  // Electronic
  'edm': 'edm', 'electronic dance music': 'edm', 'electronic': 'edm', 'electronica': 'edm',
  'electro': 'edm', 'future bass': 'edm', 'dubstep': 'edm', 'brostep': 'edm',
  'complextro': 'edm', 'big room': 'edm', 'hardstyle': 'edm',
  'house': 'house', 'deep house': 'house', 'progressive house': 'house', 'acid house': 'house',
  'tropical house': 'house', 'tech house': 'house', 'electro house': 'house', 'slap house': 'house',
  'techno': 'techno', 'minimal techno': 'techno', 'detroit techno': 'techno', 'industrial techno': 'techno',
  'trance': 'trance', 'psytrance': 'trance', 'progressive trance': 'trance', 'uplifting trance': 'trance',
  'drum and bass': 'drum-and-bass', 'drum & bass': 'drum-and-bass', 'dnb': 'drum-and-bass',
  'liquid drum and bass': 'drum-and-bass', 'jungle': 'drum-and-bass',

  // Pop
  'pop': 'pop', 'indie pop': 'pop', 'art pop': 'pop', 'synthpop': 'pop',
  'synth-pop': 'pop', 'electropop': 'pop', 'teen pop': 'pop',
  'chamber pop': 'pop', 'bedroom pop': 'pop', 'dream pop': 'pop',
  'baroque pop': 'pop', 'noise pop': 'pop', 'power pop': 'pop',
  'k-pop': 'pop', 'j-pop': 'pop', 'c-pop': 'pop',
  'canadian pop': 'pop', 'swedish pop': 'pop', 'uk pop': 'pop', 'australian pop': 'pop',
  'french pop': 'pop', 'german pop': 'pop', 'italian pop': 'pop', 'spanish pop': 'pop',
  'dance pop': 'dance-pop', 'dance-pop': 'dance-pop', 'disco': 'dance-pop',
  'eurodance': 'dance-pop', 'europop': 'dance-pop', 'italo disco': 'dance-pop',

  // Rock
  'rock': 'rock', 'classic rock': 'rock', 'hard rock': 'rock',
  'blues rock': 'rock', 'southern rock': 'rock', 'arena rock': 'rock',
  'album rock': 'rock', 'heartland rock': 'rock', 'garage rock': 'rock',
  'psychedelic rock': 'rock', 'stoner rock': 'rock', 'progressive rock': 'rock',
  'alternative rock': 'alternative-rock', 'alternative': 'alternative-rock', 'alt-rock': 'alternative-rock',
  'grunge': 'alternative-rock', 'shoegaze': 'alternative-rock', 'britpop': 'alternative-rock',
  'new wave': 'alternative-rock', 'post-rock': 'alternative-rock',
  'indie rock': 'indie-rock', 'indie': 'indie-rock', 'lo-fi': 'indie-rock',
  'math rock': 'indie-rock', 'emo': 'indie-rock', 'midwest emo': 'indie-rock',
  'punk': 'punk', 'punk rock': 'punk', 'post-punk': 'punk', 'pop punk': 'punk',
  'hardcore punk': 'punk', 'ska punk': 'punk',
  'metal': 'metal', 'heavy metal': 'metal', 'death metal': 'metal', 'black metal': 'metal',
  'thrash metal': 'metal', 'nu metal': 'metal', 'metalcore': 'metal',
  'progressive metal': 'metal', 'doom metal': 'metal', 'power metal': 'metal', 'deathcore': 'metal',

  // Soul & Groove
  'r&b': 'rnb', 'rnb': 'rnb', 'rhythm and blues': 'rnb', 'contemporary r&b': 'rnb',
  'urban contemporary': 'rnb', 'alternative r&b': 'rnb', 'new jack swing': 'rnb',
  'soul': 'soul', 'neo soul': 'soul', 'neo-soul': 'soul', 'motown': 'soul',
  'northern soul': 'soul', 'southern soul': 'soul',
  'funk': 'funk', 'g-funk': 'funk', 'p-funk': 'funk', 'boogie': 'funk',

  // Acoustic
  'folk': 'folk', 'traditional folk': 'folk', 'americana': 'folk',
  'singer-songwriter': 'folk', 'acoustic': 'folk', 'indie folk': 'folk',
  'celtic': 'folk', 'chamber folk': 'folk',
  'country': 'country', 'bluegrass': 'country', 'alt-country': 'country',
  'country rock': 'country', 'country pop': 'country', 'outlaw country': 'country',
  'modern country': 'country', 'nashville sound': 'country',

  // Atmospheric
  'ambient': 'ambient', 'dark ambient': 'ambient', 'drone': 'ambient',
  'chillwave': 'ambient', 'vaporwave': 'ambient', 'new age': 'ambient',
  'downtempo': 'ambient', 'trip hop': 'ambient', 'chillout': 'ambient',
  'classical': 'classical', 'neoclassical': 'classical', 'modern classical': 'classical', 'orchestral': 'classical',
  'opera': 'classical', 'baroque': 'classical', 'film score': 'classical', 'soundtrack': 'classical',
  'jazz': 'jazz', 'bebop': 'jazz', 'cool jazz': 'jazz', 'jazz fusion': 'jazz',
  'smooth jazz': 'jazz', 'acid jazz': 'jazz', 'free jazz': 'jazz', 'swing': 'jazz',
  'big band': 'jazz', 'bossa nova': 'jazz', 'nu jazz': 'jazz',

  // Global
  'latin': 'latin', 'reggaeton': 'latin', 'latin pop': 'latin',
  'latin hip hop': 'latin', 'latin trap': 'latin', 'salsa': 'latin',
  'bachata': 'latin', 'cumbia': 'latin', 'merengue': 'latin',
  'samba': 'latin', 'mpb': 'latin', 'brazilian': 'latin',
  'world music': 'world-music', 'world': 'world-music', 'afrobeat': 'world-music',
  'afropop': 'world-music', 'afroswing': 'world-music', 'dancehall': 'world-music',
  'reggae': 'world-music', 'dub': 'world-music', 'ska': 'world-music',
  'bollywood': 'world-music', 'bhangra': 'world-music', 'filmi': 'world-music',
  'mandopop': 'world-music', 'cantopop': 'world-music', 'turkish pop': 'world-music',
  'arabic pop': 'world-music', 'highlife': 'world-music',
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

/** Broad input tags that should lose to more specific siblings when ranking. */
const BROAD_INPUT_TAGS = new Set([
  'electronic',
  'electronica',
  'electro',
  'rock',
  'pop',
  'hip hop',
  'hip-hop',
  'rap',
  'alternative',
  'indie',
  'dance',
  'metal',
  'r&b',
  'rnb',
  'soul',
  'folk',
  'jazz',
  'classical',
  'latin',
  'world',
  'world music',
]);

/** Output primaries that are umbrella buckets — penalise unless sole match. */
const BROAD_OUTPUT: Partial<Record<InternalGenre, number>> = {
  pop: 18,
  rock: 14,
  edm: 16,
  'hip-hop': 10,
  'world-music': 8,
};

/** Last.fm / MB noise that is never a musical genre. */
const JUNK_TAG_RE =
  /^(seen live|favorites?|favourite|check|love|awesome|beautiful|sexy|hot|cool|good|bad|under \d+|all|other|misc|unknown|music|songs?|albums?|artists?|band|new|old|best|top|my \w+|acoustic|instrumental|live|cover|covers|remix|ost|soundtrack only)$/i;
const DEMOGRAPHIC_RE =
  /^(male|female|german|french|canadian|british|american|english|uk|usa|us|swedish|australian|japanese|korean|spanish|italian|brazilian|mexican|irish|scottish|dutch|norwegian|danish|finnish|polish|russian|indian|african|asian)(\s+vocalists?)?$/i;
const DECADE_RE = /^(19|20)\d{2}s?$|^\d{2}s$/i;
const VOCALIST_RE = /vocalists?/;
/** Role / format tags that map to a genre but should not beat real styles. */
const SOFT_ROLE_TAGS = new Set([
  'singer-songwriter',
  'singer songwriter',
  'songwriter',
  'composer',
  'producer',
  'dj',
  'band',
  'solo',
  'group',
  'orchestra',
  'choir',
]);

function compactName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Drop Last.fm-style junk: artist self-tags, decades, demographics, "seen live".
 */
export function cleanGenreTags(
  rawTags?: string[] | null,
  artistName?: string | null,
): string[] {
  if (!rawTags || !Array.isArray(rawTags)) return [];
  const artistKey = artistName ? compactName(artistName) : '';
  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of rawTags) {
    if (typeof raw !== 'string') continue;
    const key = raw.toLowerCase().trim();
    if (!key || key.length < 2 || key.length > 48) continue;
    if (JUNK_TAG_RE.test(key) || DEMOGRAPHIC_RE.test(key) || DECADE_RE.test(key)) {
      continue;
    }
    if (SOFT_ROLE_TAGS.has(key)) continue;
    if (VOCALIST_RE.test(key) && !GENRE_NORMALISER[key]) continue;
    // Artist name used as a tag (very common on Last.fm)
    if (artistKey) {
      const tk = compactName(key);
      if (
        tk === artistKey ||
        (tk.length >= 4 && artistKey.includes(tk) && tk.length >= artistKey.length * 0.6) ||
        (artistKey.length >= 4 && tk.includes(artistKey) && artistKey.length >= tk.length * 0.6)
      ) {
        continue;
      }
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * Map a single tag string to an internal genre + match quality score.
 * Higher score = more specific / trustworthy primary.
 */
export function scoreGenreTag(raw: string): { genre: InternalGenre; score: number } | null {
  const key = raw?.toLowerCase().trim();
  if (!key) return null;

  let genre: InternalGenre | null = null;
  let patternLen = 0;
  let exact = false;

  if (GENRE_NORMALISER[key]) {
    genre = GENRE_NORMALISER[key];
    patternLen = key.length;
    exact = true;
  } else {
    const dehyphen = key.replace(/-/g, ' ');
    if (GENRE_NORMALISER[dehyphen]) {
      genre = GENRE_NORMALISER[dehyphen];
      patternLen = dehyphen.length;
      exact = true;
    } else {
      let bestMatch: InternalGenre | null = null;
      let bestLen = 0;
      for (const [pattern, g] of Object.entries(GENRE_NORMALISER)) {
        if (key.includes(pattern) && pattern.length > bestLen) {
          bestMatch = g;
          bestLen = pattern.length;
        }
      }
      if (bestMatch) {
        genre = bestMatch;
        patternLen = bestLen;
      }
    }
  }

  if (!genre) return null;

  // Base: longer pattern = more specific phrasing
  let score = patternLen * 3 + (exact ? 12 : 0);

  // Broad umbrella inputs (electronic, rock, pop…) lose to house/metal/country etc.
  if (BROAD_INPUT_TAGS.has(key) || BROAD_INPUT_TAGS.has(key.replace(/-/g, ' '))) {
    score -= 22;
  }

  // Prefer leaf territories over umbrella outputs when competing
  score -= BROAD_OUTPUT[genre] ?? 0;

  // Bonus for multi-word specialised tags (e.g. "progressive house", "thrash metal")
  if ((key.includes(' ') || key.includes('-')) && !BROAD_INPUT_TAGS.has(key)) {
    score += 6;
  }

  // Soft roles that slipped through map poorly (folk via singer-songwriter)
  if (SOFT_ROLE_TAGS.has(key)) score -= 40;

  return { genre, score };
}

/**
 * Pick the best primary InternalGenre from a tag list (not first-tag-wins).
 * Cleans junk first when artistName is provided.
 */
export function normaliseGenreOrUnknown(
  rawTags?: string[] | null,
  artistName?: string | null,
): InternalGenre | null {
  const cleaned = cleanGenreTags(rawTags, artistName);
  // If cleaning wiped everything, still try raw (may be pure InternalGenre keys)
  const tags = cleaned.length > 0 ? cleaned : (rawTags || []).map((t) => String(t).toLowerCase().trim()).filter(Boolean);
  if (tags.length === 0) return null;

  let best: { genre: InternalGenre; score: number } | null = null;
  for (const tag of tags) {
    const scored = scoreGenreTag(tag);
    if (!scored) continue;
    if (!best || scored.score > best.score) best = scored;
  }
  return best?.genre ?? null;
}

/**
 * Canonical artist genre list for frontier / UI / GRE:
 *   [primaryInternalGenre, ...clean human tags that map to other territories]
 * Never invents pop. Drops junk. Prefers specific primary over first tag.
 */
export function resolveArtistGenres(
  rawTags?: string[] | null,
  artistName?: string | null,
): string[] {
  const cleaned = cleanGenreTags(rawTags, artistName);
  const tags =
    cleaned.length > 0
      ? cleaned
      : (rawTags || [])
          .map((t) => String(t).toLowerCase().trim())
          .filter((t) => t.length > 0);

  if (tags.length === 0) return [];

  const primary = normaliseGenreOrUnknown(tags, artistName);
  if (!primary) return tags.slice(0, 6);

  const secondary: string[] = [];
  const seen = new Set<string>([primary]);
  for (const tag of tags) {
    const scored = scoreGenreTag(tag);
    if (!scored) {
      // keep unrecognised but non-junk as colour/flavour (max 4)
      if (secondary.length < 4 && !seen.has(tag)) {
        secondary.push(tag);
        seen.add(tag);
      }
      continue;
    }
    if (scored.genre === primary) continue;
    if (seen.has(scored.genre)) continue;
    // Prefer storing the internal key for known genres (stable UI)
    secondary.push(scored.genre);
    seen.add(scored.genre);
    if (secondary.length >= 5) break;
  }

  return [primary, ...secondary];
}

/**
 * Map an array of raw genre/tag strings to a single
 * internal genre key. Falls back to 'pop' for layout anchors only.
 */
export function normaliseGenre(
  rawTags?: string[] | null,
  artistName?: string | null,
): InternalGenre {
  return normaliseGenreOrUnknown(rawTags, artistName) ?? 'pop';
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
  const key = genre.toLowerCase().trim();
  const internal = GENRE_COLORS[key as InternalGenre];
  if (internal) return internal;

  // Try normalising first
  const normalised = normaliseGenre([key]);
  
  // Only map to normalised genre color if it's NOT the hard fallback 'pop'
  // OR if the original key itself contains the word 'pop'
  if (GENRE_COLORS[normalised] && (normalised !== 'pop' || key.includes('pop'))) {
    return GENRE_COLORS[normalised];
  }

  // Deterministic hash fallback for truly unique, niche, or unknown genres
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = key.charCodeAt(i) + ((hash << 5) - hash);
  }
  // Generate a beautiful, soft cinematic pastel HSL color
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 42%, 75%)`;
}
