/**
 * ORCA Expansion Intelligence
 *
 * The heart of the taste-expansion system. Computes how large of a musical
 * leap each candidate represents for a particular listener.
 *
 * Three core concepts:
 *   1. Expansion Distance — four-axis metadata: territory + scene + era + language
 *      (audio_distance removed; not sonic similarity)
 *   2. Expansion Value    — how much new territory this artist unlocks
 *   3. Musical Step Size  — personal leap magnitude adjusted for novelty appetite
 *
 * All functions are pure (no DB, no side effects). Deterministic unless
 * user behaviour changes the upstream inputs.
 *
 * @module expansion/intelligence
 */

import { clamp01, euclideanDistance, normalizeTempo } from '@/lib/math';
import type { AudioSignature } from '@/lib/graph/types';
import type { GenreRelationship } from '@/lib/gre/gre-types';
import { WorldConfig } from '@/lib/config/world';
import { ExpansionConfig } from '@/lib/config/expansion';
import { computeCulturalDistance } from '@/lib/expansion/cultural-distance';
import {
  computeDisaggregatedDistance,
  type ExpansionDistanceInputs,
  type DisaggregatedDistance,
} from '@/lib/expansion/distance-components';

// ─── Types ────────────────────────────────────────────────────────────

export type ExpansionBand = 'CORE' | 'FAMILIAR' | 'COMFORT_EDGE' | 'EXPANSION' | 'OUTER_EDGE' | 'UNKNOWN';

/** Re-export shared inputs + disaggregated distance types (Change A). */
export type { ExpansionDistanceInputs, DisaggregatedDistance };
export { computeDisaggregatedDistance };

export interface ExpansionValueInputs {
  candidateGenres: string[];
  exploredGenres: Set<string>;
  frontierNeighborGenres: string[];
}

// ─── 1. Acoustic Distance ────────────────────────────────────────────

/**
 * How different does the music sound?
 *
 * Euclidean distance over the 6 normalized audio dimensions
 * (energy, danceability, valence, acousticness, instrumentalness, tempo).
 * Returns [0, 1] where 0 = sonically identical, 1 = maximally different.
 */
export function acousticDistance(
  userCentroid: AudioSignature,
  artistSignature: AudioSignature,
): number {
  const userVec: number[] = [
    userCentroid.energy,
    userCentroid.danceability,
    userCentroid.valence,
    userCentroid.acousticness,
    userCentroid.instrumentalness,
    normalizeTempo(userCentroid.tempo),
  ];

  const artistVec: number[] = [
    artistSignature.energy,
    artistSignature.danceability,
    artistSignature.valence,
    artistSignature.acousticness,
    artistSignature.instrumentalness,
    normalizeTempo(artistSignature.tempo),
  ];

  // Euclidean distance in 6D space, normalized to [0, 1].
  // Max possible distance in unit cube ≈ √6 ≈ 2.45; clamp01 handles edge cases.
  const raw = euclideanDistance(userVec, artistVec);
  return clamp01(raw / Math.sqrt(6));
}

// ─── 2. Cultural Distance ────────────────────────────────────────────

/**
 * How different is the musical ecosystem? (Part 3)
 *
 * Weighted sum of linguistic / scene-graph / era axes — see
 * `cultural-distance.ts`. Not passport/nationality.
 *
 * Returns [0, 1] where 0 = same cultural territory, 1 = entirely new.
 * Confidence of the signal is typically tag_inferred (metadata).
 */
export function culturalDistance(
  userGenreProfile: Map<string, number>,
  artistGenres: string[],
  opts?: { userEraYear?: number | null; candidateEraYear?: number | null },
): number {
  return computeCulturalDistance({
    userGenreProfile,
    candidateGenres: artistGenres,
    userEraYear: opts?.userEraYear,
    candidateEraYear: opts?.candidateEraYear,
  }).distance;
}

// ─── 3. Identity Distance ─────────────────────────────────────────────

/**
 * How developed is the user's relationship with this candidate's genre?
 *
 * Derived from GRE metrics (familiarity, identity, recency), not the
 * stage enum. A genre with high familiarity + identity + recency = low
 * identity distance (the user already "owns" this territory).
 *
 * Returns [0, 1] where 0 = core identity, 1 = no relationship yet.
 */
export function identityDistance(
  genreRelationship?: GenreRelationship,
): number {
  if (!genreRelationship) return 1.0; // untracked genre = max distance

  const { familiarity, identity, recency } = genreRelationship.metrics;
  const ew = ExpansionConfig.identityEstablishednessWeights;
  const establishedness = ew.familiarity * familiarity + ew.identity * identity + ew.recency * recency;

  return 1.0 - clamp01(establishedness);
}

// ─── 4. Expansion Distance (composite) ───────────────────────────────

/**
 * How large of a musical leap does this candidate represent?
 *
 * Combines acoustic, cultural, and identity distance into a single
 * deterministic score. This is ORCA's defining concept — NOT similarity.
 *
 * Weights:
 *   0.35 acoustic  — how different it sounds
 *   0.25 cultural  — how different the ecosystem is
 *   0.25 identity  — how unexplored the territory is
 *   0.15 familiarity — how unknown the artist is (obscurity bonus)
 *
 * Returns [0, 1] where 0 = comfort zone, 1 = outer edge.
 */
export function expansionDistance(
  acoustic: number,
  cultural: number,
  identity: number,
  familiarity: number,
): number {
  const dw = ExpansionConfig.distanceWeights;
  return clamp01(
    dw.acoustic * acoustic +
    dw.cultural * cultural +
    dw.identity * identity +
    dw.familiarity * (1.0 - familiarity),
  );
}

/**
 * Convenience: compute full expansion distance from the input bundle.
 *
 * Change A: returns the composite of five first-class components
 * (audio, territory, scene, era, language). Call
 * `computeDisaggregatedDistance` when you need the components themselves.
 *
 * P1-10 honesty preserved: non-real audio does not invent sonic distance
 * (audio component stays at a neutral default with non-real confidence).
 */
export function computeExpansionDistanceFromInputs(inputs: ExpansionDistanceInputs): number {
  return computeDisaggregatedDistance(inputs).composite;
}

/**
 * Full disaggregated + composite. Preferred for OCSE / readiness / serve logs.
 */
export function computeExpansionDistanceBundle(
  inputs: ExpansionDistanceInputs,
): DisaggregatedDistance {
  return computeDisaggregatedDistance(inputs);
}

/**
 * Find the GRE relationship whose genre best matches the candidate's genres.
 */
function findBestRelationship(
  relationships: GenreRelationship[],
  candidateGenres: string[],
): GenreRelationship | undefined {
  if (relationships.length === 0 || candidateGenres.length === 0) return undefined;

  // Prefer exact genre match, then fall back to the first relationship
  for (const genre of candidateGenres) {
    const match = relationships.find(r => r.genre === genre);
    if (match) return match;
  }

  return undefined;
}

// ─── 5. Expansion Value ───────────────────────────────────────────────

/**
 * How much new territory does this artist unlock?
 *
 * Artists whose frontier neighbors touch genres the user hasn't explored
 * yet are "gateways" — they connect the known world to the unknown.
 * Higher gateway value = higher expansion value.
 *
 * Returns [0, 1].
 */
export function expansionValue(inputs: ExpansionValueInputs): number {
  const { candidateGenres, exploredGenres, frontierNeighborGenres } = inputs;

  if (exploredGenres.size === 0) {
    // Cold start: everything is new territory
    return ExpansionConfig.coldStartBaseline; // baseline, not maximum — no data to assess gateway quality
  }

  // Count how many genres the candidate's frontier-neighbors touch
  // that the user has NOT yet explored
  const unexploredNeighborGenres = new Set<string>();
  for (const genre of frontierNeighborGenres) {
    if (!exploredGenres.has(genre)) {
      unexploredNeighborGenres.add(genre);
    }
  }

  // Count how many of the candidate's OWN genres are unexplored
  const unexploredOwnGenres = candidateGenres.filter(g => !exploredGenres.has(g));

  // Gateway score: more unexplored territory touched = higher value
  const gw = ExpansionConfig.gatewayScoreWeights;
  const gatewayScore = clamp01(
    (unexploredNeighborGenres.size * gw.neighborGenres + unexploredOwnGenres.length * gw.ownGenres) / gw.divisor,
  );

  return Math.max(ExpansionConfig.minimumExpansionValue, gatewayScore); // minimum — every candidate has some potential
}

// ─── 6. Musical Step Size ────────────────────────────────────────────

/**
 * Personalizes the leap magnitude based on the user's novelty appetite.
 *
 * A user with high novelty appetite should see the same expansion distance
 * as a smaller personal step. A conservative user sees it as a bigger leap.
 *
 * Returns [0, 1].
 */
export function musicalStepSize(
  distance: number,
  noveltyAppetite: number,
): number {
  const ss = ExpansionConfig.stepSizeScale;
  return clamp01(distance * (ss.base + ss.appetite * noveltyAppetite));
}

// ─── 7. Band Classification ─────────────────────────────────────────

/**
 * Maps an expansion distance value to a visual band label.
 *
 * Band thresholds from WorldConfig.expansionBands. This is the single
 * canonical mapping — replaces all inline threshold logic elsewhere.
 */
export function expansionBandFromDistance(distance: number): ExpansionBand {
  if (distance == null || Number.isNaN(distance)) return 'UNKNOWN';

  const eb = WorldConfig.expansionBands;
  if (distance < eb.core) return 'CORE';
  if (distance < eb.familiar) return 'FAMILIAR';
  if (distance < eb.comfortEdge) return 'COMFORT_EDGE';
  if (distance < eb.expansion) return 'EXPANSION';
  if (distance <= eb.outerEdge) return 'OUTER_EDGE';
  return 'UNKNOWN';
}
