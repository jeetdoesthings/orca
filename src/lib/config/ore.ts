/**
 * ORCA Retrieval Engine (ORE) configuration.
 *
 * P1-9b: every per-source confidence is defined here once rather than
 * scattered inline as `relationshipConfidence: <number>` literals across
 * `src/lib/candidate/ore.ts`. ORE produces per-source evidence (Family A);
 * the canonical discoveryConfidence aggregation lives in CUB
 * (`calculateDiscoveryConfidence`) — see P1-7 for the aggregate removal.
 *
 * The keys name the ORE provider that assigns the confidence. The evidence
 * `source:` strings emitted downstream are human-readable labels (e.g.
 * 'Local Knowledge Graph') and stay unchanged; only the numeric confidence
 * moves to this table.
 */
export const OreConfig = {
  /**
   * Depth-2 recursive expansion (neighbors of neighbors) doubles external API
   * cost for marginal recall. Default OFF — the demo/materialize path runs
   * depth-1 only, which keeps sync-demo fast without hurting surface quality.
   */
  enableDepth2Expansion: false,

  /** Per-source relationship confidence — assigned at the ORE provider call
   * site to the ORECandidate.relationshipConfidence field.
   *
   * Semantics:
   *   - 1.0   = seed / direct user-introduced identity evidence;
   *   - 0.95  = trusted catalog metadata (local graph);
   *   - 0.75–0.9 = community-funded provenance (MB relationships, territory fall-backs);
   *   - 0.6–0.7 = weak provenance (derived/scene/heuristic fallbacks).
   * Note: Spotify related-artists removed (Part 1 — permanently restricted).
   */
  sourceConfidence: {
    // LocalKnowledgeGraphProvider — DB-backed neighbour / metadata cache.
    LOCAL_KNOWLEDGE_GRAPH: 0.95,
    // SpotifyProvider — related-artists disabled; reserved for metadata-only if reintroduced safely.
    SPOTIFY_SIMILAR: 0.9,
    // LastFmProvider — Last.fm similar, dynamic similarity score or hard fallback.
    LASTFM_SIMILAR: 0.95,
    // LastFmProvider — when sim.match is missing, fall back to this floor.
    LASTFM_DYNAMIC_FALLBACK: 0.7,
    // MusicBrainzProvider — relationship graph traversals.
    MUSICBRAINZ_RELATIONSHIP: 0.75,
    // Genre representatives fallback (deeper hop in a missing genre).
    GENRE_REPRESENTATIVES: 0.6,
    // Seed-artist-as-candidate (the user's own identity row).
    SEED: 1.0,
    // Territory Fallback (artist showing up in a user territory with no direct edge).
    TERRITORY_FALLBACK: 0.8,
    // Neighbouring Territory Fallback (adjacent territory hop).
    NEIGHBOURING_TERRITORY: 0.7,
    // Curated Scene Fallback (scene-collection membership heuristic).
    CURATED_SCENE: 0.65,
  },
};
