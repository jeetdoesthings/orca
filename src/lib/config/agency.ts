/**
 * Agency weight tables (Backend Fix Part 5).
 *
 * v0 is the active production prior until a recalibration proposal is
 * human-reviewed and explicitly activated. Weights must NEVER silently
 * self-modify in production.
 */

/** Canonical v0 prior — used by TEM computeAgency until approved recalibration. */
export const AGENCY_V0_WEIGHTS: Record<string, number> = {
  SEARCH: 1.0,
  ARTIST_PAGE: 0.9,
  PLAYLIST_CREATED: 0.85,
  LIBRARY_SAVE: 0.8,
  VOLUNTARY_REVISIT: 0.6,
  RECOMMENDATION: 0.3,
  AUTOPLAY: 0.1,
  BACKGROUND: 0.05,
  // Manual / product aliases
  MANUAL_CLICK: 0.8,
  FULL_PLAY: 0.6,
  SKIP: 0.0,
  // Fallbacks for older event types
  PLAY: 0.5,
  COMPLETE: 0.5,
  SAVE: 0.8,
  PLAYLIST_ADD: 0.85,
  REPLAY: 0.6,
};

export type AgencyWeightSource = 'v0' | 'approved_proposal';

export interface ActiveAgencyWeights {
  weights: Record<string, number>;
  source: AgencyWeightSource;
  proposalId?: string;
}
