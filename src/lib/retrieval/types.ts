import type { Candidate, RetrievalPath } from '@/lib/candidate/cub-types';

export type RetrievalEvidenceSource =
  | 'musicbrainz'
  | 'spotify_metadata'
  | 'lastfm'
  | 'local_catalog'
  | 'trusted_search';

export interface RetrievedArtistEvidence {
  source: RetrievalEvidenceSource;
  id?: string;
  url?: string;
  confidence: number;
  note?: string;
}

export interface RetrievedArtist {
  canonicalName: string;
  musicBrainzId?: string;
  spotifyId?: string;
  aliases: string[];
  genres: string[];
  tags: string[];
  releases: Array<{ title: string; year?: number; id?: string }>;
  relationships: Array<{ type: string; artistName: string; artistId?: string }>;
  popularity?: number;
  availability: {
    spotify: boolean;
    country?: string;
  };
  evidence: RetrievedArtistEvidence[];
  retrievalPath: RetrievalPath;
  sourceTerritory?: string;
}

export interface RetrievalPoolResult {
  artists: RetrievedArtist[];
  candidates: Candidate[];
  generatedAt: string;
}

