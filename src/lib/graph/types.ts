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
}

/** An edge in the orca graph — a relationship between two artists */
export interface OrcaEdge {
  source: string | OrcaNode;  // Node ID or resolved node reference
  target: string | OrcaNode;  // Node ID or resolved node reference
  type: 'related' | 'genre' | 'audio-similar';
  weight: number;                 // 0-1 relationship strength
}

/** A genre cluster region in the orca */
export interface GenreRegion {
  id: string;                           // Genre name slug
  name: string;                         // Display name
  color: string;                        // Hex color
  centroid: [number, number, number];   // 3D position on sphere
  nodeCount: number;
  nodeIds: string[];
}

/** The complete orca graph */
export interface OrcaGraph {
  nodes: OrcaNode[];
  edges: OrcaEdge[];
  genres: GenreRegion[];
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
