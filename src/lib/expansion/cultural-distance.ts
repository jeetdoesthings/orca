/**
 * Cultural Distance — three musically meaningful axes (Backend Fix Part 3).
 *
 * Not passport/nationality. Axes:
 *   1. Linguistic — language-family relatedness
 *   2. Scene/movement — graph distance on genre adjacency (fusion/lineage later)
 *   3. Era — numeric year distance with recency-style exponential decay
 *
 * Combined as weighted sum (config). Output confidence is typically tag_inferred.
 */

import { clamp01 } from '@/lib/math';
import { GENRE_ADJACENCY } from '@/lib/config/genre-adjacency';
import { ExpansionConfig } from '@/lib/config/expansion';
import { GreConfig } from '@/lib/config/gre';
import { linguisticDistanceFromGenres } from './language-families';
import type { ConfidenceTag } from '@/lib/audio/confidence-tags';
import { normaliseGenre } from '@/lib/graph/genre-normaliser';
import {
  getDefaultTerritoryGraph,
  minTerritorySceneDistance,
} from '@/lib/territory-graph';

export interface CulturalDistanceInputs {
  userGenreProfile: Map<string, number>;
  candidateGenres: string[];
  /** Weighted median / mean release year of user identity, if known. */
  userEraYear?: number | null;
  /** Candidate / track representative year, if known. */
  candidateEraYear?: number | null;
}

export interface CulturalDistanceResult {
  distance: number;
  linguistic: number;
  scene: number;
  era: number;
  /** Part 1 tag — cultural is metadata-based. */
  confidenceTag: ConfidenceTag;
}

/** Genre → rough center year for era inference when explicit year missing. */
export const GENRE_ERA_CENTER: Record<string, number> = {
  classical: 1850,
  jazz: 1955,
  soul: 1968,
  funk: 1974,
  punk: 1978,
  metal: 1985,
  rock: 1975,
  'alternative-rock': 1994,
  'indie-rock': 2005,
  hip: 1995,
  'hip-hop': 1998,
  trap: 2014,
  drill: 2018,
  house: 1992,
  techno: 1993,
  trance: 1998,
  edm: 2012,
  'drum-and-bass': 1996,
  ambient: 1990,
  pop: 2010,
  'dance-pop': 2012,
  rnb: 2005,
  country: 1995,
  folk: 1970,
  latin: 2005,
  'world-music': 2000,
  grime: 2005,
  'uk-garage': 2000,
  'lo-fi-hip-hop': 2016,
  downtempo: 2002,
};

function userGenreList(profile: Map<string, number>): string[] {
  return Array.from(profile.keys());
}

function normGenres(genres: string[]): string[] {
  return genres.map((g) => {
    try {
      return normaliseGenre([g]);
    } catch {
      return g.toLowerCase();
    }
  });
}

/**
 * Scene/movement distance via Territory graph weighted shortest path (Part 4).
 * Lineage hops cost less than fusion — same hop count can differ.
 * Fallback: unweighted BFS hops on GENRE_ADJACENCY if graph miss.
 */
export function sceneGraphDistance(
  userGenres: string[],
  candidateGenres: string[],
  maxHops: number = ExpansionConfig.culturalSceneMaxHops,
): number {
  const user = normGenres(userGenres);
  const cand = normGenres(candidateGenres);
  if (user.length === 0 || cand.length === 0) return 1.0;

  for (const g of cand) {
    if (user.includes(g)) return 0.0;
  }

  // Part 4: weighted path (lineage < fusion)
  try {
    const graph = getDefaultTerritoryGraph();
    const weighted = minTerritorySceneDistance(graph, user, cand);
    if (weighted < 1) return weighted;
  } catch {
    // fall through to hop BFS
  }

  let best = Infinity;
  for (const start of user) {
    for (const target of cand) {
      const hops = bfsHops(start, target, maxHops);
      if (hops < best) best = hops;
    }
  }
  if (!Number.isFinite(best)) return 1.0;
  return clamp01(best / maxHops);
}

function bfsHops(start: string, target: string, maxHops: number): number {
  if (start === target) return 0;
  const q: Array<{ g: string; d: number }> = [{ g: start, d: 0 }];
  const seen = new Set<string>([start]);
  while (q.length > 0) {
    const { g, d } = q.shift()!;
    if (d >= maxHops) continue;
    const neighbors = GENRE_ADJACENCY[g] ?? [];
    for (const n of neighbors) {
      if (seen.has(n)) continue;
      if (n === target) return d + 1;
      seen.add(n);
      q.push({ g: n, d: d + 1 });
    }
  }
  return Infinity;
}

/**
 * Era distance using exponential decay (same half-life style as GRE recency).
 * |Δyears| → 1 - exp(-|Δ| / halfLifeYears), clamped [0,1].
 * Missing both years → cold default 0.5 (unknown, not max-punish).
 */
export function eraDistance(
  userYear: number | null | undefined,
  candidateYear: number | null | undefined,
  halfLifeYears: number = ExpansionConfig.culturalEraHalfLifeYears,
): number {
  if (userYear == null || candidateYear == null || !Number.isFinite(userYear) || !Number.isFinite(candidateYear)) {
    return ExpansionConfig.culturalEraMissingDefault;
  }
  const delta = Math.abs(userYear - candidateYear);
  // Same exp-decay style as GRE recency (GreConfig.recencyHalfLifeDays), in years.
  const half =
    halfLifeYears > 0
      ? halfLifeYears
      : GreConfig.recencyHalfLifeDays; // fallback if config zeroed
  return clamp01(1 - Math.exp(-delta / half));
}

export function inferEraYear(genres: string[]): number | null {
  const years: number[] = [];
  for (const g of normGenres(genres)) {
    const y = GENRE_ERA_CENTER[g];
    if (y != null) years.push(y);
  }
  if (years.length === 0) return null;
  return years.reduce((a, b) => a + b, 0) / years.length;
}

export function inferUserEraYear(userGenreProfile: Map<string, number>): number | null {
  let sum = 0;
  let wsum = 0;
  for (const [g, w] of userGenreProfile) {
    const key = normGenres([g])[0];
    const y = GENRE_ERA_CENTER[key];
    if (y == null || w <= 0) continue;
    sum += y * w;
    wsum += w;
  }
  if (wsum <= 0) return null;
  return sum / wsum;
}

/**
 * Full cultural distance composite.
 */
export function computeCulturalDistance(inputs: CulturalDistanceInputs): CulturalDistanceResult {
  const userGenres = userGenreList(inputs.userGenreProfile);
  const candGenres = inputs.candidateGenres ?? [];

  if (candGenres.length === 0 || userGenres.length === 0) {
    return {
      distance: 1.0,
      linguistic: 1.0,
      scene: 1.0,
      era: ExpansionConfig.culturalEraMissingDefault,
      confidenceTag: 'low_confidence',
    };
  }

  const linguistic = linguisticDistanceFromGenres(userGenres, candGenres);
  const scene = sceneGraphDistance(userGenres, candGenres);

  const userYear = inputs.userEraYear ?? inferUserEraYear(inputs.userGenreProfile);
  const candYear = inputs.candidateEraYear ?? inferEraYear(candGenres);
  const era = eraDistance(userYear, candYear);

  const w = ExpansionConfig.culturalAxisWeights;
  const distance = clamp01(
    w.linguistic * linguistic + w.scene * scene + w.era * era,
  );

  return {
    distance,
    linguistic,
    scene,
    era,
    confidenceTag: 'partial_confidence',
  };
}

/**
 * Drop-in replacement signature matching old culturalDistance(profile, genres).
 */
export function culturalDistance(
  userGenreProfile: Map<string, number>,
  artistGenres: string[],
): number {
  return computeCulturalDistance({
    userGenreProfile,
    candidateGenres: artistGenres,
  }).distance;
}
