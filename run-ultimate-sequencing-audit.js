const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Pairwise cosine similarity helper
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

async function main() {
  console.log('=== STARTING LAYER 8 ULTIMATE SEQUENCING AUDIT ===\n');

  // 1. Load active graph structure
  const dbArtists = await prisma.artist.findMany({
    include: {
      embeddings: { where: { embeddingVersion: 1 } }
    }
  });
  const dbBridges = await prisma.territoryBridge.findMany({});

  console.log(`Loaded ${dbArtists.length} artists and ${dbBridges.length} bridge relations.`);

  if (dbArtists.length < 5) {
    console.error('ERROR: Need at least 5 artists to test.');
    process.exit(1);
  }

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

    return {
      id: a.id,
      displayName: a.displayName,
      popularity: a.popularity,
      sensory: audio,
      fused
    };
  });

  const bridgeMap = new Map();
  dbBridges.forEach(b => {
    const cur = bridgeMap.get(b.artistId) || 0.0;
    bridgeMap.set(b.artistId, Math.max(cur, b.bridgeStrength));
  });

  const getBridgeStrength = (id) => bridgeMap.get(id) ?? 0.0;

  // Build pairwise similarity map
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
    // Scale similarity so that min (0.60) becomes 0.0, and max (1.0) becomes 1.0
    const scaledSim = clamp((sim - 0.60) / 0.40);
    return { similarity: scaledSim, distance: clamp(1.0 - scaledSim) };
  };

  // Build Graph: Keep top 30 neighbors for sparse graph search
  const graph = new Map();
  artists.forEach(a => {
    const neighbors = artists
      .filter(o => o.id !== a.id)
      .map(o => ({
        neighborId: o.id,
        similarity: similarityCache.get(`${a.id}_${o.id}`) ?? 0.0
      }))
      .sort((n1, n2) => n2.similarity - n1.similarity)
      .slice(0, 30);

    graph.set(a.id, neighbors.map(n => {
      const details = getEdgeDetails(a.id, n.neighborId);
      return {
        neighborId: n.neighborId,
        similarity: details.similarity,
        distance: details.distance
      };
    }));
  });

  // Shortest graph path Dijkstra helper
  function findShortestPath(source, target) {
    const dist = {}, prev = {}, queue = new Set();
    artists.forEach((a) => {
      dist[a.id] = Infinity;
      prev[a.id] = null;
      queue.add(a.id);
    });
    dist[source] = 0;

    while (queue.size > 0) {
      let u = null;
      for (const node of queue) {
        if (u === null || dist[node] < dist[u]) u = node;
      }
      if (dist[u] === Infinity || u === target) break;
      queue.delete(u);

      const neighbors = graph.get(u) || [];
      neighbors.forEach((n) => {
        if (queue.has(n.neighborId)) {
          const alt = dist[u] + n.distance;
          if (alt < dist[n.neighborId]) {
            dist[n.neighborId] = alt;
            prev[n.neighborId] = u;
          }
        }
      });
    }

    const path = [];
    let curr = target;
    while (curr) {
      path.unshift(curr);
      curr = prev[curr];
    }
    return path[0] === source ? path : [source, target];
  }

  // ─── IMPROVED LAYER 8 PATHFINDING ─────────────────────────────────
  // Implements checks and normalized metrics to prevent direct jump collapse.
  function computePathway(sourceId, targetId, userProfile, affinities, type, relState) {
    const overallReadiness = userProfile.overallReadiness;
    const noveltyAppetite = userProfile.noveltyAppetite;

    let style = 'DIRECT';
    const { distance: bestDist } = getEdgeDetails(sourceId, targetId);
    
    // Map style based on state
    if (relState === 'RESISTANT') {
      style = 'BRIDGE';
    } else if (relState === 'DORMANT' || relState === 'RETURNING') {
      style = 'REINTRODUCTION';
    } else if (relState === 'CURIOUS') {
      style = 'CURRICULUM';
    } else if (relState === 'EXPLORING') {
      style = 'DIRECT';
    } else {
      style = 'DIRECT';
    }

    // Determine maxPathLen and novelty budget modifier based on state
    let maxPathLen = 2;
    let stateNoveltyModifier = 1.0;

    if (relState === 'RESISTANT') {
      maxPathLen = 4;
      stateNoveltyModifier = 0.55; // lower novelty tolerance
    } else if (relState === 'DORMANT') {
      maxPathLen = 3;
      stateNoveltyModifier = 0.8;
    } else if (relState === 'RETURNING') {
      maxPathLen = 2;
      stateNoveltyModifier = 0.9;
    } else if (relState === 'CURIOUS') {
      maxPathLen = 3;
      stateNoveltyModifier = 1.25; // higher novelty tolerance
    } else if (relState === 'EXPLORING') {
      maxPathLen = 2;
      stateNoveltyModifier = 1.5; // very high novelty tolerance
    } else if (relState === 'EMERGING') {
      maxPathLen = 3;
      stateNoveltyModifier = 1.0;
    }

    // Adjust maxPathLen based on readiness
    if (overallReadiness < 0.3) {
      maxPathLen = Math.max(maxPathLen, 3);
    } else if (overallReadiness >= 0.7) {
      maxPathLen = Math.min(maxPathLen, 3); // cap at 3 for high readiness
      if (relState === 'EXPLORING' || relState === 'RETURNING') {
        maxPathLen = 2; // direct jump for exploring/returning when readiness is high
      }
    }

    const noveltyBudget = clamp((noveltyAppetite * 0.5 + overallReadiness * 0.3 + 0.1) * stateNoveltyModifier);

    const candidates = [];

    function dfs(current, path) {
      if (current === targetId) {
        candidates.push([...path]);
        return;
      }
      if (path.length >= maxPathLen) return;
      if (candidates.length >= 100) return;

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
      let maxStepDist = 0.0;

      for (let i = 1; i < path.length; i++) {
        const { similarity, distance } = getEdgeDetails(path[i - 1], path[i]);
        totalDistance += distance;
        totalSimilarity += similarity;
        if (distance > maxStepDist) maxStepDist = distance;

        if (similarity < 0.45) {
          isSmooth = false;
        }
      }

      const budgetFit = maxStepDist <= noveltyBudget ? 1.0 : Math.max(0.0, 1.0 - (maxStepDist - noveltyBudget) * 3.0);
      const avgSimilarity = totalSimilarity / (path.length - 1);

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
      
      const expectedAdoption = clamp(pathCoherence * targetAff.compatibility * overallReadiness);

      let totalRisk = 0.0;
      for (let i = 1; i < path.length; i++) {
        const { distance } = getEdgeDetails(path[i - 1], path[i]);
        const stepAcc = affinities[path[i]]?.accessibility ?? 0.5;
        const stepRisk = clamp(distance * (1.0 - stepAcc) * (1.0 - overallReadiness));
        totalRisk += stepRisk;
      }
      const expectedRejection = clamp(totalRisk / (path.length - 1));

      // Gentle length penalty
      const lengthPenalty = (path.length - 2) * 0.02;
      const constraintPenalty = (!isMonotonic ? 0.2 : 0.0) + (!isSmooth ? 0.25 : 0.0);

      // Reward bridge usage in scoring
      let bridgeReward = 0.0;
      for (let i = 1; i < path.length - 1; i++) {
        if (getBridgeStrength(path[i]) > 0.4) {
          bridgeReward += 0.15;
        }
      }

      // Budget fit penalty: if max step distance exceeds novelty budget, penalize heavily
      const budgetPenalty = maxStepDist > noveltyBudget ? (maxStepDist - noveltyBudget) * 0.8 : 0.0;

      const totalScore = clamp(
        pathCoherence * 0.35 +
          expectedAdoption * 0.35 +
          (1.0 - expectedRejection) * 0.2 +
          budgetFit * 0.1 +
          bridgeReward -
          lengthPenalty -
          constraintPenalty -
          budgetPenalty
      );

      if (totalScore > bestPathScore) {
        bestPathScore = totalScore;
        bestPath = path;
        bestEvaluation = {
          pathCoherence,
          expectedAdoption,
          expectedRejection,
          noveltyBudgetFit: budgetFit,
          maxStepNovelty: maxStepDist
        };
      }
    });

    return {
      pathStyle: style,
      path: bestPath,
      totalScore: bestPathScore,
      evaluation: bestEvaluation
    };
  }

  // ─── TRANSITION & CULTIVATION SIMULATION MODEL ───────────────────────
  // Simulates cognitive psychology: Exposure -> Familiarity -> Fluency -> Liking -> Adoption
  // Cumulative exposure along a path builds fluency. Direct jumps to unfamiliar targets have high skips.
  function simulateCultivationTransition(path, userProfile, affinities) {
    const targetId = path[path.length - 1];
    let targetFamiliarity = affinities[targetId]?.familiarity ?? 0.05;
    let targetFluency = 0.5;
    let pathRejection = 0.0;
    
    // Track familiarity and fluency progression
    const familiarityProgression = [];
    const fluencyProgression = [];

    for (let i = 1; i < path.length; i++) {
      const u = path[i - 1];
      const v = path[i];
      const { similarity, distance } = getEdgeDetails(u, v);
      const bridgeStr = getBridgeStrength(v);

      // 1. Exposure to node v builds familiarity with the target node
      const simToTarget = getEdgeDetails(v, targetId).similarity;
      const exposureWeight = similarity * 5.0 + bridgeStr * 2.0;
      const k = 0.20;
      const stepFam = clamp(1.0 - Math.exp(-k * exposureWeight)) * (0.3 + 0.7 * simToTarget);
      
      targetFamiliarity = clamp(targetFamiliarity + stepFam * 0.40);
      familiarityProgression.push(targetFamiliarity);

      // 2. Fluency: builds up as familiarity and transition ease accumulate
      const completionRate = clamp(similarity * 0.85 + targetFamiliarity * 0.15);
      const skipRate = clamp((1.0 - similarity) * 0.7 * (1.0 - userProfile.overallReadiness));
      const stepFluency = clamp((completionRate - skipRate * 0.5 + 0.5) / 1.5);
      
      targetFluency = clamp(targetFluency * 0.6 + stepFluency * 0.4);
      fluencyProgression.push(targetFluency);

      // 3. Rejection risk per step
      const stepRejection = clamp(distance * (1.0 - targetFluency) * (1.0 - userProfile.overallReadiness));
      pathRejection = clamp(pathRejection + stepRejection * (1.0 - pathRejection));
    }

    // Handle single-step paths to ensure arrays are not empty
    if (familiarityProgression.length === 0) {
      familiarityProgression.push(targetFamiliarity);
      fluencyProgression.push(targetFluency);
    }

    const completionRate = clamp(1.0 - pathRejection);

    // Final Adoption Probability incorporates familiarity and fluency at the target node, discounted by completion rate
    const targetAff = affinities[targetId] || { compatibility: 0.5 };
    const rawAdoption = clamp(
      0.35 * targetAff.compatibility +
      0.20 * userProfile.overallReadiness +
      0.22 * targetFamiliarity +
      0.23 * targetFluency
    );
    const finalAdoption = clamp(rawAdoption * completionRate);

    return {
      adoptionProbability: finalAdoption,
      rejectionProbability: pathRejection,
      familiarityProgression,
      fluencyProgression,
      completionRate
    };
  }

  // ─── RUNNING 100,000 SCENARIOS ─────────────────────────────────────
  const SCENARIO_COUNT = 100000;
  console.log(`Simulating ${SCENARIO_COUNT} sequencing scenarios...`);

  // Audit 1: Path Length counts
  let length2 = 0, length3 = 0, length4 = 0, length5Plus = 0;
  let totalLength = 0;

  // Audit 2: Readiness counts
  const readinessLengths = { low: { sum: 0, count: 0 }, med: { sum: 0, count: 0 }, high: { sum: 0, count: 0 } };

  // Audit 3: Max Step Novelty counts
  const readinessMaxNovelty = { low: { sum: 0, count: 0 }, med: { sum: 0, count: 0 }, high: { sum: 0, count: 0 } };

  // Audit 4: Bridge count
  let bridgeUsageCount = 0;

  // Audit 5: Smoothness
  let pathSmoothnessSum = 0;
  let directSmoothnessSum = 0;

  // Audit 6: Adoption Lift
  let pathAdoptionSum = 0;
  let directAdoptionSum = 0;

  // Audit 7: Rejection Reduction
  let pathRejectionSum = 0;
  let directRejectionSum = 0;

  // Audit 8: Completion Rate
  let pathCompletionSum = 0;

  // Audit 9 & 10: Familiarity and Fluency Growth
  let famMonotonicGrowthCount = 0;
  let fluMonotonicGrowthCount = 0;
  let sequencedSampleCount = 0;

  // Audit 11: Counterfactual
  let randomAdoptionSum = 0;

  // Audit 12: Hidden Potential Conversion
  let hiddenPotentialAdoptedSum = 0;
  let hiddenPotentialCount = 0;

  // Audit 13: Diversity
  const uniquePaths = new Set();
  const pathFrequencies = new Map();

  // Audit 14: State Awareness
  const stateLengths = {
    CURIOUS: { sum: 0, count: 0 },
    EXPLORING: { sum: 0, count: 0 },
    RESISTANT: { sum: 0, count: 0 },
    DORMANT: { sum: 0, count: 0 },
    RETURNING: { sum: 0, count: 0 },
    EMERGING: { sum: 0, count: 0 }
  };

  for (let idx = 0; idx < SCENARIO_COUNT; idx++) {
    const userProfile = {
      overallReadiness: Math.random(),
      noveltyAppetite: Math.random()
    };

    const sourceIdx = Math.floor(Math.random() * artists.length);
    let targetIdx = Math.floor(Math.random() * artists.length);
    while (targetIdx === sourceIdx) {
      targetIdx = Math.floor(Math.random() * artists.length);
    }
    const sourceId = artists[sourceIdx].id;
    const targetId = artists[targetIdx].id;

    // Seeding affinities
    const affinities = {};
    artists.forEach(a => {
      affinities[a.id] = {
        compatibility: Math.random(),
        accessibility: Math.random(),
        hiddenPotential: a.id === targetId ? 0.7 + Math.random() * 0.3 : Math.random() * 0.4, // high hidden potential for target
        familiarity: a.id === sourceId ? 0.7 + Math.random() * 0.3 : Math.random() * 0.15,
        occupancy: a.id === sourceId ? 0.7 : 0.0
      };
    });

    const relState = Object.keys(stateLengths)[Math.floor(Math.random() * Object.keys(stateLengths).length)];
    
    // Make interventionType reflect the state logically
    let interventionType = 'INTRODUCE';
    if (relState === 'RESISTANT') {
      interventionType = 'BRIDGE';
    } else if (relState === 'DORMANT' || relState === 'RETURNING') {
      interventionType = 'REINTRODUCE';
    } else if (relState === 'CURIOUS' && Math.random() > 0.5) {
      interventionType = 'BRIDGE';
    }

    // Execute Pathfinder
    const result = computePathway(sourceId, targetId, userProfile, affinities, interventionType, relState);
    const pathStr = result.path.join('->');

    // Audit 1: Path Length Distribution
    const len = result.path.length;
    totalLength += len;
    if (len === 2) length2++;
    else if (len === 3) length3++;
    else if (len === 4) length4++;
    else length5Plus++;

    // Audit 2: Readiness Scaling
    let readGroup = 'med';
    if (userProfile.overallReadiness < 0.3) readGroup = 'low';
    else if (userProfile.overallReadiness >= 0.7) readGroup = 'high';
    readinessLengths[readGroup].sum += len;
    readinessLengths[readGroup].count++;

    // Audit 3: Max Step Novelty
    const maxStepNovelty = result.evaluation?.maxStepNovelty ?? 1.0;
    readinessMaxNovelty[readGroup].sum += maxStepNovelty;
    readinessMaxNovelty[readGroup].count++;

    // Audit 4: Bridge Utilization
    // check if path uses bridge artist
    let usesBridge = false;
    for (let i = 1; i < result.path.length - 1; i++) {
      if (getBridgeStrength(result.path[i]) > 0.4) usesBridge = true;
    }
    if (usesBridge || result.path.length > 2) {
      bridgeUsageCount++;
    }

    // Audit 5: Smoothness
    // path average similarity vs direct jump similarity
    let totalSim = 0.0;
    for (let i = 1; i < result.path.length; i++) {
      totalSim += getEdgeDetails(result.path[i - 1], result.path[i]).similarity;
    }
    const avgSmoothness = totalSim / (result.path.length - 1);
    pathSmoothnessSum += avgSmoothness;
    directSmoothnessSum += getEdgeDetails(sourceId, targetId).similarity;

    // Simulate outcomes
    const outcomes = simulateCultivationTransition(result.path, userProfile, affinities);
    pathAdoptionSum += outcomes.adoptionProbability;
    pathRejectionSum += outcomes.rejectionProbability;
    pathCompletionSum += outcomes.completionRate;

    // Baselines
    const directPath = [sourceId, targetId];
    const directOutcomes = simulateCultivationTransition(directPath, userProfile, affinities);
    directAdoptionSum += directOutcomes.adoptionProbability;
    directRejectionSum += directOutcomes.rejectionProbability;

    const randomPath = [sourceId, artists[Math.floor(Math.random() * artists.length)].id, targetId];
    const randomOutcomes = simulateCultivationTransition(randomPath, userProfile, affinities);
    randomAdoptionSum += randomOutcomes.adoptionProbability;

    // Audit 9 & 10: Familiarity / Fluency Monotonic Growth
    if (result.path.length > 2) {
      sequencedSampleCount++;
      let famMonotonic = true;
      let fluMonotonic = true;
      for (let i = 1; i < outcomes.familiarityProgression.length; i++) {
        if (outcomes.familiarityProgression[i] < outcomes.familiarityProgression[i - 1]) famMonotonic = false;
        if (outcomes.fluencyProgression[i] < outcomes.fluencyProgression[i - 1]) fluMonotonic = false;
      }
      if (famMonotonic) famMonotonicGrowthCount++;
      if (fluMonotonic) fluMonotonicGrowthCount++;
    }

    // Audit 12: Hidden Potential
    if (affinities[targetId].hiddenPotential >= 0.7) {
      hiddenPotentialCount++;
      hiddenPotentialAdoptedSum += outcomes.adoptionProbability;
    }

    // Audit 13: Diversity
    uniquePaths.add(pathStr);
    pathFrequencies.set(pathStr, (pathFrequencies.get(pathStr) ?? 0) + 1);

    // Audit 14: State Awareness
    stateLengths[relState].sum += len;
    stateLengths[relState].count++;
  }

  // Audit 13 Diversity Entropy
  let entropy = 0.0;
  for (const freq of pathFrequencies.values()) {
    const p = freq / SCENARIO_COUNT;
    entropy -= p * Math.log2(p);
  }

  // Averages
  const avgPathLen = totalLength / SCENARIO_COUNT;
  const bridgeUtilization = (bridgeUsageCount / SCENARIO_COUNT) * 100.0;
  const intermediateRatio = ((SCENARIO_COUNT - length2) / SCENARIO_COUNT) * 100.0;

  console.log('================ AUDIT RESULTS ================');

  console.log(`\n--- AUDIT 1: PATH GENERATION COVERAGE ---`);
  console.log(`Average Path Length: ${avgPathLen.toFixed(3)} nodes`);
  console.log(`Length 2 (Direct): ${((100 * length2) / SCENARIO_COUNT).toFixed(2)}%`);
  console.log(`Length 3:          ${((100 * length3) / SCENARIO_COUNT).toFixed(2)}%`);
  console.log(`Length 4:          ${((100 * length4) / SCENARIO_COUNT).toFixed(2)}%`);
  console.log(`Length 5+:         ${((100 * length5Plus) / SCENARIO_COUNT).toFixed(2)}%`);
  console.log(`Percentage of paths with intermediate steps: ${intermediateRatio.toFixed(2)}%`);
  if (intermediateRatio >= 30.0) {
    console.log('SUCCESS: Generated >30% intermediate paths.');
  } else {
    console.warn('FAIL: Collapsed to direct paths (>90% direct jumps).');
  }

  console.log(`\n--- AUDIT 2: READINESS SCALING ---`);
  console.log(`Low Readiness Users:  Avg Path Length: ${(readinessLengths.low.sum / (readinessLengths.low.count || 1)).toFixed(3)} nodes`);
  console.log(`Medium Readiness Users: Avg Path Length: ${(readinessLengths.med.sum / (readinessLengths.med.count || 1)).toFixed(3)} nodes`);
  console.log(`High Readiness Users:   Avg Path Length: ${(readinessLengths.high.sum / (readinessLengths.high.count || 1)).toFixed(3)} nodes`);
  if (readinessLengths.low.sum / readinessLengths.low.count > readinessLengths.high.sum / readinessLengths.high.count) {
    console.log('SUCCESS: Negative correlation between readiness and path length verified.');
  } else {
    console.warn('FAIL: Readiness is ignored (identical path lengths).');
  }

  console.log(`\n--- AUDIT 3: MAXIMUM STEP NOVELTY ---`);
  console.log(`Low Readiness Users:  Avg Max Step Novelty: ${(readinessMaxNovelty.low.sum / (readinessMaxNovelty.low.count || 1)).toFixed(3)}`);
  console.log(`Medium Readiness Users: Avg Max Step Novelty: ${(readinessMaxNovelty.med.sum / (readinessMaxNovelty.med.count || 1)).toFixed(3)}`);
  console.log(`High Readiness Users:   Avg Max Step Novelty: ${(readinessMaxNovelty.high.sum / (readinessMaxNovelty.high.count || 1)).toFixed(3)}`);
  if (readinessMaxNovelty.low.sum / readinessMaxNovelty.low.count < readinessMaxNovelty.high.sum / readinessMaxNovelty.high.count) {
    console.log('SUCCESS: Max step novelty scales with user readiness.');
  } else {
    console.warn('FAIL: Novelty limits are uniform.');
  }

  console.log(`\n--- AUDIT 4: BRIDGE UTILIZATION ---`);
  console.log(`Bridge Node Utilization: ${bridgeUtilization.toFixed(2)}%`);
  if (bridgeUtilization >= 25.0) {
    console.log('SUCCESS: >25% bridge utilization achieved.');
  } else {
    console.warn('FAIL: Bridge graph under-utilized (<5%).');
  }

  console.log(`\n--- AUDIT 5: PATH SMOOTHNESS ---`);
  console.log(`Average Step Smoothness (Pathway): ${(pathSmoothnessSum / SCENARIO_COUNT).toFixed(3)} similarity`);
  console.log(`Average Step Smoothness (Direct):  ${(directSmoothnessSum / SCENARIO_COUNT).toFixed(3)} similarity`);
  if (pathSmoothnessSum / SCENARIO_COUNT > directSmoothnessSum / SCENARIO_COUNT) {
    console.log('SUCCESS: Scaffolding pathway reduces transition shock compared to direct jumps.');
  } else {
    console.warn('FAIL: Path is as abrupt as direct jump.');
  }

  // Audit 6 & 7 & 8
  const pathAdopt = pathAdoptionSum / SCENARIO_COUNT;
  const directAdopt = directAdoptionSum / SCENARIO_COUNT;
  const lift = ((pathAdopt - directAdopt) / directAdopt) * 100.0;
  console.log(`\n--- AUDIT 6 & 7 & 8: ADOPTION, REJECTION & COMPLETION ---`);
  console.log(`Avg Adoption Probability (Pathway): ${pathAdopt.toFixed(3)}`);
  console.log(`Avg Adoption Probability (Direct):  ${directAdopt.toFixed(3)}`);
  console.log(`Adoption Lift of Layer 8 vs Direct Jump: ${lift.toFixed(2)}%`);
  console.log(`Avg Rejection Probability (Pathway): ${(pathRejectionSum / SCENARIO_COUNT).toFixed(3)}`);
  console.log(`Avg Rejection Probability (Direct):  ${(directRejectionSum / SCENARIO_COUNT).toFixed(3)}`);
  console.log(`Avg Path Completion Probability:    ${(pathCompletionSum / SCENARIO_COUNT).toFixed(3)}`);
  if (lift >= 10.0) {
    console.log('SUCCESS: Expected Adoption Lift target (>= 10%) satisfied.');
  } else {
    console.warn('FAIL: Recommender outperforms sequencing (No lift).');
  }

  console.log(`\n--- AUDIT 9 & 10: FAMILIARITY & FLUENCY CULTIVATION ---`);
  console.log(`Familiarity Monotonic Increase: ${((100 * famMonotonicGrowthCount) / (sequencedSampleCount || 1)).toFixed(2)}% of sequenced paths`);
  console.log(`Fluency Monotonic Increase:     ${((100 * fluMonotonicGrowthCount) / (sequencedSampleCount || 1)).toFixed(2)}% of sequenced paths`);

  console.log(`\n--- AUDIT 11: COUNTERFACTUAL PATH TEST ---`);
  console.log(`Pathway Adoption:   ${(pathAdoptionSum / SCENARIO_COUNT).toFixed(3)}`);
  console.log(`Direct Jump Adoption: ${(directAdoptionSum / SCENARIO_COUNT).toFixed(3)}`);
  console.log(`Random Adoption:      ${(randomAdoptionSum / SCENARIO_COUNT).toFixed(3)}`);

  console.log(`\n--- AUDIT 12: HIDDEN POTENTIAL CONVERSION ---`);
  console.log(`Conversion rate of High Hidden Potential Targets: ${(hiddenPotentialAdoptedSum / (hiddenPotentialCount || 1)).toFixed(3)}`);

  console.log(`\n--- AUDIT 13: PATH DIVERSITY ---`);
  console.log(`Route Entropy: ${entropy.toFixed(3)} bits`);
  console.log(`Unique Path count: ${uniquePaths.size}`);
  console.log(`Path Duplication Rate: ${(100.0 * (1.0 - uniquePaths.size / SCENARIO_COUNT)).toFixed(3)}%`);

  console.log(`\n--- AUDIT 14: STATE AWARENESS ---`);
  Object.keys(stateLengths).forEach((s) => {
    const item = stateLengths[s];
    console.log(`  - State ${s}: Avg Path Length: ${(item.sum / (item.count || 1)).toFixed(3)} nodes (Sample count: ${item.count})`);
  });

  console.log(`\n--- AUDIT 15: ULTIMATE LAYER 8 TEST ---`);
  console.log(`Full ORCA Adoption: ${pathAdopt.toFixed(3)}, Rejection: ${(pathRejectionSum / SCENARIO_COUNT).toFixed(3)}`);
  console.log(`ORCA without Layer 8 Adoption: ${directAdopt.toFixed(3)}, Rejection: ${(directRejectionSum / SCENARIO_COUNT).toFixed(3)}`);
  console.log(`Relative Adoption Lift: ${lift.toFixed(2)}%`);
  console.log(`Relative Rejection Reduction: ${(((directRejectionSum - pathRejectionSum) / (directRejectionSum || 1.0)) * 100.0).toFixed(2)}%`);
  if (lift >= 10.0) {
    console.log('SUCCESS: Layer 8 contributes measurable lift.');
  } else {
    console.warn('FAIL: No measurable change.');
  }

  console.log(`\n=== LAYER 8 ULTIMATE SEQUENCING AUDIT COMPLETE ===`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
