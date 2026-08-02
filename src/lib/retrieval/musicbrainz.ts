import type { RetrievedArtist, RetrievedArtistEvidence } from './types';
import { musicbrainzLimiter } from '@/lib/utils/rate-limiter';

const MB_BASE = 'https://musicbrainz.org/ws/2';
const USER_AGENT = 'ORCA/1.0 (https://musicuniverse.local)';

interface MBArtistSearchResult {
  id?: string;
  name?: string;
  tags?: Array<{ name?: string }>;
  aliases?: Array<{ name?: string }>;
}

interface MBArtistDetail extends MBArtistSearchResult {
  releases?: Array<{ title?: string; date?: string; id?: string }>;
  relations?: Array<{
    type?: string;
    artist?: { name?: string; id?: string };
  }>;
}

interface MBSearchResponse {
  artists?: MBArtistSearchResult[];
}

function compactName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function mbFetch(path: string): Promise<MBSearchResponse | MBArtistDetail | null> {
  // Audit fix H3: MusicBrainz asks for max ~1 rps; the shared token bucket
  // was previously never wired into this fetch.
  await musicbrainzLimiter.acquire();
  const res = await fetch(`${MB_BASE}${path}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
  });
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

export async function searchMusicBrainzArtist(name: string): Promise<RetrievedArtist | null> {
  if (!name.trim()) return null;
  const raw = await mbFetch(
    `/artist?query=${encodeURIComponent(`artist:"${name}"`)}&fmt=json&limit=5`,
  );
  const data = raw as MBSearchResponse;
  const items = Array.isArray(data?.artists) ? data.artists : [];
  if (items.length === 0) return null;

  const wanted = compactName(name);
  const best =
    items.find((a) => compactName(String(a.name ?? '')) === wanted) ?? items[0];
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
    ? data.relations.slice(0, 24).map((r) => ({
        type: String(r.type ?? 'related'),
        artistName: String(r.artist?.name ?? ''),
        artistId: r.artist?.id ? String(r.artist.id) : undefined,
      })).filter((r: { artistName: string }) => r.artistName)
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

