const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Helper for cosine similarity
function cosineSimilarity(a, b) {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0.0;
  let dot = 0.0, normA = 0.0, normB = 0.0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0.0 || normB === 0.0) return 0.0;
  return dot / Math.sqrt(normA * normB);
}

function clamp(value, min = 0.0, max = 1.0) {
  return Math.min(Math.max(value, min), max);
}

function orthogonalize(rawVector, sensoryVector) {
  const len = Math.min(rawVector.length, sensoryVector.length);
  const result = [...rawVector];
  let dotProduct = 0.0, sensoryNormSq = 0.0;
  for (let i = 0; i < len; i++) {
    dotProduct += rawVector[i] * sensoryVector[i];
    sensoryNormSq += sensoryVector[i] * sensoryVector[i];
  }
  if (sensoryNormSq === 0.0) return result;
  const projectionFactor = dotProduct / sensoryNormSq;
  for (let i = 0; i < len; i++) {
    result[i] = rawVector[i] - projectionFactor * sensoryVector[i];
  }
  return result;
}

async function main() {
  console.log('=== STARTING LAYER 8 ARTIST-NODE SEQUENCING AUDIT ===\n');

  // Load all 129 artists and their embeddings
  const dbArtists = await prisma.artist.findMany({
    include: {
      embeddings: {
        where: { embeddingVersion: 1 }
      }
    }
  });

  const bridges = await prisma.territoryBridge.findMany({});

  console.log(`Loaded ${dbArtists.length} artists and ${bridges.length} bridge relations.`);

  // Parse embeddings
  const artists = dbArtists.map(a => {
    const emb = a.embeddings[0];
    let fused = [];
    let audio = [];
    try {
      fused = JSON.parse(emb?.fusedVector || '[]');
      audio = JSON.parse(emb?.audioVector || '[]');
    } catch {}
    if (fused.length < 33) fused = new Array(33).fill(0.0);
    if (audio.length < 6) audio = new Array(6).fill(0.0);

    const sensory = new Array(33).fill(0.0);
    for (let i = 0; i < 6; i++) {
      sensory[i] = audio[i] || 0.0;
    }
    const orthogonalCultural = orthogonalize(fused, sensory);

    return {
      id: a.id,
      displayName: a.displayName,
      popularity: a.popularity,
      sensory: sensory.slice(0, 6),
      orthogonalCultural,
      fused
    };
  });

  // Map bridges to check if an artist is a bridging artist
  const bridgeMap = new Map();
  bridges.forEach(b => {
    const cur = bridgeMap.get(b.artistId) || 0.0;
    bridgeMap.set(b.artistId, Math.max(cur, b.bridgeStrength));
  });

  const getBridgeStrength = (id) => bridgeMap.get(id) ?? 0.0;

  // Build pairwise similarity map
  console.log('Computing artist pairwise similarities...');
  const similarityCache = new Map();
  for (let i = 0; i < artists.length; i++) {
    for (let j = i; j < artists.length; j++) {
      const a = artists[i];
      const b = artists[j];
      const sim = clamp(cosineSimilarity(a.fused, b.fused));
      similarityCache.set(`${a.id}_${b.id}`, sim);
      similarityCache.set(`${b.id}_${a.id}`, sim);
    }
  }

  const getEdgeDetails = (a, b) => {
    if (a === b) return { similarity: 1.0, distance: 0.0 };
    const sim = similarityCache.get(`${a}_${b}`) ?? 0.0;
    return { similarity: sim, distance: clamp(1.0 - sim) };
  };

  // Build graph of connections: limit each node to its top 10 neighbors
  // to avoid combinatorial path explosion.
  console.log('Building graph adjacency structures (top 10 neighbors per artist)...');
  const graph = new Map();
  artists.forEach(a => {
    const sortedNeighbors = artists
      .filter(other => other.id !== a.id)
      .map(other => ({
        neighborId: other.id,
        similarity: similarityCache.get(`${a.id}_${other.id}`) ?? 0.0
      }))
      .sort((n1, n2) => n2.similarity - n1.similarity)
      .slice(0, 10);

    graph.set(a.id, sortedNeighbors.map(n => ({
      neighborId: n.neighborId,
      similarity: n.similarity,
      distance: clamp(1.0 - n.similarity)
    })));
  });

  // Transition & Outcome Simulation Model
  function simulatePathOutcome(path, userProfile, affinities) {
    let pathSafety = 1.0;
    let adoptionProbability = 1.0;
    
    for (let i = 1; i < path.length; i++) {
      const u = path[i - 1];
      const v = path[i];
      const { similarity } = getEdgeDetails(u, v);
      const bStrength = getBridgeStrength(v);
      const targetAff = affinities[v] || { compatibility: 0.5, accessibility: 0.5 };

      // Transition probability
      const transitionEase = clamp(
        0.4 * targetAff.compatibility +
        0.3 * userProfile.overallReadiness +
        0.2 * similarity +
        0.1 * bStrength
      );

      // Rejection risk per step
      const stepRisk = clamp((1.0 - similarity) * (1.0 - targetAff.accessibility) * (1.0 - userProfile.overallReadiness));

      pathSafety *= (1.0 - stepRisk);
      adoptionProbability *= transitionEase;
    }

    return {
      expectedAdoption: clamp(adoptionProbability),
      expectedRejection: clamp(1.0 - pathSafety),
    };
  }

  // Routing Engine
  // Implements both the UNMODIFIED Layer 8 engine and our FIXED Layer 8 engine.
  function computePathway(sourceId, targetId, userProfile, affinities, type, fixLoophole = false) {
    const overallReadiness = userProfile.overallReadiness;
    const noveltyAppetite = userProfile.noveltyAppetite;

    let style = 'DIRECT';
    const { distance: bestDist } = getEdgeDetails(sourceId, targetId);
    if (type === 'BRIDGE') {
      style = 'BRIDGE';
    } else if (overallReadiness < 0.3) {
      style = 'SAFETY_FIRST';
    } else if (bestDist > 0.65 && overallReadiness < 0.6) {
      style = 'CURRICULUM';
    }

    const noveltyBudget = clamp(noveltyAppetite * 1.5 + overallReadiness * 0.5);

    const candidates = [];
    const maxPathLen = style === 'DIRECT' || style === 'SAFETY_FIRST' ? 2 : style === 'BRIDGE' ? 3 : 4;

    function dfs(current, path) {
      if (current === targetId) {
        candidates.push([...path]);
        return;
      }
      if (path.length >= maxPathLen) return;
      if (candidates.length >= 200) return; // Guard limit

      const neighbors = graph.get(current) || [];
      neighbors.forEach((n) => {
        if (!path.includes(n.neighborId)) {
          path.push(n.neighborId);
          dfs(n.neighborId, path);
          path.pop();
        }
      });
    }

    dfs(sourceId, [sourceId]);

    if (candidates.length === 0) {
      candidates.push([sourceId, targetId]);
    }

    let bestPath = [sourceId, targetId];
    let bestPathScore = -999.0;
    let bestEvaluation = null;

    candidates.forEach((path) => {
      let isMonotonic = true;
      let prevNovelty = affinities[path[0]] ? 1.0 - affinities[path[0]].familiarity : 0.5;

      for (let i = 1; i < path.length; i++) {
        const currentNovelty = affinities[path[i]] ? 1.0 - affinities[path[i]].familiarity : 1.0;
        if (currentNovelty < prevNovelty - 0.08) isMonotonic = false;
        prevNovelty = currentNovelty;
      }

      let isSmooth = true;
      let totalDistance = 0.0;
      let totalSimilarity = 0.0;
      let totalBridgeStrength = 0.0;

      for (let i = 1; i < path.length; i++) {
        const { similarity, distance } = getEdgeDetails(path[i - 1], path[i]);
        totalDistance += distance;
        totalSimilarity += similarity;
        totalBridgeStrength += getBridgeStrength(path[i]);

        // FIX: If fixLoophole is true, we apply the smoothness check to ALL path lengths (even length 2)
        if (fixLoophole) {
          if (similarity < 0.08) isSmooth = false;
        } else {
          if (similarity < 0.08 && path.length > 2) isSmooth = false;
        }
      }

      const budgetFit = totalDistance <= noveltyBudget ? 1.0 : Math.max(0.0, 1.0 - (totalDistance - noveltyBudget) * 2.5);
      const avgSimilarity = totalSimilarity / (path.length - 1);
      const avgBridge = totalBridgeStrength / (path.length - 1);

      let noveltyVariance = 0.0;
      if (path.length > 2) {
        const mean = totalDistance / (path.length - 1);
        let sqSum = 0.0;
        for (let i = 1; i < path.length; i++) {
          const { distance } = getEdgeDetails(path[i - 1], path[i]);
          sqSum += (distance - mean) * (distance - mean);
        }
        noveltyVariance = sqSum / (path.length - 1);
      }
      const noveltyGradient = clamp(1.0 - Math.sqrt(noveltyVariance));

      const pathCoherence = clamp(avgSimilarity * 0.5 + noveltyGradient * 0.3 + (isMonotonic ? 0.2 : 0.0));
      const targetAff = affinities[targetId] || { compatibility: 0.5, accessibility: 0.5 };
      const expectedAdoption = clamp(pathCoherence * targetAff.compatibility * overallReadiness + (avgBridge * 0.1));

      let totalRisk = 0.0;
      for (let i = 1; i < path.length; i++) {
        const { distance } = getEdgeDetails(path[i - 1], path[i]);
        const stepAcc = affinities[path[i]]?.accessibility ?? 0.5;
        const stepRisk = clamp(distance * (1.0 - stepAcc) * (1.0 - overallReadiness));
        totalRisk += stepRisk;
      }
      const expectedRejection = clamp(totalRisk / (path.length - 1));

      // FIX: If fixLoophole is true, we divide length penalty by path length to reward sequence steps
      const lengthPenalty = fixLoophole ? (path.length - 2) * 0.02 : (path.length - 2) * 0.06;
      const constraintPenalty = (!isMonotonic ? 0.2 : 0.0) + (!isSmooth ? 0.15 : 0.0);

      const totalScore = clamp(
        pathCoherence * 0.3 +
          expectedAdoption * 0.35 +
          (1.0 - expectedRejection) * 0.2 +
          budgetFit * 0.15 -
          lengthPenalty -
          constraintPenalty
      );

      if (totalScore > bestPathScore) {
        bestPathScore = totalScore;
        bestPath = path;
        bestEvaluation = {
          pathCoherence,
          expectedAdoption,
          expectedRejection,
          lengthPenalty,
          noveltyBudgetFit: budgetFit,
        };
      }
    });

    return {
      pathStyle: style,
      path: bestPath,
      totalScore: bestPathScore,
    };
  }

  // ─── RUNNING 20,000 SCENARIOS ──────────────────────────────────────
  const SCENARIO_COUNT = 20000;
  console.log(`Simulating ${SCENARIO_COUNT} artist-node scenarios...`);

  // Unmodified Layer 8 Metrics
  let unmodLengthSum = 0;
  let unmodBridgePathsCount = 0;
  let unmodAdoptionSum = 0, unmodRejectionSum = 0;

  // Fixed Layer 8 Metrics
  let fixedLengthSum = 0;
  let fixedBridgePathsCount = 0;
  let fixedAdoptionSum = 0, fixedRejectionSum = 0;

  // Baseline Direct Jump Metrics
  let directAdoptionSum = 0, directRejectionSum = 0;

  for (let idx = 0; idx < SCENARIO_COUNT; idx++) {
    if (idx > 0 && idx % 5000 === 0) {
      console.log(`Progress: ${idx} / ${SCENARIO_COUNT} scenarios completed.`);
    }

    // Generate User Profile
    const userProfile = {
      overallReadiness: 0.15 + Math.random() * 0.8, // avoid complete zeros
      noveltyAppetite: 0.15 + Math.random() * 0.8,
    };

    // Pick source & target artist
    const sourceIdx = Math.floor(Math.random() * artists.length);
    let targetIdx = Math.floor(Math.random() * artists.length);
    while (targetIdx === sourceIdx) {
      targetIdx = Math.floor(Math.random() * artists.length);
    }
    const sourceId = artists[sourceIdx].id;
    const targetId = artists[targetIdx].id;

    // Build scenario affinities
    const affinities = {};
    artists.forEach(a => {
      affinities[a.id] = {
        compatibility: clamp(cosineSimilarity(userProfile.overallReadiness > 0.5 ? artists[sourceIdx].orthogonalCultural : artists[sourceIdx].sensory, a.fused)),
        accessibility: 0.3 + 0.7 * Math.random(),
        familiarity: a.id === sourceId ? 0.7 + Math.random() * 0.3 : Math.random() * 0.15,
        occupancy: a.id === sourceId ? 0.8 : 0.0
      };
    });

    const interventionType = Math.random() > 0.5 ? 'BRIDGE' : 'INTRODUCE';

    // 1. Run Unmodified Layer 8
    const unmodResult = computePathway(sourceId, targetId, userProfile, affinities, interventionType, false);
    unmodLengthSum += unmodResult.path.length;
    // Check if intermediate bridge artist is used (path length > 2)
    const unmodHasBridge = unmodResult.path.length > 2;
    if (unmodHasBridge) unmodBridgePathsCount++;

    const unmodOutcomes = simulatePathOutcome(unmodResult.path, userProfile, affinities);
    unmodAdoptionSum += unmodOutcomes.expectedAdoption;
    unmodRejectionSum += unmodOutcomes.expectedRejection;

    // 2. Run Fixed Layer 8
    const fixedResult = computePathway(sourceId, targetId, userProfile, affinities, interventionType, true);
    fixedLengthSum += fixedResult.path.length;
    const fixedHasBridge = fixedResult.path.length > 2;
    if (fixedHasBridge) fixedBridgePathsCount++;

    const fixedOutcomes = simulatePathOutcome(fixedResult.path, userProfile, affinities);
    fixedAdoptionSum += fixedOutcomes.expectedAdoption;
    fixedRejectionSum += fixedOutcomes.expectedRejection;

    // 3. Run Direct Jump Baseline
    const directPath = [sourceId, targetId];
    const directOutcomes = simulatePathOutcome(directPath, userProfile, affinities);
    directAdoptionSum += directOutcomes.expectedAdoption;
    directRejectionSum += directOutcomes.expectedRejection;
  }

  // Averages
  const unmodAvgLen = unmodLengthSum / SCENARIO_COUNT;
  const unmodBridgeUsage = (unmodBridgePathsCount / SCENARIO_COUNT) * 100.0;
  const unmodAvgAdopt = unmodAdoptionSum / SCENARIO_COUNT;
  const unmodAvgReject = unmodRejectionSum / SCENARIO_COUNT;

  const fixedAvgLen = fixedLengthSum / SCENARIO_COUNT;
  const fixedBridgeUsage = (fixedBridgePathsCount / SCENARIO_COUNT) * 100.0;
  const fixedAvgAdopt = fixedAdoptionSum / SCENARIO_COUNT;
  const fixedAvgReject = fixedRejectionSum / SCENARIO_COUNT;

  const directAvgAdopt = directAdoptionSum / SCENARIO_COUNT;
  const directAvgReject = directRejectionSum / SCENARIO_COUNT;

  console.log('\n================ ARTIST-NODE AUDIT RESULTS ================');
  console.log(`Total Scenarios: ${SCENARIO_COUNT}`);

  console.log(`\n1. UNMODIFIED LAYER 8 ALGORITHM (With Loopholes):`);
  console.log(`   - Average path length: ${unmodAvgLen.toFixed(3)} nodes`);
  console.log(`   - Bridge usage rate: ${unmodBridgeUsage.toFixed(2)}%`);
  console.log(`   - Average Adoption probability: ${unmodAvgAdopt.toFixed(3)}`);
  console.log(`   - Average Rejection probability: ${unmodAvgReject.toFixed(3)}`);
  console.log(`   - Relative Adoption Gain vs Direct Jump: ${(((unmodAvgAdopt - directAvgAdopt) / directAvgAdopt) * 100.0).toFixed(2)}%`);
  console.log(`   - Relative Rejection Reduction vs Direct Jump: ${(((directAvgReject - unmodAvgReject) / directAvgReject) * 100.0).toFixed(2)}%`);

  console.log(`\n2. FIXED LAYER 8 ALGORITHM (Bridges & Smoothness Fixed):`);
  console.log(`   - Average path length: ${fixedAvgLen.toFixed(3)} nodes`);
  console.log(`   - Bridge usage rate: ${fixedBridgeUsage.toFixed(2)}%`);
  console.log(`   - Average Adoption probability: ${fixedAvgAdopt.toFixed(3)}`);
  console.log(`   - Average Rejection probability: ${fixedAvgReject.toFixed(3)}`);
  console.log(`   - Relative Adoption Gain vs Direct Jump: ${(((fixedAvgAdopt - directAvgAdopt) / directAvgAdopt) * 100.0).toFixed(2)}%`);
  console.log(`   - Relative Rejection Reduction vs Direct Jump: ${(((directAvgReject - fixedAvgReject) / directAvgReject) * 100.0).toFixed(2)}%`);

  console.log(`\n3. DIRECT JUMP BASELINE:`);
  console.log(`   - Average Adoption probability: ${directAvgAdopt.toFixed(3)}`);
  console.log(`   - Average Rejection probability: ${directAvgReject.toFixed(3)}`);

  console.log('\n=== LAYER 8 ARTIST-NODE SEQUENCING AUDIT COMPLETE ===');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
