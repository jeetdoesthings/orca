import type { RetrievedArtist, RetrievedArtistEvidence } from './types';
import { musicbrainzLimiter, getMusicBrainzApiKeys } from '@/lib/utils/rate-limiter';
import { fetchWithTimeout } from '@/lib/utils/fetch-timeout';

const MB_BASE = 'https://musicbrainz.org/ws/2';
const USER_AGENT = 'ORCA/2.0 (https://musicuniverse.local)';

interface MBArtistSearchResult {
  id?: string;
  name?: string;
  tags?: Array<{ name?: string }>;
  aliases?: Array<{ name?: string }>;
  /** MusicBrainz returns a 'score' field on search results — prefer the highest. */
  score?: number;
}

interface MBArtistDetail extends MBArtistSearchResult {
  releases?: Array<{ title?: string; date?: string; id?: string }>;
  relations?: Array<{
    type?: string;
    direction?: string;
    artist?: { name?: string; id?: string; disambiguation?: string };
  }>;
  /** Life-span for dedup (ended artists are less likely to be duplicates). */
  'life-span'?: { begin?: string; ended?: boolean };
}

interface MBSearchResponse {
  artists?: MBArtistSearchResult[];
  count?: number;
}

function compactName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Pick a MusicBrainz API key (round-robin via limiter index is implicit; any key works). */
function pickApiKey(): string | undefined {
  const keys = getMusicBrainzApiKeys();
  return keys.length > 0 ? keys[Math.floor(Math.random() * keys.length)] : undefined;
}

async function mbFetch(
  path: string,
  timeoutMs = 15000,
): Promise<MBSearchResponse | MBArtistDetail | null> {
  await musicbrainzLimiter.acquire(60_000);
  const apiKey = pickApiKey();
  const sep = path.includes('?') ? '&' : '?';
  const url = `${MB_BASE}${path}${apiKey ? `${sep}api_key=${apiKey}` : ''}`;
  const res = await fetchWithTimeout(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
  }, timeoutMs);
  if (!res.ok) return null;
  return res.json();
}

function evidence(id: string, note: string, confidence = 0.9): RetrievedArtistEvidence {
  return {
    source: 'musicbrainz',
    id,
    url: `https://musicbrainz.org/artist/${id}`,
    confidence,
    note,
  };
}

/**
 * Search MusicBrainz for an artist by name. Returns basic metadata without
 * relationships (use searchAndLoadMusicBrainzArtist for full data).
 */
export async function searchMusicBrainzArtist(name: string): Promise<RetrievedArtist | null> {
  if (!name.trim()) return null;
  const raw = await mbFetch(
    `/artist?query=${encodeURIComponent(`artist:"${name}"`)}&fmt=json&limit=5`,
  );
  const data = raw as MBSearchResponse;
  const items = Array.isArray(data?.artists) ? data.artists : [];
  if (items.length === 0) return null;

  const wanted = compactName(name);
  // Prefer exact name match, then highest score
  const best =
    items.find((a) => compactName(String(a.name ?? '')) === wanted) ??
    items.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
  if (!best?.id || !best?.name) return null;

  const tags = Array.isArray(best.tags)
    ? best.tags.map((t) => String(t.name ?? '')).filter(Boolean)
    : [];
  const aliases = Array.isArray(best.aliases)
    ? best.aliases.map((a) => String(a.name ?? '')).filter(Boolean)
    : [];

  return {
    canonicalName: String(best.name),
    musicBrainzId: String(best.id),
    aliases,
    genres: tags.slice(0, 8),
    tags,
    releases: [],
    relationships: [],
    popularity: undefined,
    availability: { spotify: false },
    evidence: [evidence(String(best.id), 'artist search result')],
    retrievalPath: 'adjacency',
  };
}

export async function loadMusicBrainzArtist(id: string): Promise<RetrievedArtist | null> {
  if (!id) return null;
  const raw = await mbFetch(
    `/artist/${encodeURIComponent(id)}?inc=aliases+tags+releases+artist-rels&fmt=json`,
  );
  const data = raw as MBArtistDetail;
  if (!data?.id || !data?.name) return null;

  const tags = Array.isArray(data.tags)
    ? data.tags.map((t) => String(t.name ?? '')).filter(Boolean)
    : [];
  const aliases = Array.isArray(data.aliases)
    ? data.aliases.map((a) => String(a.name ?? '')).filter(Boolean)
    : [];
  const releases = Array.isArray(data.releases)
    ? data.releases.slice(0, 8).map((r) => ({
        title: String(r.title ?? ''),
        year: r.date ? Number(String(r.date).slice(0, 4)) || undefined : undefined,
        id: r.id ? String(r.id) : undefined,
      })).filter((r: { title: string }) => r.title)
    : [];
  const relationships = Array.isArray(data.relations)
    ? data.relations
        .filter((r) => r.artist?.name && r.artist?.id)
        .slice(0, 36)
        .map((r) => ({
          type: String(r.type ?? 'related'),
          artistName: String(r.artist!.name!),
          artistId: r.artist!.id ? String(r.artist!.id) : undefined,
        }))
        .filter((r: { artistName: string }) => r.artistName)
    : [];

  return {
    canonicalName: String(data.name),
    musicBrainzId: String(data.id),
    aliases,
    genres: tags.slice(0, 8),
    tags,
    releases,
    relationships,
    popularity: undefined,
    availability: { spotify: false },
    evidence: [evidence(String(data.id), 'artist lookup result')],
    retrievalPath: 'adjacency',
  };
}

/**
 * Search + load full details in one call. Returns the artist with relationships,
 * genres, and releases populated. Prefer this over searchMusicBrainzArtist for
 * candidate pool generation.
 */
export async function searchAndLoadMusicBrainzArtist(
  name: string,
): Promise<RetrievedArtist | null> {
  const searched = await searchMusicBrainzArtist(name);
  if (!searched?.musicBrainzId) return null;
  return loadMusicBrainzArtist(searched.musicBrainzId);
}

/** Known MB duplicate cluster IDs — artists that MusicBrainz has in multiple entries. */
const MB_DUPLICATE_OVERRIDES = new Map<string, string>();

/**
 * Register a MusicBrainz ID → canonical ID mapping for deduplication.
 * Call after detecting duplicates (e.g. same displayName, different MB IDs).
 */
export function registerMBDuplicate(duplicateId: string, canonicalId: string): void {
  MB_DUPLICATE_OVERRIDES.set(duplicateId, canonicalId);
}

/** Resolve a MusicBrainz ID to its canonical form if a duplicate override exists. */
export function resolveCanonicalMBId(mbid: string): string {
  return MB_DUPLICATE_OVERRIDES.get(mbid) ?? mbid;
}
