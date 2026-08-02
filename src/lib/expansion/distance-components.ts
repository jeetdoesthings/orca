/**
 * Disaggregated distance components — four-axis metadata model.
 *
 * Axes: territory | scene | era | language.
 * audio_distance was removed (neutral-default noise / false leap closeness).
 * Composite is a weighted blend of these four only.
 *
 * Historical RecommendationServeLog rows may still contain audioDistance columns
 * from before this change; new computation never produces audio_distance.
 *
 * @module expansion/distance-components
 */

import { clamp01 } from '@/lib/math';
import type { GenreRelationship } from '@/lib/gre/gre-types';
import type { AudioSignature } from '@/lib/graph/types';
import { ExpansionConfig } from '@/lib/config/expansion';
import { computeCulturalDistance } from '@/lib/expansion/cultural-distance';
import {
  getDefaultTerritoryGraph,
  minTerritorySceneDistance,
} from '@/lib/territory-graph';
import { normaliseGenre } from '@/lib/graph/genre-normaliser';
import { priorFamiliarity } from '@/lib/metrics/familiarity';

/**
 * Shared inputs for expansion / disaggregated distance.
 * Audio signatures optional (deprecated path; not used in composite).
 */
export interface ExpansionDistanceInputs {
  /** @deprecated Not used in four-axis composite. Kept for call-site compat. */
  userCentroid?: AudioSignature;
  userGenreProfile: Map<string, number>;
  relationships: GenreRelationship[];
  candidateGenres: string[];
  /** @deprecated Not used in four-axis composite. */
  candidateSignature?: AudioSignature;
  candidatePopularity: number;
  /** @deprecated Prefer axis completeness → compositeConfidence. */
  audioSource?: string;
  priorObservedPlays?: number;
  userEraYear?: number | null;
  candidateEraYear?: number | null;
}

function identityDistanceLocal(genreRelationship?: GenreRelationship): number {
  if (!genreRelationship) return 1.0;
  const { familiarity, identity, recency } = genreRelationship.metrics;
  const ew = ExpansionConfig.identityEstablishednessWeights;
  const establishedness =
    ew.familiarity * familiarity + ew.identity * identity + ew.recency * recency;
  return 1.0 - clamp01(establishedness);
}

// ─── Types ────────────────────────────────────────────────────────────

/**
 * Per-axis signal quality (not sonic).
 * - high_confidence: axis has real metadata graph / tag coverage
 * - partial_confidence: weak or defaulted cultural/era path
 * - low_confidence: missing graph placement / cold defaults
 *
 * Legacy aliases (normalize only): real_audio→high, tag_inferred→partial, cold_start→low
 */
export type DistanceConfidence =
  | 'high_confidence'
  | 'partial_confidence'
  | 'low_confidence';

export interface DistanceComponent {
  value: number; // 0–1
  confidence: DistanceConfidence;
}

/**
 * Four first-class distance axes + composite.
 * No audio_distance field (removed — not present-but-zero).
 */
export interface DisaggregatedDistance {
  territory_distance: DistanceComponent;
  scene_distance: DistanceComponent;
  era_distance: DistanceComponent;
  language_distance: DistanceComponent;
  /** Weighted blend of the four axes only. */
  composite: number;
  /**
   * Completeness across four axes:
   * high = all axes non-low; partial = mix; low = mostly cold defaults.
   */
  compositeConfidence: DistanceConfidence;
}

const CONFIDENCE_RANK: Record<DistanceConfidence, number> = {
  high_confidence: 2,
  partial_confidence: 1,
  low_confidence: 0,
};

function mapLegacyAxisConfidence(
  raw: 'tag_inferred' | 'cold_start_default' | 'real_audio' | string,
): DistanceConfidence {
  if (raw === 'cold_start_default' || raw === 'MISSING') return 'low_confidence';
  if (raw === 'real_audio' || raw === 'REAL') return 'high_confidence';
  // tag_inferred cultural graph / GRE → partial (metadata, not measured audio)
  return 'partial_confidence';
}

function weakestConfidence(tags: DistanceConfidence[]): DistanceConfidence {
  let worst: DistanceConfidence = 'high_confidence';
  for (const t of tags) {
    if (CONFIDENCE_RANK[t] < CONFIDENCE_RANK[worst]) worst = t;
  }
  return worst;
}

/** Completeness policy from four axis confidences. */
export function confidenceFromAxisTags(
  tags: DistanceConfidence[],
): DistanceConfidence {
  if (tags.length === 0) return 'low_confidence';
  const low = tags.filter((t) => t === 'low_confidence').length;
  const high = tags.filter((t) => t === 'high_confidence').length;
  if (low === 0 && high === tags.length) return 'high_confidence';
  if (low === 0) return 'partial_confidence'; // all partial or mix high/partial
  if (low >= Math.ceil(tags.length * 0.5)) return 'low_confidence';
  return 'partial_confidence';
}

function findBestRelationship(
  relationships: GenreRelationship[],
  candidateGenres: string[],
): GenreRelationship | undefined {
  if (relationships.length === 0 || candidateGenres.length === 0) return undefined;
  for (const genre of candidateGenres) {
    const match = relationships.find((r) => r.genre === genre);
    if (match) return match;
  }
  return undefined;
}

function normGenreList(genres: string[]): string[] {
  return genres.map((g) => {
    try {
      return normaliseGenre([g]);
    } catch {
      return g.toLowerCase();
    }
  });
}

/**
 * Territory distance: genre-lineage / identity leap via territory graph + GRE.
 */
export function territoryGraphDistance(
  userGenreProfile: Map<string, number>,
  candidateGenres: string[],
  relationships: GenreRelationship[],
): DistanceComponent {
  const userGenres = normGenreList(Array.from(userGenreProfile.keys()));
  const candGenres = normGenreList(candidateGenres);

  if (userGenres.length === 0 || candGenres.length === 0) {
    const rel = findBestRelationship(relationships, candidateGenres);
    return {
      value: identityDistanceLocal(rel),
      confidence: rel ? 'partial_confidence' : 'low_confidence',
    };
  }

  try {
    const graph = getDefaultTerritoryGraph();
    const pathDist = minTerritorySceneDistance(graph, userGenres, candGenres);
    const rel = findBestRelationship(relationships, candidateGenres);
    const idDist = identityDistanceLocal(rel);
    const blended = clamp01(0.7 * pathDist + 0.3 * idDist);
    // Graph placement = high; pure GRE fallback without graph already handled
    return {
      value: blended,
      confidence: rel ? 'high_confidence' : 'partial_confidence',
    };
  } catch {
    const rel = findBestRelationship(relationships, candidateGenres);
    return {
      value: identityDistanceLocal(rel),
      confidence: rel ? 'partial_confidence' : 'low_confidence',
    };
  }
}

/**
 * Compute four distance components + composite for one candidate–user pair.
 * No audio_distance.
 */
export function computeDisaggregatedDistance(
  inputs: ExpansionDistanceInputs,
): DisaggregatedDistance {
  // ── cultural axes (language, scene, era) ──────────────────────────
  const cultural = computeCulturalDistance({
    userGenreProfile: inputs.userGenreProfile,
    candidateGenres: inputs.candidateGenres,
    userEraYear: inputs.userEraYear,
    candidateEraYear: inputs.candidateEraYear,
  });

  const culturalConf = mapLegacyAxisConfidence(cultural.confidenceTag);

  const language_distance: DistanceComponent = {
    value: clamp01(cultural.linguistic),
    confidence: culturalConf,
  };

  const scene_distance: DistanceComponent = {
    value: clamp01(cultural.scene),
    confidence: culturalConf,
  };

  const era_distance: DistanceComponent = {
    value: clamp01(cultural.era),
    confidence:
      inputs.userEraYear == null && inputs.candidateEraYear == null
        ? culturalConf === 'low_confidence'
          ? 'low_confidence'
          : 'partial_confidence'
        : 'high_confidence',
  };

  // ── territory_distance ────────────────────────────────────────────
  const territory_distance = territoryGraphDistance(
    inputs.userGenreProfile,
    inputs.candidateGenres,
    inputs.relationships,
  );

  // ── composite (four-way provisional weights — sum 1.0) ────────────
  const w = ExpansionConfig.compositeComponentWeights;
  const composite = clamp01(
    w.territory * territory_distance.value +
      w.scene * scene_distance.value +
      w.era * era_distance.value +
      w.language * language_distance.value,
  );

  const famW = ExpansionConfig.compositeFamiliarityNudge ?? 0;
  let finalComposite = composite;
  if (famW > 0) {
    const rel = findBestRelationship(inputs.relationships, inputs.candidateGenres);
    const familiarity =
      inputs.priorObservedPlays !== undefined
        ? priorFamiliarity(inputs.priorObservedPlays)
        : (rel?.metrics.familiarity ?? 0);
    finalComposite = clamp01(composite * (1 - famW) + famW * (1 - familiarity));
  }

  const axisTags = [
    territory_distance.confidence,
    scene_distance.confidence,
    era_distance.confidence,
    language_distance.confidence,
  ];
  const compositeConfidence = confidenceFromAxisTags(axisTags);

  return {
    territory_distance,
    scene_distance,
    era_distance,
    language_distance,
    composite: Math.round(finalComposite * 1000) / 1000,
    compositeConfidence,
  };
}

/** JSON-safe plain object for persistence on nodes / serve logs. */
export function serializeDisaggregatedDistance(
  d: DisaggregatedDistance,
): Record<string, unknown> {
  return {
    territory_distance: d.territory_distance,
    scene_distance: d.scene_distance,
    era_distance: d.era_distance,
    language_distance: d.language_distance,
    composite: d.composite,
    compositeConfidence: d.compositeConfidence,
  };
}
