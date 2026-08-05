import { prisma } from '@/lib/prisma';
import type { Candidate } from '@/lib/candidate/cub-types';
import type { TasteIdentity } from '@/lib/identity/orca-identity';
import { normaliseGenreOrUnknown } from '@/lib/graph/genre-normaliser';
import { searchAndLoadMusicBrainzArtist, resolveCanonicalMBId } from './musicbrainz';
import { enrichRetrievedArtistsWithSpotify } from './spotify-metadata';
import type { RetrievedArtist, RetrievalPoolResult } from './types';

function nameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseGenres(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return raw.split(',').map((g) => g.trim()).filter(Boolean);
  }
}

function retrievedToCandidate(artist: RetrievedArtist): Candidate {
  const id = artist.spotifyId || artist.musicBrainzId || `mb-${nameKey(artist.canonicalName)}`;
  const genres = artist.genres.length > 0 ? artist.genres : artist.tags.slice(0, 8);
  return {
    artistId: id,
    name: artist.canonicalName,
    genres: genres.length > 0 ? genres : ['unknown'],
    popularity: artist.popularity ?? 45,
    imageUrl: '',
    spotifyId: artist.spotifyId,
    musicBrainzId: artist.musicBrainzId,
    availability: artist.availability,
    discoveryContext: {
      growthOpportunity: normaliseGenreOrUnknown(genres) || 'unknown',
      relationshipStage: 'LLM_GROUNDED',
      supportingArtists: artist.relationships.map((r) => r.artistId || r.artistName).slice(0, 8),
      sources: artist.evidence.map((e) => ({
        type: e.source === 'musicbrainz' ? 'COLLABORATION_NETWORK' : 'SPOTIFY_METADATA',
        source: e.source,
        strength: e.confidence,
        confidence: e.confidence,
        metadata: { id: e.id, url: e.url, note: e.note },
      })),
    },
    discoveryConfidence: Math.max(0.55, ...artist.evidence.map((e) => e.confidence)),
    candidateClassification: 'DISCOVERY',
    audioSource: artist.musicBrainzId ? 'high_confidence' : 'partial_confidence',
    confidenceTag: artist.musicBrainzId ? 'high_confidence' : 'partial_confidence',
    retrievalPath: artist.retrievalPath,
    sourceTerritory: artist.sourceTerritory,
  };
}

function localArtistToRetrieved(row: {
  id: string;
  spotifyId: string | null;
  displayName: string;
  rawGenres: string;
  popularity: number;
  sourceEvidence: string | null;
  metadata: string | null;
}): RetrievedArtist {
  let mbid: string | undefined;
  try {
    const meta = row.metadata ? JSON.parse(row.metadata) : {};
    mbid = meta.musicBrainzId || meta.mbid;
  } catch {
    mbid = undefined;
  }
  const genres = parseGenres(row.rawGenres);
  return {
    canonicalName: row.displayName,
    musicBrainzId: mbid,
    spotifyId: row.spotifyId ?? row.id,
    aliases: [],
    genres,
    tags: genres,
    releases: [],
    relationships: [],
    popularity: row.popularity,
    availability: { spotify: Boolean(row.spotifyId ?? row.id) },
    evidence: [
      {
        source: 'local_catalog',
        id: row.id,
        confidence: mbid ? 0.9 : 0.72,
        note: row.sourceEvidence ? 'catalog evidence present' : 'local catalog row',
      },
    ],
    retrievalPath: 'adjacency',
    sourceTerritory: normaliseGenreOrUnknown(genres) ?? undefined,
  };
}

export async function retrieveCandidatePool(
  identity: TasteIdentity,
  accessToken: string,
  seedCandidates: Candidate[] = [],
  limit = 300,
): Promise<RetrievalPoolResult> {
  const knownNames = new Set([
    ...identity.integratedArtists.map((a) => nameKey(a.name)),
    ...identity.currentFrontier.map((a) => nameKey(a.name)),
  ]);
  const blockedIds = new Set([
    ...identity.integratedArtists.map((a) => a.id),
    ...identity.ignoredArtists.map((a) => a.id),
    ...identity.rejectedArtists.map((a) => a.id),
  ]);
  const blockedNames = new Set([
    ...identity.ignoredArtists.map((a) => nameKey(a.name)),
    ...identity.rejectedArtists.map((a) => nameKey(a.name)),
  ]);

  // Track MB IDs to deduplicate
  const seenMBIds = new Set<string>();

  const byName = new Map<string, RetrievedArtist>();
  const add = (artist: RetrievedArtist) => {
    const key = nameKey(artist.canonicalName);
    const id = artist.spotifyId || artist.musicBrainzId;
    if (!key || knownNames.has(key) || blockedNames.has(key) || (id && blockedIds.has(id))) return;

    // Deduplicate by MusicBrainz ID
    const canonicalMBId = artist.musicBrainzId ? resolveCanonicalMBId(artist.musicBrainzId) : undefined;
    if (canonicalMBId && seenMBIds.has(canonicalMBId)) return;
    if (canonicalMBId) seenMBIds.add(canonicalMBId);

    const prev = byName.get(key);
    if (!prev || (artist.evidence[0]?.confidence ?? 0) > (prev.evidence[0]?.confidence ?? 0)) {
      byName.set(key, artist);
    }
  };

  for (const c of seedCandidates) {
    add({
      canonicalName: c.name,
      spotifyId: c.artistId,
      aliases: [],
      genres: c.genres || [],
      tags: c.genres || [],
      releases: [],
      relationships: c.discoveryContext.supportingArtists.map((id) => ({
        type: 'seed_support',
        artistName: id,
        artistId: id,
      })),
      popularity: c.popularity,
      availability: { spotify: true },
      evidence: [
        {
          source: 'spotify_metadata',
          id: c.artistId,
          confidence: c.discoveryConfidence ?? 0.65,
          note: c.discoveryContext.sources[0]?.source ?? 'seed candidate',
        },
      ],
      retrievalPath: c.retrievalPath ?? c.retrieval_path ?? 'adjacency',
      sourceTerritory: c.sourceTerritory ?? c.source_territory,
    });
  }

  const homeGenres = identity.homeTerritory.genres.slice(0, 12);
  if (homeGenres.length > 0 && byName.size < limit) {
    const rows = await prisma.artist.findMany({
      where: {
        OR: homeGenres.map((g) => ({ rawGenres: { contains: g } })),
      },
      select: {
        id: true,
        spotifyId: true,
        displayName: true,
        rawGenres: true,
        popularity: true,
        sourceEvidence: true,
        metadata: true,
      },
      take: Math.max(80, limit - byName.size),
      orderBy: { popularity: 'desc' },
    });
    for (const row of rows) add(localArtistToRetrieved(row));
  }

  // MusicBrainz deep retrieval: search+load full relationships for up to 20 integrated seeds
  const mbSeeds = identity.integratedArtists.slice(0, 20);
  for (const seed of mbSeeds) {
    if (byName.size >= limit) break;
    try {
      const mb = await searchAndLoadMusicBrainzArtist(seed.name);
      if (mb) {
        // Add the related artists from MB
        for (const rel of mb.relationships) {
          if (byName.size >= limit) break;
          if (!rel.artistId || !rel.artistName) continue;
          const related: RetrievedArtist = {
            canonicalName: rel.artistName,
            musicBrainzId: rel.artistId,
            aliases: [],
            genres: mb.genres,
            tags: mb.tags,
            releases: [],
            relationships: [
              { type: rel.type, artistName: seed.name, artistId: seed.id },
            ],
            popularity: undefined,
            availability: { spotify: false },
            evidence: [
              {
                source: 'musicbrainz' as const,
                id: rel.artistId,
                confidence: 0.82,
                note: `MusicBrainz ${rel.type} relation from ${seed.name}`,
              },
            ],
            retrievalPath: 'adjacency' as const,
            sourceTerritory: mb.genres[0],
          };
          add(related);
        }
      }
    } catch {
      // External retrieval is opportunistic; local catalog remains authoritative fallback.
    }
  }

  const artists = await enrichRetrievedArtistsWithSpotify(Array.from(byName.values()), accessToken);

  // Detect and register MB duplicates: artists with same display name but different MB IDs
  const nameToMBIds = new Map<string, string[]>();
  for (const a of artists) {
    if (!a.musicBrainzId) continue;
    const key = nameKey(a.canonicalName);
    const ids = nameToMBIds.get(key) || [];
    ids.push(a.musicBrainzId);
    nameToMBIds.set(key, ids);
  }
  for (const [, ids] of nameToMBIds) {
    if (ids.length > 1) {
      const canonical = ids[0];
      for (let i = 1; i < ids.length; i++) {
        // Dynamic import to avoid circular deps
        import('./musicbrainz').then(({ registerMBDuplicate }) => {
          registerMBDuplicate(ids[i], canonical);
        });
      }
    }
  }

  return {
    artists: artists.slice(0, limit),
    candidates: artists.slice(0, limit).map(retrievedToCandidate),
    generatedAt: new Date().toISOString(),
  };
}
