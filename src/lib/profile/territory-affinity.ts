/**
 * ORCA Latent Compatibility Engine (Backend Layer 4 Redesign)
 *
 * Computes latent compatibility between users and territories in continuous latent space.
 * Separates compatibility into two independent, orthogonal channels:
 *   - Sensory Compatibility (acoustic features)
 *   - Cultural Compatibility (metadata, genres, listening graph)
 * Orthogonalizes the cultural channel using Gram-Schmidt projection to remove acoustic leakage.
 */

import { prisma } from '@/lib/prisma';
import type { UserProfile } from '@/lib/profile/types';
import {
  DEFAULT_COMPATIBILITY_CONFIG,
  type CompatibilityConfig,
  type UserTerritoryAffinityResult,
  type StructuredExplanation,
} from './affinity-types';
import { computeUserTerritoryRelationships } from './territory-relationship';
import { cosineSimilarity, normalizeTempo, clamp01 as clamp } from '@/lib/math';

// ─── Mathematical Helpers ────────────────────────────────────────────

/**
 * Performs Gram-Schmidt orthogonalization: projects rawVector onto the subspace
 * orthogonal to sensoryVector.
 * 
 * V_orthogonal = V_raw - ( (V_raw . V_sensory) / ||V_sensory||^2 ) * V_sensory
 */
function orthogonalize(rawVector: number[], sensoryVector: number[]): number[] {
  const len = Math.min(rawVector.length, sensoryVector.length);
  const result = [...rawVector];

  let dotProduct = 0.0;
  let sensoryNormSq = 0.0;

  for (let i = 0; i < len; i++) {
    dotProduct += rawVector[i] * sensoryVector[i];
    sensoryNormSq += sensoryVector[i] * sensoryVector[i];
  }

  if (sensoryNormSq === 0.0) {
    return result;
  }

  const projectionFactor = dotProduct / sensoryNormSq;

  for (let i = 0; i < len; i++) {
    result[i] = rawVector[i] - projectionFactor * sensoryVector[i];
  }

  return result;
}



// ─── Latent Compatibility Calculations ───────────────────────────────

export interface ComputeCompatibilityOptions {
  config?: Partial<CompatibilityConfig>;
}

/**
 * Computes User-Territory Latent Compatibility and persists results to the database.
 * 
 * @param userId - Spotify ID of the target user
 * @param options - Optional config overrides
 * @returns Array of compatibility results
 */
export async function computeUserTerritoryAffinity(
  userId: string,
  options: ComputeCompatibilityOptions = {}
): Promise<UserTerritoryAffinityResult[]> {
  const config: CompatibilityConfig = {
    ...DEFAULT_COMPATIBILITY_CONFIG,
    ...options.config,
    weights: {
      ...DEFAULT_COMPATIBILITY_CONFIG.weights,
      ...options.config?.weights,
    },
  };

  const results: UserTerritoryAffinityResult[] = [];

  // 1. Fetch User Profile Data
  const user = await prisma.user.findUnique({
    where: { spotifyId: userId },
    select: {
      profileData: true,
      globeData: true,
    },
  });

  if (!user || !user.profileData) {
    console.warn(`[Compatibility Engine] No profileData found for user ${userId}. Skipping.`);
    return [];
  }

  let userProfile: UserProfile;
  try {
    userProfile = JSON.parse(user.profileData);
  } catch (err) {
    const error = err as Error;
    console.error(`[Compatibility Engine] Failed to parse profileData for user ${userId}:`, error.message);
    return [];
  }

  // 2. Fetch User Territory Profile (Occupancies)
  const userTerritoryProfile = await prisma.userTerritoryProfile.findUnique({
    where: { userId },
  });

  let mediumTermOccupancies: Record<string, number> = {};
  if (userTerritoryProfile) {
    try {
      const parsed = JSON.parse(userTerritoryProfile.occupancyVector);
      mediumTermOccupancies = parsed.mediumTerm || {};
    } catch {}
  }

  const exploredArtists = await prisma.exploredArtist.findMany({ where: { userId } });
  const exploredArtistIds = new Set<string>(exploredArtists.map((ea: any) => ea.artistId));

  // 3. Retrieve Active version Territories with Memberships & Embeddings
  const maxVersionRecord = await prisma.territory.findFirst({
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const activeVersion = maxVersionRecord?.version || 1;

  const territories = await prisma.territory.findMany({
    where: { version: activeVersion },
    include: {
      memberships: {
        include: {
          artist: {
            include: {
              embeddings: {
                where: { embeddingVersion: config.version },
              },
            },
          },
        },
      },
    },
  });

  if (territories.length === 0) {
    console.warn(`[Compatibility Engine] No active version ${activeVersion} territories found.`);
    return [];
  }

  // Load similarity graph and bridges
  const similarities = await prisma.territorySimilarity.findMany({});
  const simMap = new Map<string, number>();
  similarities.forEach((s: any) => {
    simMap.set(`${s.territoryAId}_${s.territoryBId}`, s.similarity);
    simMap.set(`${s.territoryBId}_${s.territoryAId}`, s.similarity);
  });

  const bridges = await prisma.territoryBridge.findMany({});

  // 4. Construct User Profiles in Joint 33D space
  // We construct:
  // - User Sensory Vector: 33D vector where dimensions 0-5 are set to the user's audio centroid, others 0.
  // - User Raw Cultural Vector: the user's full 33D centroid (average of full fusedVector across their explored artists).
  const uCentroid = userProfile.sonicProfile.centroid;
  const userSensoryVector = new Array<number>(33).fill(0.0);
  userSensoryVector[0] = uCentroid.energy;
  userSensoryVector[1] = uCentroid.danceability;
  userSensoryVector[2] = uCentroid.valence;
  userSensoryVector[3] = uCentroid.acousticness;
  userSensoryVector[4] = uCentroid.instrumentalness;
  userSensoryVector[5] = normalizeTempo(uCentroid.tempo);

  // Load all user explored artists' fusedVectors to construct the joint user raw cultural profile
  const userFusedSum = new Array<number>(33).fill(0.0);
  let userFusedCount = 0;
  let userConfidenceSum = 0.0;

  const userArtistIds = Array.from(exploredArtistIds);
  const userEmbeddings = await prisma.artistEmbedding.findMany({
    where: {
      artistId: { in: userArtistIds },
      embeddingVersion: config.version,
    },
  });

  userEmbeddings.forEach((emb: any) => {
    if (emb.fusedVector) {
      try {
        const vec: number[] = JSON.parse(emb.fusedVector);
        for (let i = 0; i < 33; i++) {
          userFusedSum[i] += vec[i] || 0.0;
        }
        userConfidenceSum += emb.confidence;
        userFusedCount++;
      } catch {}
    }
  });

  const userRawCulturalVector = userFusedCount > 0
    ? userFusedSum.map(v => v / userFusedCount)
    : new Array<number>(33).fill(0.0);

  const userConfidence = userFusedCount > 0 ? userConfidenceSum / userFusedCount : 0.5;

  // Perform Gram-Schmidt Orthogonalization on User Profiles:
  const userOrthogonalCulturalVector = orthogonalize(userRawCulturalVector, userSensoryVector);

  // 5. Pre-calculate Territory Profiles & Orthogonalize
  const territoryProfiles = new Map<
    string,
    { sensoryVector: number[]; orthogonalCulturalVector: number[]; confidence: number }
  >();

  territories.forEach((t: any) => {
    const fusedSum = new Array<number>(33).fill(0.0);
    const audioSum = new Array<number>(6).fill(0.0);
    let weightSum = 0.0;
    let confidenceSum = 0.0;

    t.memberships.forEach((m: any) => {
      const emb = m.artist.embeddings[0];
      if (emb?.fusedVector && emb?.audioVector) {
        try {
          const fVec: number[] = JSON.parse(emb.fusedVector);
          const aVec: number[] = JSON.parse(emb.audioVector);
          const w = m.membershipStrength;

          for (let i = 0; i < 33; i++) {
            fusedSum[i] += (fVec[i] || 0.0) * w;
          }
          for (let i = 0; i < 6; i++) {
            audioSum[i] += (aVec[i] || 0.0) * w;
          }
          
          weightSum += w;
          confidenceSum += emb.confidence * w;
        } catch {}
      }
    });

    if (weightSum > 0.0) {
      const sensoryVector = new Array<number>(33).fill(0.0);
      for (let i = 0; i < 6; i++) {
        sensoryVector[i] = audioSum[i] / weightSum;
      }
      const rawCulturalVector = fusedSum.map(v => v / weightSum);
      const orthogonalCulturalVector = orthogonalize(rawCulturalVector, sensoryVector);
      const confidence = confidenceSum / weightSum;

      territoryProfiles.set(t.id, { sensoryVector, orthogonalCulturalVector, confidence });
    } else {
      // Fallback
      territoryProfiles.set(t.id, {
        sensoryVector: new Array<number>(33).fill(0.0),
        orthogonalCulturalVector: new Array<number>(33).fill(0.0),
        confidence: 0.5,
      });
    }
  });

  // 6. Compute Compatibility for each Territory
  for (const T of territories) {
    const profile = territoryProfiles.get(T.id)!;

    // Component 1: Sensory Compatibility (Cosine similarity in audio dimensions)
    // Extract 6D parts for pure sensory cosine comparison
    const uSensory6D = userSensoryVector.slice(0, 6);
    const tSensory6D = profile.sensoryVector.slice(0, 6);
    const sensoryCompatibility = clamp(cosineSimilarity(uSensory6D, tSensory6D));

    // Component 2: Cultural Compatibility (Cosine similarity of orthogonalized 33D vectors)
    const culturalCompatibility = clamp(cosineSimilarity(userOrthogonalCulturalVector, profile.orthogonalCulturalVector));

    // Component 3: Structural Distance (Proximity in graph representation)
    let occupiedSimSum = 0.0;
    let totalOccupancy = 0.0;
    for (const [occTId, occupancy] of Object.entries(mediumTermOccupancies)) {
      if (occupancy <= 0.0) continue;
      const sim = occTId === T.id ? 1.0 : (simMap.get(`${T.id}_${occTId}`) ?? 0.0);
      occupiedSimSum += occupancy * sim;
      totalOccupancy += occupancy;
    }
    const proximityScore = totalOccupancy > 0.0 ? occupiedSimSum / totalOccupancy : 0.0;
    const structuralDistance = clamp(1.0 - proximityScore);

    // Component 4: Accessibility
    let maxSim = 0.0;
    for (const [occTId, occupancy] of Object.entries(mediumTermOccupancies)) {
      if (occupancy >= 0.05) {
        const sim = occTId === T.id ? 1.0 : (simMap.get(`${T.id}_${occTId}`) ?? 0.0);
        if (sim > maxSim) maxSim = sim;
      }
    }

    let maxBridgeStrength = 0.0;
    const tBridges = bridges.filter((b: any) => b.territoryAId === T.id || b.territoryBId === T.id);
    tBridges.forEach((b: any) => {
      const otherTId = b.territoryAId === T.id ? b.territoryBId : b.territoryAId;
      const otherOccupancy = mediumTermOccupancies[otherTId] ?? 0.0;
      if (otherOccupancy >= 0.05 && b.bridgeStrength > maxBridgeStrength) {
        maxBridgeStrength = b.bridgeStrength;
      }
    });

    const boundaryOpenness = userProfile.discoveryProfile.boundaryOpenness ?? 0.5;
    const accessibility = clamp(
      0.5 * maxSim +
      0.3 * maxBridgeStrength +
      0.2 * boundaryOpenness
    );

    // Confidence and Occupancy
    const confidence = clamp(0.5 * userConfidence + 0.5 * profile.confidence);
    const occupancy = mediumTermOccupancies[T.id] ?? 0.0;

    // Fused Compatibility Score
    const w = config.weights;
    const compatibilityScore = clamp(
      w.cultural * culturalCompatibility +
      w.sensory * sensoryCompatibility
    );

    // Hidden Potential Score (high compatibility, low occupancy, reasonable accessibility)
    const hiddenPotential = clamp(compatibilityScore * (1.0 - occupancy) * accessibility);

    // Structured Explanation (Reasoning)
    const primaryDrivers: string[] = [];
    const reasons: string[] = [];

    if (sensoryCompatibility >= config.explanationThreshold) {
      primaryDrivers.push('Sensory Channel');
      reasons.push('Sensory match: Pure acoustic characteristics align strongly with your listening preferences.');
    }
    if (culturalCompatibility >= config.explanationThreshold) {
      primaryDrivers.push('Cultural Channel');
      reasons.push('Cultural match: Metadata patterns, listening graph associations, and genre relationships show latent compatibility.');
    }

    if (proximityScore >= 0.6) {
      reasons.push('Structurally contiguous to your primary listening footprint.');
    } else if (maxBridgeStrength >= 0.4) {
      reasons.push('Connected to your familiar footprint via strong gateway bridge artists.');
    }

    if (reasons.length === 0) {
      if (compatibilityScore >= 0.6) {
        reasons.push('Continuous manifold projection shows moderate overall compatibility.');
      } else {
        reasons.push('Weak latent space proximity.');
      }
    }

    const explanation: StructuredExplanation = {
      primaryDrivers,
      reasons,
    };

    results.push({
      userId,
      territoryId: T.id,
      compatibilityScore,
      culturalCompatibility,
      sensoryCompatibility,
      structuralDistance,
      accessibility,
      confidence,
      occupancy,
      hiddenPotential,
      explanation: JSON.stringify(explanation),
      computedAt: new Date(),
      modelVersion: config.version,
    });
  }

  // 7. Database Transactions & Persistence
  await prisma.$transaction(async (tx: any) => {
    for (const res of results) {
      // Upsert current UserTerritoryAffinity
      await tx.userTerritoryAffinity.upsert({
        where: {
          userId_territoryId: {
            userId: res.userId,
            territoryId: res.territoryId,
          },
        },
        create: {
          userId: res.userId,
          territoryId: res.territoryId,
          compatibilityScore: res.compatibilityScore,
          culturalCompatibility: res.culturalCompatibility,
          sensoryCompatibility: res.sensoryCompatibility,
          structuralDistance: res.structuralDistance,
          accessibility: res.accessibility,
          confidence: res.confidence,
          occupancy: res.occupancy,
          hiddenPotential: res.hiddenPotential,
          explanation: res.explanation,
          modelVersion: res.modelVersion,
        },
        update: {
          compatibilityScore: res.compatibilityScore,
          culturalCompatibility: res.culturalCompatibility,
          sensoryCompatibility: res.sensoryCompatibility,
          structuralDistance: res.structuralDistance,
          accessibility: res.accessibility,
          confidence: res.confidence,
          occupancy: res.occupancy,
          hiddenPotential: res.hiddenPotential,
          explanation: res.explanation,
          computedAt: new Date(),
          modelVersion: res.modelVersion,
        },
      });

      // Write snapshot if compatibilityScore is meaningful (>= 0.15)
      if (res.compatibilityScore >= 0.15) {
        const componentScores = {
          culturalCompatibility: res.culturalCompatibility,
          sensoryCompatibility: res.sensoryCompatibility,
          structuralDistance: res.structuralDistance,
          accessibility: res.accessibility,
          occupancy: res.occupancy,
        };

        await tx.userTerritoryAffinitySnapshot.create({
          data: {
            userId: res.userId,
            territoryId: res.territoryId,
            compatibilityScore: res.compatibilityScore,
            componentScores: JSON.stringify(componentScores),
            confidence: res.confidence,
          },
        });
      }
    }
  });

  console.log(`[Compatibility Engine] Computed and saved ${results.length} compatibilities for user ${userId}.`);

  // Trigger Layer 6 relationship state computations
  try {
    await computeUserTerritoryRelationships(userId);
  } catch (err) {
    const error = err as Error;
    console.error(`[Compatibility Engine] Failed to run Layer 6 Territory Relationships:`, error.message);
  }

  return results;
}

/**
 * Computes the affinity score for a given artist and user.
 * Supports synchronous in-memory lookup via UserContext.
 */
export async function calculateAffinity(artistId: string, userId: string, context?: any): Promise<number> {
  let normalizedGenre = 'pop';

  if (context && context.artistGenresMap && context.artistGenresMap.has(artistId)) {
    normalizedGenre = context.artistGenresMap.get(artistId);
  } else {
    // Query artist details
    const artist = await prisma.artist.findUnique({
      where: { id: artistId },
      select: { rawGenres: true }
    });
    if (artist?.rawGenres) {
      try {
        const { normaliseGenre } = await import('@/lib/graph/genre-normaliser');
        const parsed = JSON.parse(artist.rawGenres);
        normalizedGenre = normaliseGenre(parsed);
      } catch {}
    }
  }

  const GENRE_TO_TERRITORY: Record<string, string> = {
    'hip-hop': 'Territory_v2_001',
    'rock': 'Territory_v2_002',
    'electronic': 'Territory_v2_003',
    'pop': 'Territory_v2_004',
    'jazz': 'Territory_v2_005'
  };
  const tId = GENRE_TO_TERRITORY[normalizedGenre] || normalizedGenre;

  if (context && context.affinityMap) {
    const rawVal = context.affinityMap.get(tId) ?? context.affinityMap.get(normalizedGenre) ?? 50;
    return rawVal <= 1.0 ? Math.round(rawVal * 100) : rawVal;
  }

  const aff = await prisma.userTerritoryAffinity.findFirst({
    where: { userId, territoryId: tId },
    select: { compatibilityScore: true }
  });

  return aff ? Math.round(aff.compatibilityScore * 100) : 50;
}

