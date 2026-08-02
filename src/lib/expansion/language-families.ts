/**
 * Linguistic distance helpers for Cultural Distance (Part 3).
 * Not passport/country — language-family tree relatedness.
 */

/** Coarse language-family ids used for distance. */
export type LanguageFamily =
  | 'germanic'
  | 'romance'
  | 'slavic'
  | 'uralic'
  | 'turkic'
  | 'semitic'
  | 'niger_congo'
  | 'indo_aryan'
  | 'dravidian'
  | 'sino_tibetan'
  | 'japonic'
  | 'koreanic'
  | 'austronesian'
  | 'tai'
  | 'other';

/**
 * Pairwise family distance in [0, 1]. Same family = 0.
 * Related European families closer than unrelated pairs.
 * Missing → treat as max distance 1.
 */
const FAMILY_DISTANCE: Record<string, number> = {
  // Within-ish Europe clusters
  'germanic|romance': 0.35,
  'germanic|slavic': 0.45,
  'romance|slavic': 0.4,
  'germanic|uralic': 0.55,
  'romance|uralic': 0.55,
  'slavic|uralic': 0.4,
  // Asia
  'japonic|koreanic': 0.45,
  'japonic|sino_tibetan': 0.55,
  'koreanic|sino_tibetan': 0.5,
  'sino_tibetan|tai': 0.5,
  'indo_aryan|dravidian': 0.55,
  'indo_aryan|germanic': 0.65,
  // Distant defaults handled by max
};

function pairKey(a: LanguageFamily, b: LanguageFamily): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function languageFamilyDistance(
  a: LanguageFamily | null | undefined,
  b: LanguageFamily | null | undefined,
): number {
  if (!a || !b) return 1.0;
  if (a === b) return 0.0;
  return FAMILY_DISTANCE[pairKey(a, b)] ?? 0.9;
}

/**
 * Heuristic genre → primary language-family (tag_inferred).
 * Used when track-level language metadata is absent.
 */
export const GENRE_LANGUAGE_FAMILY: Record<string, LanguageFamily> = {
  'hip-hop': 'germanic',
  trap: 'germanic',
  drill: 'germanic',
  grime: 'germanic',
  'uk-garage': 'germanic',
  edm: 'germanic',
  house: 'germanic',
  techno: 'germanic',
  trance: 'germanic',
  'drum-and-bass': 'germanic',
  pop: 'germanic',
  'dance-pop': 'germanic',
  rock: 'germanic',
  'alternative-rock': 'germanic',
  'indie-rock': 'germanic',
  punk: 'germanic',
  metal: 'germanic',
  rnb: 'germanic',
  soul: 'germanic',
  funk: 'germanic',
  folk: 'germanic',
  country: 'germanic',
  ambient: 'germanic',
  classical: 'germanic',
  jazz: 'germanic',
  latin: 'romance',
  'world-music': 'other',
  'lo-fi-hip-hop': 'germanic',
  downtempo: 'germanic',
  // Common Last.fm-ish tags
  kpop: 'koreanic',
  'k-pop': 'koreanic',
  jpop: 'japonic',
  'j-pop': 'japonic',
  reggaeton: 'romance',
  salsa: 'romance',
  bossa: 'romance',
  'bossa-nova': 'romance',
  afrobeats: 'niger_congo',
  amapiano: 'niger_congo',
  cumbia: 'romance',
  bollywood: 'indo_aryan',
};

export function inferLanguageFamilies(genres: string[]): LanguageFamily[] {
  const out = new Set<LanguageFamily>();
  for (const g of genres) {
    const key = g.toLowerCase().trim();
    const fam = GENRE_LANGUAGE_FAMILY[key];
    if (fam) out.add(fam);
  }
  if (out.size === 0) out.add('other');
  return Array.from(out);
}

/** Min pairwise family distance between two sets (best match). */
export function linguisticDistanceFromGenres(
  userGenres: string[],
  candidateGenres: string[],
): number {
  const u = inferLanguageFamilies(userGenres);
  const c = inferLanguageFamilies(candidateGenres);
  let min = 1.0;
  for (const a of u) {
    for (const b of c) {
      min = Math.min(min, languageFamilyDistance(a, b));
    }
  }
  return min;
}
