/**
 * Core types and interfaces for the Candidate Universe Builder (CUB).
 * Excludes any recommendation, utility, or OCSE decision logic.
 */

import type { ExpansionBand } from '@/lib/expansion/intelligence';

export interface IdentitySeed {
  artistId: string;
  name: string;
  weight: number; // 0.0 - 1.0
  source: 'TOP_ARTIST' | 'RECENT_PLAYED' | 'SAVED_TRACK' | 'INTERNALIZED_MEMORY';
}

export interface GenreGrowthOpportunity {
  genre: string;
  stage: 'Core Identity' | 'Integrated' | 'Growing' | 'Exploring' | 'Introduced' | 'Untouched' | 'Rediscover';
  priority: number; // 0.0 - 1.0
}

export type DiscoverySourceType =
  | 'LASTFM_SIMILAR'
  | 'SPOTIFY_METADATA'
  | 'GENRE_EXPANSION'
  | 'SCENE_EXPANSION'
  | 'COLLABORATION_NETWORK'
  | 'LABEL_NETWORK'
  | 'FESTIVAL_LIVE'
  | 'PLAYLIST_COOCCURRENCE'
  | 'AUDIO_SIMILARITY'
  | 'HIDDEN_POTENTIAL'
  | 'USER_HISTORY'
  /** Leap-seek path: territory-graph far anchors (not seed adjacency). */
  | 'LEAP_SEEK'
  /** Shore-seek: deep cuts within already-explored territory. */
  | 'SHORE_SEEK';

export type RetrievalPath = 'adjacency' | 'leap_seek' | 'shore_seek';

export interface EvidenceSource {
  type: DiscoverySourceType;
  source: string;
  strength: number; // 0.0 - 1.0
  confidence: number; // 0.0 - 1.0
  metadata: Record<string, any>;
}

export interface DiscoveryContext {
  growthOpportunity: string; // The genre name this candidate supports
  relationshipStage: string; // The stage of the growth opportunity
  supportingArtists: string[]; // Explored artists in user's profile supporting this opportunity
  sources: EvidenceSource[];
}

export interface Candidate {
  artistId: string;
  name: string;
  genres: string[];
  popularity: number;
  imageUrl: string;
  discoveryContext: DiscoveryContext;
  discoveryConfidence: number; // 0.0 - 1.0
  candidateClassification: 'IDENTITY' | 'EXPANSION' | 'DISCOVERY' | 'REDISCOVERY' | 'UNKNOWN';
  // ── Expansion Intelligence outputs (Phase 2 P0-1) ──
  // Optional because they are populated by the frontier builder AFTER CUB produces
  // the Candidate, before OCSE consumes it. CUB does not set these; OCSE reads them
  // instead of fabricating its own. See docs/architecture/pipeline.md §3.
  expansionDistance?: number; // 0.0 - 1.0 — composite distance (NOT a confidence)
  expansionBand?: ExpansionBand;
  /**
   * Four-axis distance components + composite (territory/scene/era/language).
   * Prefer these over the collapsed expansionDistance for readiness / OCSE buckets.
   */
  distanceComponents?: import('@/lib/expansion/distance-components').DisaggregatedDistance;
  /**
   * @deprecated Alias of confidenceTag (metadata completeness). Not audio.
   * Accepts legacy real_audio | tag_inferred | cold_start_default for old JSON.
   */
  audioSource:
    | 'high_confidence'
    | 'partial_confidence'
    | 'low_confidence'
    | 'real_audio'
    | 'tag_inferred'
    | 'cold_start_default'
    | 'REAL'
    | 'SYNTHETIC'
    | 'MISSING';
  /** Metadata completeness across four axes (not sonic quality). */
  confidenceTag?:
    | 'high_confidence'
    | 'partial_confidence'
    | 'low_confidence'
    | 'real_audio'
    | 'tag_inferred'
    | 'cold_start_default';
  /**
   * Retrieval path that produced this candidate.
   * adjacency = seed walk; leap_seek = far territory; shore_seek = home depth.
   * Prefer camelCase; snake_case kept temporarily for in-flight JSON.
   */
  retrievalPath?: RetrievalPath;
  /** @deprecated use retrievalPath */
  retrieval_path?: RetrievalPath;
  /** Territory key when path is leap_seek. */
  sourceTerritory?: string;
  /** @deprecated use sourceTerritory */
  source_territory?: string;
  /** Spotify artist ID (empty for MusicBrainz-only artists). */
  spotifyId?: string;
  /** MusicBrainz artist UUID. */
  musicBrainzId?: string;
  /** Provider availability flags. */
  availability?: { spotify: boolean };
}

export interface CandidateUniverse {
  userId: string;
  candidates: Candidate[];
  generatedAt: string;
  identitySeeds: IdentitySeed[];
  genreGrowthOpportunities: GenreGrowthOpportunity[];
  debugStats: {
    totalSeeds: number;
    duplicateMerges: number;
    sourceBreakdown: Record<DiscoverySourceType, number>;
    candidatesPerOpportunity: Record<string, number>;
  };
}
