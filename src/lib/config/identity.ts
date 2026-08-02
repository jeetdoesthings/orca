/**
 * Identity Builder configuration.
 * Controls maximum limits for seeds extraction, weights, and fallback identities.
 */
export const IdentityConfig = {
  /** Maximum top artists to extract from listening history */
  maxTopArtists: 20,
  /** Maximum saved tracks to extract from saved library */
  maxSavedTracks: 50,
  /** Hard cap on total seeds pool size */
  maxSeedPoolSize: 30,
  /** Listening history seed weight factor */
  seedTopArtistWeight: 1.0,
  /** Saved track memory seed weight factor */
  seedSavedTrackWeight: 0.6,
  /** Standard cold-start fallback profiles if no database events exist */
  fallbackSeeds: [
    { id: 'lastfm-fredagain', displayName: 'Fred again..' },
    { id: 'lastfm-bicep', displayName: 'Bicep' },
    { id: 'lastfm-fourtet', displayName: 'Four Tet' },
    { id: 'lastfm-overmono', displayName: 'Overmono' },
    { id: 'lastfm-barrycantswim', displayName: 'Barry Can\'t Swim' },
  ],

  /**
   * Part 9: base learning rate for Identity centroid EMA.
   * Effective alpha = stepSize * TES (TES in [0,1]).
   * High durable TES moves centroid more; passive low TES barely moves.
   */
  centroidEmaStepSize: 0.15,

  /** Part 10: max genre picks in onboarding self-select (not a long quiz). */
  coldStartMaxGenrePicks: 6,
  /** Part 10: max artist picks in onboarding. */
  coldStartMaxArtistPicks: 5,
};
