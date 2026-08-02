import type { Candidate } from '@/lib/candidate/cub-types';
import type { RetrievedArtist } from '@/lib/retrieval/types';
import { searchMusicBrainzArtist } from '@/lib/retrieval/musicbrainz';
import type { LLMRecommendation } from './llm-engine';

export interface VerifiedRecommendation {
  recommendation: LLMRecommendation;
  artist: RetrievedArtist;
  candidate: Candidate;
  canonicalId: string;
  confidence: number;
  accepted: boolean;
  rejectionReasons: string[];
}

function nameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function artistId(artist: RetrievedArtist): string {
  return artist.spotifyId || artist.musicBrainzId || artist.canonicalName;
}

export async function groundLLMRecommendations(input: {
  recommendations: LLMRecommendation[];
  candidatePool: RetrievedArtist[];
  candidates: Candidate[];
  knownIds: Set<string>;
  ignoredIds: Set<string>;
  rejectedIds: Set<string>;
  integratedIds: Set<string>;
  knownNames?: Set<string>;
}): Promise<VerifiedRecommendation[]> {
  const poolById = new Map(input.candidatePool.map((a) => [artistId(a), a]));
  const poolByName = new Map(input.candidatePool.map((a) => [nameKey(a.canonicalName), a]));
  const candidateById = new Map(input.candidates.map((c) => [c.artistId, c]));
  const candidateByName = new Map(input.candidates.map((c) => [nameKey(c.name), c]));
  const seen = new Set<string>();
  const out: VerifiedRecommendation[] = [];

  for (const rec of input.recommendations) {
    const id = rec.artistId || rec.spotifyId || rec.musicBrainzId || '';
    const reasons: string[] = [];
    let artist = (id && poolById.get(id)) || poolByName.get(nameKey(rec.artist));
    let candidate = (id && candidateById.get(id)) || candidateByName.get(nameKey(rec.artist));

    if (!artist && rec.musicBrainzId) {
      try {
        const mb = await searchMusicBrainzArtist(rec.artist);
        if (mb?.musicBrainzId === rec.musicBrainzId || nameKey(mb?.canonicalName ?? '') === nameKey(rec.artist)) {
          artist = mb ?? undefined;
        }
      } catch {
        // Missing live grounding is handled by rejection below.
      }
    }

    if (!artist) reasons.push('not_in_retrieved_candidate_pool');
    const canonicalId = artist ? artistId(artist) : id || rec.artist;
    if (!canonicalId) reasons.push('missing_canonical_id');
    if (seen.has(canonicalId) || seen.has(nameKey(rec.artist))) reasons.push('duplicate_pick');
    if (
      input.knownIds.has(canonicalId) ||
      input.ignoredIds.has(canonicalId) ||
      input.rejectedIds.has(canonicalId) ||
      input.integratedIds.has(canonicalId)
    ) {
      reasons.push('blocked_artist_id');
    }
    if (input.knownNames?.has(nameKey(rec.artist))) reasons.push('known_artist_name');
    if (artist && !artist.availability.spotify && !artist.spotifyId) {
      reasons.push('missing_spotify_availability');
    }
    if (!candidate && artist) {
      const cid = artistId(artist);
      candidate = candidateById.get(cid) || candidateByName.get(nameKey(artist.canonicalName));
    }
    if (!candidate) reasons.push('missing_candidate_record');

    const evidenceConfidence = artist
      ? Math.max(0, ...artist.evidence.map((e) => e.confidence))
      : 0;
    const metadataConfidence =
      artist?.musicBrainzId && artist.availability.spotify
        ? 0.95
        : artist?.musicBrainzId || artist?.evidence.some((e) => e.source === 'local_catalog')
          ? 0.88
          : artist?.spotifyId && artist.availability.spotify
            ? 0.75
            : 0.45;
    const confidence = Math.round(Math.min(evidenceConfidence, metadataConfidence) * 1000) / 1000;
    if (confidence < 0.5) reasons.push('low_metadata_confidence');

    if (artist && candidate) {
      seen.add(canonicalId);
      seen.add(nameKey(artist.canonicalName));
      out.push({
        recommendation: rec,
        artist,
        candidate,
        canonicalId,
        confidence,
        accepted: reasons.length === 0,
        rejectionReasons: reasons,
      });
    } else {
      out.push({
        recommendation: rec,
        artist: artist ?? {
          canonicalName: rec.artist,
          aliases: [],
          genres: [],
          tags: [],
          releases: [],
          relationships: [],
          availability: { spotify: false },
          evidence: [],
          retrievalPath: 'adjacency',
        },
        candidate: candidate ?? {
          artistId: canonicalId,
          name: rec.artist,
          genres: [],
          popularity: 0,
          imageUrl: '',
          discoveryContext: {
            growthOpportunity: 'unknown',
            relationshipStage: 'REJECTED',
            supportingArtists: [],
            sources: [],
          },
          discoveryConfidence: 0,
          candidateClassification: 'UNKNOWN',
          audioSource: 'low_confidence',
          confidenceTag: 'low_confidence',
        },
        canonicalId,
        confidence,
        accepted: false,
        rejectionReasons: reasons,
      });
    }
  }

  return out;
}
