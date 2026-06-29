/**
 * ORCA Taste Territories Pipeline
 * 
 * Orchestrates the generation, versioning, and persistence of Taste Territories.
 */

import { prisma } from '@/lib/prisma';
import { l2Normalize } from '@/lib/latent/latent-space';
import { getActiveTraits } from '@/lib/profile/trait-registry';
import {
  cosineSimilarity,
  buildKnnGraph,
  runLouvainClustering,
  LatentNode,
} from './territory-clustering';

export interface PipelineParams {
  minConfidence?: number;
  k?: number;
  minSimilarity?: number;
  fuzzyThreshold?: number;
  coreThreshold?: number;
}

export interface PipelineResult {
  version: number;
  territoryCount: number;
  artistCount: number;
  bridgeCount: number;
  logs: string[];
}

/**
 * Executes the Backend Layer 2 Taste Territories Generation Pipeline.
 */
export async function generateTasteTerritories(params: PipelineParams = {}): Promise<PipelineResult> {
  const minConfidence = params.minConfidence ?? 0.5;
  const k = params.k ?? 10;
  const minSimilarity = params.minSimilarity ?? 0.3;
  const fuzzyThreshold = params.fuzzyThreshold ?? 0.3;
  const coreThreshold = params.coreThreshold ?? 0.65;

  const logs: string[] = [];
  logs.push(`[Territory Pipeline] Starting run. Params: minConfidence=${minConfidence}, k=${k}, minSimilarity=${minSimilarity}, fuzzyThreshold=${fuzzyThreshold}, coreThreshold=${coreThreshold}`);

  // ── Step 1: Load and Validate Artist Embeddings ───────────────────
  const embeddings = await prisma.artistEmbedding.findMany({
    where: {
      confidence: { gte: minConfidence },
      fusedVector: { not: null },
    },
    include: {
      artist: true,
    },
  });

  logs.push(`[Territory Pipeline] Loaded ${embeddings.length} valid artist embeddings.`);

  if (embeddings.length === 0) {
    logs.push('[Territory Pipeline] Aborting run: No valid embeddings found.');
    return { version: 0, territoryCount: 0, artistCount: 0, bridgeCount: 0, logs };
  }

  // Map to LatentNode format and normalize vectors
  const latentNodes: LatentNode[] = [];
  const artistMap = new Map<string, typeof embeddings[0]>();

  embeddings.forEach((emb) => {
    try {
      const vec: number[] = JSON.parse(emb.fusedVector!);
      if (vec.length > 0) {
        latentNodes.push({
          id: emb.artistId,
          vector: l2Normalize(vec),
        });
        artistMap.set(emb.artistId, emb);
      }
    } catch (e) {
      const err = e as Error;
      logs.push(`[Territory Pipeline] Error parsing fusedVector for ${emb.artistId}: ${err.message}`);
    }
  });

  logs.push(`[Territory Pipeline] Processed ${latentNodes.length} normalized vectors for clustering.`);

  // ── Step 2: Build Similarity Graph and Cluster ───────────────────
  logs.push('[Territory Pipeline] Constructing k-NN similarity graph...');
  const edges = buildKnnGraph(latentNodes, k, minSimilarity);
  logs.push(`[Territory Pipeline] Graph built. Edge count: ${edges.length}`);

  logs.push('[Territory Pipeline] Running Louvain community detection...');
  const rawClustersMap = runLouvainClustering(latentNodes, edges);
  logs.push(`[Territory Pipeline] Clustering complete. Found ${rawClustersMap.size} raw clusters.`);

  // Disband noise clusters (size < 3)
  const validClusters: string[][] = [];
  let noiseArtistCount = 0;

  for (const [, artistIds] of rawClustersMap.entries()) {
    if (artistIds.length >= 3) {
      validClusters.push(artistIds);
    } else {
      noiseArtistCount += artistIds.length;
    }
  }

  logs.push(`[Territory Pipeline] Filtered noise clusters. Active clusters: ${validClusters.length}. Unclustered/noise artists: ${noiseArtistCount}`);

  if (validClusters.length === 0) {
    logs.push('[Territory Pipeline] Aborting: No clusters met the size limit (>= 3).');
    return { version: 0, territoryCount: 0, artistCount: 0, bridgeCount: 0, logs };
  }

  // ── Step 3: Determine Version ─────────────────────────────────────
  const maxVersionRecord = await prisma.territory.findFirst({
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const prevVersion = maxVersionRecord?.version || 0;
  const newVersion = prevVersion + 1;
  logs.push(`[Territory Pipeline] Target version: ${newVersion} (Previous version: ${prevVersion})`);

  // ── Step 4: Compute Centroids, Traits, and Name Territories ───────
  const activeTraits = getActiveTraits();
  const indexToNode = new Map<string, LatentNode>();
  latentNodes.forEach((n) => indexToNode.set(n.id, n));

  interface ProcessedTerritory {
    tempIndex: number;
    artistIds: string[];
    centroid: number[];
    size: number;
    spread: number;
    cohesion: number;
    density: number;
    traitSignature: number[];
    genresFreq: Record<string, number>;
    displayName: string;
  }

  const processedTerritories: ProcessedTerritory[] = [];

  validClusters.forEach((artistIds, idx) => {
    const size = artistIds.length;
    const dimension = latentNodes[0].vector.length;

    // 1. Calculate centroid
    const sumVector = new Array<number>(dimension).fill(0);
    artistIds.forEach((id) => {
      const node = indexToNode.get(id)!;
      for (let d = 0; d < dimension; d++) {
        sumVector[d] += node.vector[d];
      }
    });
    const centroid = l2Normalize(sumVector.map((v) => v / size));

    // 2. Spread, Cohesion, Density
    let simSum = 0;
    artistIds.forEach((id) => {
      const node = indexToNode.get(id)!;
      simSum += cosineSimilarity(node.vector, centroid);
    });
    const cohesion = simSum / size;
    const spread = 1 - cohesion;
    const density = size / (spread + 1e-5);

    // 3. Trait Signature
    const traitDim = activeTraits.length;
    const traitSum = new Array<number>(traitDim).fill(0);
    let traitCount = 0;

    artistIds.forEach((id) => {
      const emb = artistMap.get(id);
      if (emb?.traitVector) {
        try {
          const traits: number[] = JSON.parse(emb.traitVector);
          for (let t = 0; t < traitDim; t++) {
            traitSum[t] += traits[t] || 0;
          }
          traitCount++;
        } catch {}
      }
    });

    const traitSignature = traitCount > 0 
      ? l2Normalize(traitSum.map((v) => v / traitCount)) 
      : new Array<number>(traitDim).fill(0);

    // 4. Genre Frequency
    const genresFreq: Record<string, number> = {};
    artistIds.forEach((id) => {
      const emb = artistMap.get(id);
      if (emb?.artist.rawGenres) {
        try {
          const genres: string[] = JSON.parse(emb.artist.rawGenres);
          genres.forEach((genre) => {
            const lower = genre.toLowerCase();
            genresFreq[lower] = (genresFreq[lower] || 0) + 1;
          });
        } catch {}
      }
    });

    // 5. Emergent Naming System
    // Top 2 traits
    const sortedTraits = traitSignature
      .map((score, tIdx) => ({ id: activeTraits[tIdx].id, label: activeTraits[tIdx].displayLabel, score }))
      .sort((a, b) => b.score - a.score);

    // Top 2 genres
    const sortedGenres = Object.entries(genresFreq)
      .sort((a, b) => b[1] - a[1])
      .map(([genre]) => genre);

    const capitalize = (s: string) => s.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

    let displayName = `Territory ${newVersion}_${idx + 1}`;
    if (sortedTraits.length >= 2 && sortedGenres.length >= 2) {
      const t1 = sortedTraits[0].label;
      const t2 = sortedTraits[1].label;
      const g1 = capitalize(sortedGenres[0]);
      const g2 = capitalize(sortedGenres[1]);
      displayName = `${t1} & ${t2} (${g1} / ${g2})`;
    } else if (sortedTraits.length >= 1 && sortedGenres.length >= 1) {
      displayName = `${sortedTraits[0].label} (${capitalize(sortedGenres[0])})`;
    }

    processedTerritories.push({
      tempIndex: idx + 1,
      artistIds,
      centroid,
      size,
      spread,
      cohesion,
      density,
      traitSignature,
      genresFreq,
      displayName,
    });
  });

  // ── Step 5: Fuzzy Memberships & Roles ─────────────────────────────
  // Assign every artist to territories where similarity >= fuzzyThreshold
  interface MembershipData {
    artistId: string;
    membershipStrength: number;
    confidence: number;
    role: 'CORE' | 'BORDER';
  }

  const territoryMemberships = new Map<number, MembershipData[]>();
  processedTerritories.forEach((pt) => territoryMemberships.set(pt.tempIndex, []));

  latentNodes.forEach((node) => {
    const artistEmb = artistMap.get(node.id)!;
    
    // Find similarity to all centroids
    const matches = processedTerritories.map((pt) => {
      const sim = cosineSimilarity(node.vector, pt.centroid);
      return { pt, sim };
    });

    // Find primary membership (max similarity)
    matches.sort((a, b) => b.sim - a.sim);
    const primary = matches[0];

    // Assign memberships above fuzzyThreshold
    matches.forEach(({ pt, sim }) => {
      if (sim >= fuzzyThreshold || pt.tempIndex === primary.pt.tempIndex) {
        // Role: CORE if similarity is high (>= coreThreshold), otherwise BORDER
        const role = sim >= coreThreshold ? 'CORE' : 'BORDER';

        territoryMemberships.get(pt.tempIndex)!.push({
          artistId: node.id,
          membershipStrength: sim,
          confidence: artistEmb.confidence,
          role,
        });
      }
    });
  });

  // ── Step 6: Detect Bridges ────────────────────────────────────────
  // Artists with membership strength >= 0.35 in multiple territories
  interface BridgeData {
    artistId: string;
    territoryATempIdx: number;
    territoryBTempIdx: number;
    bridgeStrength: number;
  }

  const bridges: BridgeData[] = [];
  const artistMemberships = new Map<string, { tempIdx: number; strength: number }[]>();

  for (const [tempIdx, mems] of territoryMemberships.entries()) {
    mems.forEach((m) => {
      if (!artistMemberships.has(m.artistId)) {
        artistMemberships.set(m.artistId, []);
      }
      artistMemberships.get(m.artistId)!.push({ tempIdx, strength: m.membershipStrength });
    });
  }

  for (const [artistId, mems] of artistMemberships.entries()) {
    // Filter strengths >= 0.35
    const candidateMems = mems.filter((m) => m.strength >= 0.35);
    if (candidateMems.length >= 2) {
      for (let i = 0; i < candidateMems.length; i++) {
        for (let j = i + 1; j < candidateMems.length; j++) {
          const tA = candidateMems[i];
          const tB = candidateMems[j];
          bridges.push({
            artistId,
            territoryATempIdx: tA.tempIdx,
            territoryBTempIdx: tB.tempIdx,
            bridgeStrength: Math.min(tA.strength, tB.strength),
          });
        }
      }
    }
  }

  logs.push(`[Territory Pipeline] Detected ${bridges.length} bridge artists.`);

  // ── Step 7: Evolution Tracking & Stability ────────────────────────
  // Load previous version territories
  const prevTerritories = prevVersion > 0 
    ? await prisma.territory.findMany({
        where: { version: prevVersion },
        include: { memberships: true },
      })
    : [];

  const prevTerritoriesMap = new Map<string, typeof prevTerritories[0]>();
  prevTerritories.forEach((t) => prevTerritoriesMap.set(t.id, t));

  interface EvolutionData {
    stability: number;
    drift: number;
    event: 'new' | 'stable' | 'split' | 'merge';
    matchedPrevId?: string;
  }

  const evolutionMap = new Map<number, EvolutionData>();

  // Map each new territory to its most similar previous territory
  const prevCentroids = prevTerritories.map((pt) => {
    try {
      const vec: number[] = JSON.parse(pt.centroidVector);
      return { id: pt.id, vector: vec, memberIds: pt.memberships.map((m) => m.artistId) };
    } catch {
      return null;
    }
  }).filter(Boolean) as { id: string; vector: number[]; memberIds: string[] }[];

  const prevMatchCount = new Map<string, number>();

  processedTerritories.forEach((pt) => {
    let bestPrev = null;
    let maxSim = -1;

    prevCentroids.forEach((pc) => {
      const sim = cosineSimilarity(pt.centroid, pc.vector);
      if (sim > maxSim) {
        maxSim = sim;
        bestPrev = pc;
      }
    });

    if (bestPrev && maxSim >= 0.7) {
      const bp = bestPrev as typeof prevCentroids[0];
      
      // Calculate Jaccard overlap of members
      const newMSet = new Set(pt.artistIds);
      const intersect = bp.memberIds.filter((id) => newMSet.has(id)).length;
      const union = new Set([...pt.artistIds, ...bp.memberIds]).size;
      const jaccard = union > 0 ? intersect / union : 0;

      const stability = 0.5 * maxSim + 0.5 * jaccard;
      const drift = 1 - maxSim;

      // Track mapping counts to detect splits
      prevMatchCount.set(bp.id, (prevMatchCount.get(bp.id) || 0) + 1);

      // Check if it is highly similar to a second previous territory (Merge detection)
      const secondaryMatches = prevCentroids.filter((pc) => pc.id !== bp.id && cosineSimilarity(pt.centroid, pc.vector) >= 0.65);
      const event = secondaryMatches.length > 0 ? 'merge' : 'stable';

      evolutionMap.set(pt.tempIndex, {
        stability,
        drift,
        event,
        matchedPrevId: bp.id,
      });
    } else {
      evolutionMap.set(pt.tempIndex, {
        stability: 1.0,
        drift: 0.0,
        event: 'new',
      });
    }
  });

  // Adjust splits: if a previous territory was matched by multiple new ones, mark them all as splits
  for (const [, evo] of evolutionMap.entries()) {
    if (evo.matchedPrevId) {
      const matchCount = prevMatchCount.get(evo.matchedPrevId) || 0;
      if (matchCount > 1) {
        evo.event = 'split';
      }
    }
  }

  // ── Step 8: Compute Similarity Matrix ─────────────────────────────
  interface SimilarityData {
    tempAIdx: number;
    tempBIdx: number;
    similarity: number;
    distance: number;
  }

  const similarities: SimilarityData[] = [];
  const M = processedTerritories.length;

  for (let i = 0; i < M; i++) {
    for (let j = i + 1; j < M; j++) {
      const sim = cosineSimilarity(processedTerritories[i].centroid, processedTerritories[j].centroid);
      similarities.push({
        tempAIdx: processedTerritories[i].tempIndex,
        tempBIdx: processedTerritories[j].tempIndex,
        similarity: sim,
        distance: 1 - sim,
      });
    }
  }

  // ── Step 9: Database Transaction & Persistence ────────────────────
  logs.push('[Territory Pipeline] Saving results to database inside transaction...');

  // Map temporary territory indexes to final database IDs: Territory_v[version]_[001..XXX]
  const getDbId = (tempIdx: number) => {
    const pad = (num: number) => String(num).padStart(3, '0');
    return `Territory_v${newVersion}_${pad(tempIdx)}`;
  };

  // Pre-build flat row arrays so all inserts can be batched into 5 createMany calls
  // instead of ~1575 sequential awaited round-trips.
  const territoryRows = processedTerritories.map(pt => {
    const dbId = getDbId(pt.tempIndex);
    const evo = evolutionMap.get(pt.tempIndex)!;
    const metadataPayload = {
      topGenres: Object.entries(pt.genresFreq).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([g]) => g),
      topTraits: pt.traitSignature
        .map((score, idx) => ({ traitId: activeTraits[idx].id, score }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5),
      evolutionEvent: evo.event,
      matchedPreviousId: evo.matchedPrevId || null,
      displayName: pt.displayName,
    };
    return {
      id: dbId,
      version: newVersion,
      centroidVector: JSON.stringify(pt.centroid),
      size: pt.size,
      density: pt.density,
      cohesion: pt.cohesion,
      stability: evo.stability,
      metadata: JSON.stringify(metadataPayload),
    };
  });

  const snapshotRows = processedTerritories.map(pt => {
    const dbId = getDbId(pt.tempIndex);
    const evo = evolutionMap.get(pt.tempIndex)!;
    const topGenres = Object.entries(pt.genresFreq).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([g]) => g);
    return {
      territoryId: dbId,
      version: newVersion,
      centroidVector: JSON.stringify(pt.centroid),
      size: pt.size,
      density: pt.density,
      cohesion: pt.cohesion,
      stability: evo.stability,
      metadata: JSON.stringify({
        topArtists: pt.artistIds.slice(0, 10),
        topGenres,
        evolutionEvent: evo.event,
      }),
    };
  });

  const membershipRows = processedTerritories.flatMap(pt => {
    const dbId = getDbId(pt.tempIndex);
    return (territoryMemberships.get(pt.tempIndex) ?? []).map(m => ({
      territoryId: dbId,
      artistId: m.artistId,
      membershipStrength: m.membershipStrength,
      confidence: m.confidence,
      role: m.role,
    }));
  });

  const bridgeRows = bridges.map(b => ({
    artistId: b.artistId,
    territoryAId: getDbId(b.territoryATempIdx),
    territoryBId: getDbId(b.territoryBTempIdx),
    bridgeStrength: b.bridgeStrength,
  }));

  const similarityRows = similarities.map(sim => ({
    territoryAId: getDbId(sim.tempAIdx),
    territoryBId: getDbId(sim.tempBIdx),
    similarity: sim.similarity,
    distance: sim.distance,
  }));

  // 5 batched bulk inserts replace ~1575 sequential awaited create() calls
  await prisma.$transaction(async (tx) => {
    await tx.territory.createMany({ data: territoryRows });
    await tx.territorySnapshot.createMany({ data: snapshotRows });
    await tx.territoryMembership.createMany({ data: membershipRows });
    await tx.territoryBridge.createMany({ data: bridgeRows });
    await tx.territorySimilarity.createMany({ data: similarityRows });
  });

  logs.push(`[Territory Pipeline] Successfully persisted version ${newVersion} with ${processedTerritories.length} territories and ${bridges.length} bridges.`);

  return {
    version: newVersion,
    territoryCount: processedTerritories.length,
    artistCount: latentNodes.length,
    bridgeCount: bridges.length,
    logs,
  };
}
