/**
 * ORCA Profile Engine
 *
 * Central pipeline orchestrator that computes a user's multi-layered taste profile.
 *
 * Execution Flow:
 *   1. Filter and validate explored graph nodes.
 *   2. Compute Surface Profile (artist & genre distributions, unique counts).
 *   3. Compute Sonic Profile (weighted centroid, variance, extremes, dominant dimensions).
 *   4. Compute behavioral Meta-Signals (diversity, popularity metrics, feature variances).
 *   5. Compute Trait Profile (dynamic registry scoring, trends from previous snapshot).
 *   6. Compute Discovery Profile (novelty appetite, readiness band, optimal novelty distance).
 *   7. Compute Confidence Profile (completeness, signal strength, stability segments).
 *   8. Compute Trajectory Profile (taste shift detection and velocity over time).
 *   9. Generate Explanations (human-readable summaries and trait descriptions).
 *  10. Assemble and return the complete UserProfile payload.
 *
 * All modules are pure-data driven — no hard-coded artists or genre branches.
 *
 * @module profile-engine
 */

import type { OrcaNode } from '@/lib/graph/types';
import type {
  UserProfile,
  SurfaceProfile,
  SonicProfile,
  TraitProfile,
  DiscoveryProfile,
  TrajectoryProfile,
  ConfidenceProfile,
  ExplanationPayload,
  ComputedMetaSignals,
  SurfaceArtist,
  SurfaceGenre,
} from './types';

import { computeSonicProfile } from './sonic-analyzer';
import { computeAllTraitScores } from './trait-inference';
import { computeDiscoveryProfile } from './discovery-readiness';
import { computeTrajectoryProfile } from './trajectory-tracker';
import { generateExplanations } from './explainer';

// ─── Constants ──────────────────────────────────────────────────────

/** Current version of the profiling system schema */
const PROFILE_VERSION = 1;

/** Number of artists/genres to keep in the SurfaceProfile */
const SURFACE_ARTISTS_LIMIT = 20;
const SURFACE_GENRES_LIMIT = 20;

// ─── Helper Functions ───────────────────────────────────────────────


/**
 * Computes Shannon entropy (normalized) of primary genres.
 */
function computeNormalizedEntropy(nodes: OrcaNode[]): number {
  const genreCounts = new Map<string, number>();

  for (const node of nodes) {
    const genre = node.genres.length > 0 ? node.genres[0] : 'unknown';
    genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
  }

  const uniqueCount = genreCounts.size;
  if (uniqueCount <= 1) {
    return 0;
  }

  const total = nodes.length;
  let entropy = 0;

  for (const count of genreCounts.values()) {
    const p = count / total;
    if (p > 0) {
      entropy -= p * Math.log(p);
    }
  }

  return entropy / Math.log(uniqueCount);
}

/**
 * Creates an empty, default profile when no listening history is present.
 */
function createEmptyProfile(userId: string): UserProfile {
  const now = new Date().toISOString();

  const emptySurface: SurfaceProfile = {
    topArtists: [],
    topGenres: [],
    totalArtists: 0,
    totalGenres: 0,
    listeningDistribution: {},
  };

  const emptySonic: SonicProfile = {
    centroid: { energy: 0, valence: 0, danceability: 0, acousticness: 0, instrumentalness: 0, tempo: 0 },
    variance: { energy: 0, valence: 0, danceability: 0, acousticness: 0, instrumentalness: 0, tempo: 0 },
    extremes: [],
    dominantDimensions: [],
  };

  const emptyTrait: TraitProfile = {
    scores: [],
    dominantTraits: [],
    emergingTraits: [],
    absentTraits: [],
  };

  const emptyDiscovery: DiscoveryProfile = {
    noveltyAppetite: 0,
    genreDiversity: 0,
    artistDiversity: 0,
    boundaryOpenness: 0,
    explorationVelocity: 0,
    overallReadiness: 0,
    readinessLabel: 'low',
    optimalNoveltyLevel: 0.2,
  };

  const emptyTrajectory: TrajectoryProfile = {
    direction: 'stable',
    velocity: 0,
    recentShifts: [],
    longTermTrend: 'No history available.',
    stability: 1.0,
  };

  const emptyConfidence: ConfidenceProfile = {
    overall: 0,
    dataCompleteness: 0,
    sampleSize: 0,
    signalStrength: 0,
    stableTraits: [],
    emergingTraits: [],
    speculativeTraits: [],
  };

  const emptyExplanations: ExplanationPayload = {
    shortSummary: 'Your taste profile is still forming — keep listening.',
    detailedSummary: 'Connect your music library to begin building your ORCA taste profile.',
    traitExplanations: {},
    discoveryExplanation: 'No discovery readiness data available.',
    trajectoryExplanation: 'No history available.',
  };

  return {
    userId,
    version: PROFILE_VERSION,
    createdAt: now,
    updatedAt: now,
    surfaceProfile: emptySurface,
    sonicProfile: emptySonic,
    traitProfile: emptyTrait,
    discoveryProfile: emptyDiscovery,
    trajectoryProfile: emptyTrajectory,
    confidenceProfile: emptyConfidence,
    explanations: emptyExplanations,
  };
}

// ─── Master Pipeline Entry ──────────────────────────────────────────

/**
 * Computes the complete multi-layer user profile from listening history.
 *
 * @param userId          - Unique ID of the target user
 * @param nodes           - All OrcaNode entries associated with the user (both explored and frontier)
 * @param frontierCount   - Number of frontier nodes currently active in the graph
 * @param previousProfile - User's previously saved UserProfile, or null if first run
 * @returns Fully populated UserProfile
 */
export function computeUserProfile(
  userId: string,
  nodes: OrcaNode[],
  frontierCount: number,
  previousProfile: UserProfile | null,
): UserProfile {
  const exploredNodes = nodes.filter((node) => node.state === 'explored');

  if (exploredNodes.length === 0) {
    return createEmptyProfile(userId);
  }

  const now = new Date().toISOString();

  // ── Step 1: Surface Profile Layer ─────────────────────────────────
  // Sort explored artists by listening weight descending
  const sortedExplored = [...exploredNodes].sort((a, b) => b.weight - a.weight);

  const topArtists: SurfaceArtist[] = sortedExplored
    .slice(0, SURFACE_ARTISTS_LIMIT)
    .map((node) => ({
      id: node.id,
      name: node.name,
      weight: node.weight,
    }));

  // Aggregate genres
  const genreWeightMap = new Map<string, { weight: number; count: number }>();
  const allUniqueGenres = new Set<string>();

  for (const node of exploredNodes) {
    for (const genre of node.genres) {
      allUniqueGenres.add(genre);
      const entry = genreWeightMap.get(genre) ?? { weight: 0, count: 0 };
      entry.weight += node.weight;
      entry.count += 1;
      genreWeightMap.set(genre, entry);
    }
  }

  const sortedGenres: SurfaceGenre[] = Array.from(genreWeightMap.entries())
    .map(([genre, entry]) => ({
      genre,
      weight: entry.weight,
      count: entry.count,
    }))
    .sort((a, b) => b.weight - a.weight);

  const topGenres = sortedGenres.slice(0, SURFACE_GENRES_LIMIT);

  // Normalize genre listening distribution
  const totalGenreWeight = sortedGenres.reduce((sum, g) => sum + g.weight, 0);
  const listeningDistribution: Record<string, number> = {};

  for (const g of sortedGenres) {
    listeningDistribution[g.genre] = totalGenreWeight > 0 ? g.weight / totalGenreWeight : 0;
  }

  const surfaceProfile: SurfaceProfile = {
    topArtists,
    topGenres,
    totalArtists: exploredNodes.length,
    totalGenres: allUniqueGenres.size,
    listeningDistribution,
  };

  // ── Step 2: Sonic Profile Layer ───────────────────────────────────
  const sonicProfile = computeSonicProfile(exploredNodes);

  // ── Step 3: Meta-Signals Computation ──────────────────────────────
  const totalWeight = exploredNodes.reduce((sum, node) => sum + node.weight, 0);

  // Weighted popularity mean
  const weightedPopularitySum = exploredNodes.reduce((sum, node) => sum + node.weight * (node.popularity / 100), 0);
  const popularityAvg = totalWeight > 0 ? weightedPopularitySum / totalWeight : 0;

  // Weighted popularity variance
  const popularityDiffSqSum = exploredNodes.reduce((sum, node) => {
    const diff = (node.popularity / 100) - popularityAvg;
    return sum + node.weight * diff * diff;
  }, 0);
  const popularityVariance = totalWeight > 0 ? popularityDiffSqSum / totalWeight : 0;

  // Weight concentration (Herfindahl-like index of listening weights)
  const sumSquaredWeights = exploredNodes.reduce((sum, node) => sum + node.weight * node.weight, 0);
  const weightConcentration = totalWeight > 0 ? sumSquaredWeights / (totalWeight * totalWeight) : 0;

  // Normalized tempo variance (tempo range is 160 BPM, variance is squared scale)
  const tempoVariance = sonicProfile.variance.tempo / (160 * 160);

  // Average feature variance (across the 5 normalized 0-1 dimensions)
  const featureVariance = (
    sonicProfile.variance.energy +
    sonicProfile.variance.valence +
    sonicProfile.variance.danceability +
    sonicProfile.variance.acousticness +
    sonicProfile.variance.instrumentalness
  ) / 5;

  const genreDiversity = computeNormalizedEntropy(exploredNodes);

  const metaSignals: ComputedMetaSignals = {
    genreDiversity,
    popularityAvg,
    popularityVariance,
    tempoVariance,
    featureVariance,
    artistCount: exploredNodes.length,
    weightConcentration,
  };

  // ── Step 4: Trait Profile Layer ───────────────────────────────────
  const previousTraitScores = previousProfile?.traitProfile.scores ?? null;
  const traitScores = computeAllTraitScores(
    sonicProfile.centroid,
    metaSignals,
    previousTraitScores,
  );

  // Filter dominant traits: score >= 0.5 & confidence >= 0.5, sorted by score descending
  const dominantTraits = traitScores
    .filter((ts) => ts.score >= 0.5 && ts.confidence >= 0.5)
    .sort((a, b) => b.score - a.score)
    .map((ts) => ts.traitId)
    .slice(0, 5);

  // Emerging traits: trend is rising
  const emergingTraits = traitScores
    .filter((ts) => ts.trend === 'rising')
    .map((ts) => ts.traitId);

  // Absent traits: lowest scoring traits
  const absentTraits = [...traitScores]
    .sort((a, b) => a.score - b.score)
    .map((ts) => ts.traitId)
    .slice(0, 5);

  const traitProfile: TraitProfile = {
    scores: traitScores,
    dominantTraits,
    emergingTraits,
    absentTraits,
  };

  // ── Step 5: Discovery Profile Layer ───────────────────────────────
  const previousDiscovery = previousProfile?.discoveryProfile ?? null;
  const discoveryProfile = computeDiscoveryProfile(
    exploredNodes,
    frontierCount,
    previousDiscovery,
  );

  // ── Step 6: Confidence Profile Layer ──────────────────────────────
  const sampleSize = exploredNodes.length;
  const dataCompleteness = Math.min(sampleSize / 30, 1.0);

  // Compute average trait signal strength
  let signalStrengthSum = 0;
  for (const score of traitScores) {
    signalStrengthSum += Math.min(Math.abs(score.score - 0.5) * 2, 1.0);
  }
  const averageSignalStrength = traitScores.length > 0 ? signalStrengthSum / traitScores.length : 0;

  const overallConfidence = (dataCompleteness + averageSignalStrength) / 2;

  const stableTraits = traitScores.filter((ts) => ts.confidence >= 0.7).map((ts) => ts.traitId);
  const confidenceEmergingTraits = traitScores.filter((ts) => ts.confidence >= 0.4 && ts.confidence < 0.7).map((ts) => ts.traitId);
  const speculativeTraits = traitScores.filter((ts) => ts.confidence < 0.4).map((ts) => ts.traitId);

  const confidenceProfile: ConfidenceProfile = {
    overall: overallConfidence,
    dataCompleteness,
    sampleSize,
    signalStrength: averageSignalStrength,
    stableTraits,
    emergingTraits: confidenceEmergingTraits,
    speculativeTraits,
  };

  // ── Step 7: Trajectory Profile Layer ──────────────────────────────
  const previousSonic = previousProfile?.sonicProfile ?? null;
  const previousDiscoveryProfile = previousProfile?.discoveryProfile ?? null;
  const trajectoryProfile = computeTrajectoryProfile(
    sonicProfile,
    traitScores,
    discoveryProfile,
    previousSonic,
    previousTraitScores,
    previousDiscoveryProfile,
  );

  // ── Step 8: Explanations Layer ────────────────────────────────────
  const explanations = generateExplanations(
    sonicProfile,
    traitProfile,
    discoveryProfile,
    trajectoryProfile,
    confidenceProfile,
  );

  return {
    userId,
    version: PROFILE_VERSION,
    createdAt: previousProfile?.createdAt ?? now,
    updatedAt: now,
    surfaceProfile,
    sonicProfile,
    traitProfile,
    discoveryProfile,
    trajectoryProfile,
    confidenceProfile,
    explanations,
  };
}
