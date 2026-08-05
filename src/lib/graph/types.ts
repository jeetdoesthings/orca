import type { DecisionProfile } from '@/lib/ocse/ocse-types';

/**
 * Core type definitions for the ORCA graph system.
 * All graph data structures, node/edge types, and layout interfaces.
 */

/** Aggregated audio characteristics of an artist's music */
export interface AudioSignature {
  energy: number;           // 0-1
  valence: number;          // 0-1 (emotional positivity)
  danceability: number;     // 0-1
  acousticness: number;     // 0-1
  instrumentalness: number; // 0-1
  tempo: number;            // BPM
}

/** A node in the orca graph — represents an artist */
export interface OrcaNode {
  id: string;                                   // Spotify artist ID
  name: string;
  genres: string[];                             // Raw Spotify genres
  popularity: number;                           // 0-100
  imageUrl: string;                             // Artist/album image URL
  weight: number;                               // User's listening weight 0-1
  state: 'explored' | 'frontier' | 'dormant';
  audioSignature: AudioSignature;
  /**
   * Part 1 / RULE-15 honesty flag (confidence tag).
   * real_audio | tag_inferred | cold_start_default
   * Legacy REAL | SYNTHETIC | MISSING still accepted by normalizers.
   */
  /** Metadata completeness (or legacy audio-era aliases). */
  audioSource?:
    | 'high_confidence'
    | 'partial_confidence'
    | 'low_confidence'
    | 'real_audio'
    | 'tag_inferred'
    | 'cold_start_default'
    | 'REAL'
    | 'SYNTHETIC'
    | 'MISSING';
  /** Preferred name for audioSource (same values). */
  confidenceTag?:
    | 'high_confidence'
    | 'partial_confidence'
    | 'low_confidence'
    | 'real_audio'
    | 'tag_inferred'
    | 'cold_start_default';

  /** Spotify artist ID (22-char base62). Empty for MusicBrainz-only artists. */
  spotifyId?: string;
  /** MusicBrainz artist UUID (36-char). */
  musicBrainzId?: string;
  /** External URL for artists not on Spotify (e.g. YouTube search). */
  externalUrl?: string;

  // Phase 3 Layer 3 weight components
  weightShort?: number;
  weightMedium?: number;
  weightLong?: number;
  frequencyScore?: number;
  recencyScore?: number;
  persistenceScore?: number;
  // IDs of explored artists this frontier node is adjacent to (frontier nodes only)
  adjacentTo?: string[];
  // Layout positions (set by force layout, optional until computed)
  x?: number;
  y?: number;
  z?: number;
  // Velocity (used internally by d3-force-3d)
  vx?: number;
  vy?: number;
  vz?: number;
  // Fixed positions (used internally by d3-force-3d)
  fx?: number;
  fy?: number;
  fz?: number;
  // d3-force-3d index
  index?: number;

  // Phase 3: Relationship state from /api/globe enrichment
  relationshipState?: 'UNEXPLORED' | 'CURIOUS' | 'EXPLORING' | 'RESIDENT'
                    | 'STABILIZED' | 'DORMANT' | 'RETURNING' | 'RESISTANT'
                    | 'REJECTED' | 'EMERGING';
  memoryStrength?: number | null;   // 0-100 from user-artist memory
  territory?: string;               // territory display name

  // Dynamic artist state fields
  bridgeArtist?: boolean;
  gatewayArtist?: boolean;
  alreadyIntegrated?: boolean;
  recommendedNext?: boolean;
  
  // OCSE Semantic Classification Role
  semanticRole?: 'REACHABLE' | 'BRIDGE' | 'RECOMMENDED_EXPANSION' | 'RECOVERY' | 'HIDDEN_POTENTIAL' | 'IDENTITY_REINFORCEMENT' | 'DORMANT_MEMORY';
  candidateEvidence?: DecisionProfile;
  discoveredRecently?: boolean;
  memoryContribution?: number;
  availableActions?: string[] | {
    canExplore: boolean;
    canSave: boolean;
    canListen: boolean;
  };
  reachable?: boolean;
  visible?: boolean;
  confidenceBand?: string;
  reasoning?: string[];
  /** OCSE decision reasons — why this candidate was recommended */
  decisionReasons?: string[];
  /** OCSE explanation — human-readable rationale for the decision */
  explanation?: string[];
  expansionDistance?: number;
  expansionBand?: 'CORE' | 'FAMILIAR' | 'COMFORT_EDGE' | 'EXPANSION' | 'OUTER_EDGE' | 'UNKNOWN';
  /** Change A: disaggregated distances (JSON-safe on materialize). */
  distanceComponents?: import('@/lib/expansion/distance-components').DisaggregatedDistance;
  /** Change C/E: which Recommendation Surface bucket this node was assigned to. */
  readinessBucket?: 'comfort' | 'expansion' | 'leap';
  /** Change E: visual emphasis for active tier (1 = full, lower = de-emphasized). */
  tierEmphasis?: number;
  /** True when node is in the active Shore/Shallow/Deep/Alo band. */
  inActiveDepth?: boolean;
  /** adjacency | leap_seek | shore_seek retrieval path. */
  retrievalPath?: 'adjacency' | 'leap_seek' | 'shore_seek';
  /** Territory key for leap_seek / shore_seek candidates. */
  sourceTerritory?: string;
  projectionMetadata?: {
    expansionDistance: number;
    expansionBand: 'CORE' | 'FAMILIAR' | 'COMFORT_EDGE' | 'EXPANSION' | 'OUTER_EDGE' | 'UNKNOWN';
    /** True when the display distance was rank-remapped due to collapse / empty band. */
    displayDistanceRemapped?: boolean;
  };
}

/** An edge in the orca graph — a relationship between two artists */
export interface OrcaEdge {
  source: string | OrcaNode;  // Node ID or resolved node reference
  target: string | OrcaNode;  // Node ID or resolved node reference
  type: 'related' | 'genre' | 'audio-similar';
  weight: number;                 // 0-1 relationship strength
}

export interface GenreRelationship {
  current: string; // e.g. UNEXPLORED, CURIOUS, EXPLORING, RESIDENT, DORMANT
  confidence: number;
  direction: 'STABLE' | 'GROWING' | 'FADING';
  stability: number;
  momentum: number;
}

export interface GenreIdentity {
  strength: number;
  stability: number;
  maturity: number;
  confidence: number;
}



export interface GenreGrowth {
  tasteMemory: number;
  tasteExpansion: number;
  expansionVelocity: number;
  memoryDirection: 'STABLE' | 'GROWING' | 'FADING';
  expansionDirection: 'STABLE' | 'GROWING' | 'FADING';
  confidence: number;
}

export interface GenreCurrentSession {
  mindsetCompatibility: number;
  currentIntentMatch: number;
  sessionSuitability: number;
  immediateReadiness: number;
}

export interface GenreDiscovery {
  integratedArtists: string[];
  bridgeArtists: string[];
  gatewayArtists: string[];
  reachableArtists: string[];
  recentlyDiscovered: string[];
  potentialDiscoveries: string[];
}

export interface GenreOpportunities {
  recoveryAvailable: boolean;
  expansionOpportunity: boolean;
  hiddenPotential: boolean;
  retryOpportunity: boolean;
}

export interface GenreHistory {
  firstDiscovery: string | null;
  latestOrganicVisit: string | null;
  previousInterventions: number;
  longitudinalState: string;
}

export interface GenreConfidence {
  relationship: number;
  expansion: number;
  identity: number;
  mindset: number;
  discovery: number;
}

export interface GenreAvailableActions {
  canExpand: boolean;
  canPause: boolean;
  canResume: boolean;
  canRetry: boolean;
  canExplore: boolean;
  canSave: boolean;
  canIgnore: boolean;
}

/** A genre cluster region in the orca — representing a Genre Intelligence Snapshot (GIS) */
export interface GenreRegion {
  id: string;                           // Genre name slug
  name: string;                         // Display name
  color: string;                        // Hex color
  centroid: [number, number, number];   // 3D position on sphere
  nodeCount: number;
  nodeIds: string[];
  
  // GIA Snapshot layers
  relationship?: GenreRelationship;
  identity?: GenreIdentity;
  growth?: GenreGrowth;
  currentSession?: GenreCurrentSession;
  discovery?: GenreDiscovery;
  opportunities?: GenreOpportunities;
  history?: GenreHistory;
  confidence?: GenreConfidence;
  availableActions?: GenreAvailableActions;
}

/** The complete orca graph */
export interface OrcaGraph {
  nodes: OrcaNode[];
  edges: OrcaEdge[];
  genres: GenreRegion[];
}

export interface ObservationAction {
  name: string;            // e.g. "START_PATHWAY", "FOLLOW_ARTIST"
  label: string;           // button text
  endpoint: string;        // e.g. "/api/world/regenerate"
  method: "POST" | "GET";
  payload?: any;           // optional body for POST
}

export interface Observation {
  id: string;
  type: string;
  summary: string;
  detail?: string;
  priority: number;        // 1 (highest) to 5 (low)
  confidence: number;      // 0.0 to 1.0
  timestamp: string;       // ISO 8601
  relatedEntities: {
    genreId?: string;
    artistId?: string;
  };
  availableActions: ObservationAction[]; // actions mapping
  ttl: number;             // seconds before auto-expire
  status: "active" | "acknowledged";
}

export interface ObservationRule {
  id: string;
  type: string;            // "threshold", "pattern", "temporal", "composite"
  description: string;
}

export interface ObservationTriggerPayload {
  timestamp?: string;
}

/** Interface for the force-directed layout engine */
export interface ForceLayout {
  /** Run the full initial layout (synchronous, ~300 ticks) */
  initialize(): void;
  /** Run a single tick for gentle animation */
  tick(): boolean;
  /** Get current node positions */
  getPositions(): Map<string, [number, number, number]>;
  /** Add new nodes and edges to the running simulation */
  addNodes(nodes: OrcaNode[], edges: OrcaEdge[]): void;
  /** Stop the simulation */
  stop(): void;
  /** Update genre centroids after layout changes */
  updateGenreCentroids(graph: OrcaGraph): void;
}
