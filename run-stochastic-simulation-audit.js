const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Helper to generate Gaussian random numbers (Box-Muller transform)
function randomNormal(mean = 0.0, stdDev = 1.0) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return num * stdDev + mean;
}

function clamp(val, min = 0.0, max = 1.0) {
  return Math.min(Math.max(val, min), max);
}

// Standard normal cumulative distribution function (Probit approximation)
function cdfNormal(x) {
  const t = 1.0 / (1.0 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2.0);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x >= 0.0 ? 1.0 - p : p;
}

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

async function main() {
  console.log('=== STARTING ORCA STOCHASTIC SIMULATION AUDIT ===\n');

  // Load active graph structure
  const dbArtists = await prisma.artist.findMany({
    include: { embeddings: { where: { embeddingVersion: 1 } } }
  });
  const dbBridges = await prisma.territoryBridge.findMany({});

  console.log(`Loaded ${dbArtists.length} artists and ${dbBridges.length} bridges.`);

  const artists = dbArtists.map(a => {
    const emb = a.embeddings[0];
    let fused = [];
    try {
      fused = JSON.parse(emb?.fusedVector || '[]');
    } catch {}
    if (fused.length < 33) fused = new Array(33).fill(0.0);
    return { id: a.id, fused, popularity: a.popularity };
  });

  const similarityCache = new Map();
  for (let i = 0; i < artists.length; i++) {
    for (let j = i; j < artists.length; j++) {
      const a = artists[i];
      const b = artists[j];
      const sim = cosineSimilarity(a.fused, b.fused);
      similarityCache.set(`${a.id}_${b.id}`, sim);
      similarityCache.set(`${b.id}_${a.id}`, sim);
    }
  }

  const getEdgeDetails = (a, b) => {
    if (a === b) return { similarity: 1.0, distance: 0.0 };
    const sim = similarityCache.get(`${a}_${b}`) ?? 0.0;
    // Scale similarity
    const scaledSim = clamp((sim - 0.60) / 0.40);
    return { similarity: scaledSim, distance: clamp(1.0 - scaledSim) };
  };

  const bridgeMap = new Map();
  dbBridges.forEach(b => {
    const cur = bridgeMap.get(b.artistId) || 0.0;
    bridgeMap.set(b.artistId, Math.max(cur, b.bridgeStrength));
  });
  const getBridgeStrength = (id) => bridgeMap.get(id) ?? 0.0;

  // Build top-30 sparse graph
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
      return { neighborId: n.neighborId, similarity: details.similarity, distance: details.distance };
    }));
  });

  // Dijkstra Shortest Path helper
  function findShortestPath(source, target) {
    const dist = {}, prev = {}, queue = new Set();
    artists.forEach(a => {
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
      neighbors.forEach(n => {
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

  // Layer 8 Pathfinding Algorithm
  function computePathway(sourceId, targetId, userProfile, affinities, relState) {
    const overallReadiness = userProfile.overallReadiness;
    const noveltyAppetite = userProfile.noveltyAppetite;

    let style = 'DIRECT';
    const { distance: bestDist } = getEdgeDetails(sourceId, targetId);

    if (relState === 'RESISTANT') style = 'BRIDGE';
    else if (relState === 'DORMANT' || relState === 'RETURNING') style = 'REINTRODUCTION';
    else if (relState === 'CURIOUS') style = 'CURRICULUM';

    let maxPathLen = 2;
    let stateNoveltyModifier = 1.0;

    if (relState === 'RESISTANT') {
      maxPathLen = 4;
      stateNoveltyModifier = 0.55;
    } else if (relState === 'DORMANT') {
      maxPathLen = 3;
      stateNoveltyModifier = 0.8;
    } else if (relState === 'CURIOUS') {
      maxPathLen = 3;
      stateNoveltyModifier = 1.25;
    } else if (relState === 'EXPLORING') {
      maxPathLen = 2;
      stateNoveltyModifier = 1.5;
    }

    if (overallReadiness < 0.3) {
      maxPathLen = Math.max(maxPathLen, 3);
    } else if (overallReadiness >= 0.7) {
      maxPathLen = Math.min(maxPathLen, 3);
      if (relState === 'EXPLORING') maxPathLen = 2;
    }

    const noveltyBudget = clamp((noveltyAppetite * 0.5 + overallReadiness * 0.3 + 0.1) * stateNoveltyModifier);
    const candidates = [];

    function dfs(current, path) {
      if (current === targetId) {
        candidates.push([...path]);
        return;
      }
      if (path.length >= maxPathLen) return;
      if (candidates.length >= 50) return;

      const neighbors = graph.get(current) || [];
      neighbors.forEach(n => {
        if (!path.includes(n.neighborId)) {
          path.push(n.neighborId);
          dfs(n.neighborId, path);
          path.pop();
        }
      });
    }
    dfs(sourceId, [sourceId]);

    if (candidates.length === 0) candidates.push([sourceId, targetId]);

    let bestPath = [sourceId, targetId];
    let bestPathScore = -999.0;

    candidates.forEach(path => {
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
        if (similarity < 0.45) isSmooth = false;
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
      const targetAff = affinities[targetId] || { compatibility: 0.5 };
      const expectedAdoption = clamp(pathCoherence * targetAff.compatibility * overallReadiness);

      let totalRisk = 0.0;
      for (let i = 1; i < path.length; i++) {
        const { distance } = getEdgeDetails(path[i - 1], path[i]);
        const stepAcc = affinities[path[i]]?.accessibility ?? 0.5;
        const stepRisk = clamp(distance * (1.0 - stepAcc) * (1.0 - overallReadiness));
        totalRisk += stepRisk;
      }
      const expectedRejection = clamp(totalRisk / (path.length - 1));

      const lengthPenalty = (path.length - 2) * 0.02;
      const constraintPenalty = (!isMonotonic ? 0.2 : 0.0) + (!isSmooth ? 0.25 : 0.0);

      let bridgeReward = 0.0;
      for (let i = 1; i < path.length - 1; i++) {
        if (getBridgeStrength(path[i]) > 0.4) bridgeReward += 0.15;
      }

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
      }
    });

    return { path: bestPath, totalScore: bestPathScore };
  }

  // ─── REDESIGNED STOCHASTIC SIMULATOR ──────────────────────────────
  // Models memory decay, satiation, mood bias, competing recommendations, random skips,
  // skip-driven session dropout (retention), and probit-based target adoption.
  function simulateStochasticCultivation(path, userProfile, affinities) {
    const targetId = path[path.length - 1];
    const overallReadiness = userProfile.overallReadiness;
    
    // Environment Contexts
    const moodBias = randomNormal(0.0, 0.35); // Volatile user state
    const competingRecs = Math.random() * 0.30; // competitive recommendation overlap
    const targetAff = affinities[targetId] || { compatibility: 0.5 };

    let targetFamiliarity = affinities[targetId]?.familiarity ?? 0.05;
    let targetFluency = 0.30;
    let satiation = 0.0;
    let noveltyFatigue = 0.0;
    let pathRejection = 0.0;
    let stepsTaken = 0;

    for (let i = 1; i < path.length; i++) {
      stepsTaken++;
      const u = path[i - 1];
      const v = path[i];
      const { similarity, distance } = getEdgeDetails(u, v);
      const bridgeStr = getBridgeStrength(v);

      // A. Inconsistent Listening & Forgetting (Time Gap Decay)
      if (i > 1) {
        const daysBetweenSteps = Math.random() < 0.4 ? 0 : Math.floor(Math.random() * 7) + 1;
        if (daysBetweenSteps > 0) {
          targetFamiliarity = targetFamiliarity * Math.exp(-0.12 * daysBetweenSteps);
          targetFluency = targetFluency * Math.exp(-0.08 * daysBetweenSteps);
          satiation = satiation * Math.exp(-0.25 * daysBetweenSteps);
        }
      }

      // B. Boredom (Satiation) & Novelty Fatigue updates
      satiation = clamp(satiation * 0.65 + 0.35 * similarity);
      noveltyFatigue = clamp(noveltyFatigue * 0.60 + 0.40 * distance);

      // C. Logistic Skip Gate (Stochastic)
      const skipLogisticInput = 
        0.2 
        + 2.5 * distance 
        - 1.0 * similarity 
        - 1.5 * targetFluency 
        + 2.0 * satiation 
        + 1.8 * noveltyFatigue 
        - 1.2 * overallReadiness 
        - moodBias 
        + randomNormal(0.0, 0.60);

      const skipProb = 1.0 / (1.0 + Math.exp(-skipLogisticInput));
      const trackSkipped = Math.random() < skipProb;

      // D. State Updates after Exposure
      if (trackSkipped) {
        pathRejection = clamp(pathRejection + 0.45 * (1.0 - pathRejection));
        targetFluency = clamp(targetFluency * 0.70);
        targetFamiliarity = clamp(targetFamiliarity * 0.95);
      } else {
        pathRejection = pathRejection * 0.90;
        
        // Successful exposure builds target familiarity
        const simToTarget = getEdgeDetails(v, targetId).similarity;
        const exposureWeight = similarity * 4.0 + bridgeStr * 2.5;
        const stepFam = clamp(1.0 - Math.exp(-0.25 * exposureWeight)) * (0.2 + 0.8 * simToTarget);
        targetFamiliarity = clamp(targetFamiliarity + stepFam * 0.40 - 0.15 * satiation);

        // Fluency update
        const stepFluency = clamp((similarity * 0.75 + targetFamiliarity * 0.25 + 0.2) / 1.2);
        targetFluency = clamp(targetFluency * 0.50 + stepFluency * 0.50 + randomNormal(0.0, 0.08));
      }

      // E. External Discoveries
      if (Math.random() < 0.05) {
        targetFamiliarity = clamp(targetFamiliarity + 0.15);
        targetFluency = clamp(targetFluency + 0.10);
        satiation = clamp(satiation + 0.10);
      }

      // F. Session Dropout (Frustration, distraction, competing recommendations, life interruptions)
      let dropoutProb = clamp(0.08 + 0.35 * satiation + 0.30 * noveltyFatigue + 0.45 * pathRejection + 0.50 * competingRecs - 0.20 * overallReadiness - moodBias);
      
      const lifeInterruption = Math.random() < 0.03; // 3% per-step life interruption probability
      if (lifeInterruption) {
        dropoutProb = 1.0;
      }

      if (Math.random() < dropoutProb) {
        return {
          adoptionProbability: 0.0,
          rejectionProbability: pathRejection,
          completed: false,
          stepsTaken: i
        };
      }
    }

    // G. Probit Adoption Gate (final durable taste adoption)
    const probitInput = 
      2.2 * targetAff.compatibility 
      + 1.6 * targetFamiliarity 
      + 1.3 * targetFluency 
      - 2.5 * satiation 
      - 2.0 * competingRecs
      + moodBias 
      - 2.1; // threshold offset

    const rawAdoption = clamp(cdfNormal(probitInput));
    const completionRate = clamp(1.0 - pathRejection);
    const adoptionProbability = clamp(rawAdoption * completionRate);

    // Retention is modeled as completing the path successfully
    const completed = pathRejection < 0.5;

    return {
      adoptionProbability,
      rejectionProbability: pathRejection,
      completed,
      stepsTaken
    };
  }

  // ─── RUNNING 100,000 SCENARIOS ─────────────────────────────────────
  const SCENARIO_COUNT = 100000;
  console.log(`Simulating ${SCENARIO_COUNT} stochastic scenarios...`);

  let l8AdoptionSum = 0, l8RejectionSum = 0, l8CompletionSum = 0;
  let directAdoptionSum = 0, directRejectionSum = 0, directCompletionSum = 0;
  let randomAdoptionSum = 0, randomRejectionSum = 0, randomCompletionSum = 0;

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

    const affinities = {};
    artists.forEach(a => {
      affinities[a.id] = {
        compatibility: Math.random() * 0.8 + 0.1, // compatibility bounded
        accessibility: Math.random(),
        familiarity: a.id === sourceId ? 0.6 + Math.random() * 0.4 : Math.random() * 0.1
      };
    });

    const relState = ['CURIOUS', 'EXPLORING', 'RESISTANT', 'DORMANT', 'RETURNING', 'EMERGING'][Math.floor(Math.random() * 6)];

    // Layer 8 Pathway
    const l8Result = computePathway(sourceId, targetId, userProfile, affinities, relState);
    const l8Outcome = simulateStochasticCultivation(l8Result.path, userProfile, affinities);
    l8AdoptionSum += l8Outcome.adoptionProbability;
    l8RejectionSum += l8Outcome.rejectionProbability;
    if (l8Outcome.completed) l8CompletionSum++;

    // Direct baseline
    const directPath = [sourceId, targetId];
    const directOutcome = simulateStochasticCultivation(directPath, userProfile, affinities);
    directAdoptionSum += directOutcome.adoptionProbability;
    directRejectionSum += directOutcome.rejectionProbability;
    if (directOutcome.completed) directCompletionSum++;

    // Random intermediate baseline
    const randMiddleIdx = Math.floor(Math.random() * artists.length);
    const randomPath = [sourceId, artists[randMiddleIdx].id, targetId];
    const randomOutcome = simulateStochasticCultivation(randomPath, userProfile, affinities);
    randomAdoptionSum += randomOutcome.adoptionProbability;
    randomRejectionSum += randomOutcome.rejectionProbability;
    if (randomOutcome.completed) randomCompletionSum++;
  }

  // Calculate Metrics
  const l8Adopt = l8AdoptionSum / SCENARIO_COUNT;
  const l8Reject = l8RejectionSum / SCENARIO_COUNT;
  const l8Complete = l8CompletionSum / SCENARIO_COUNT;

  const directAdopt = directAdoptionSum / SCENARIO_COUNT;
  const directReject = directRejectionSum / SCENARIO_COUNT;
  const directComplete = directCompletionSum / SCENARIO_COUNT;

  const randomAdopt = randomAdoptionSum / SCENARIO_COUNT;
  const randomReject = randomRejectionSum / SCENARIO_COUNT;
  const randomComplete = randomCompletionSum / SCENARIO_COUNT;

  console.log('\n================ STOCHASTIC SIMULATION RESULTS ================');
  console.log(`\nLayer 8 Pathway (Sequencing Engine):`);
  console.log(`  - Adoption Rate:   ${(l8Adopt * 100).toFixed(2)}%  (Target Range: 10 - 40%)`);
  console.log(`  - Rejection Rate:  ${(l8Reject * 100).toFixed(2)}%  (Target Range: 10 - 50%)`);
  console.log(`  - Retention Rate:  ${(l8Complete * 100).toFixed(2)}%  (Target Range: 20 - 60%)`);

  console.log(`\nDirect Recommendation Baseline:`);
  console.log(`  - Adoption Rate:   ${(directAdopt * 100).toFixed(2)}%`);
  console.log(`  - Rejection Rate:  ${(directReject * 100).toFixed(2)}%`);
  console.log(`  - Retention Rate:  ${(directComplete * 100).toFixed(2)}%`);

  console.log(`\nRandom Intermediate Pathway Baseline:`);
  console.log(`  - Adoption Rate:   ${(randomAdopt * 100).toFixed(2)}%`);
  console.log(`  - Rejection Rate:  ${(randomReject * 100).toFixed(2)}%`);
  console.log(`  - Retention Rate:  ${(randomComplete * 100).toFixed(2)}%`);

  const lift = ((l8Adopt - directAdopt) / directAdopt) * 100;
  const rejectionReduction = ((directReject - l8Reject) / directReject) * 100;

  console.log(`\n--- DEVIATION ANALYSIS ---`);
  console.log(`Relative Adoption Lift (Layer 8 vs Direct): ${lift.toFixed(2)}%`);
  console.log(`Relative Rejection Reduction:              ${rejectionReduction.toFixed(2)}%`);

  const inAdoptionRange = l8Adopt >= 0.10 && l8Adopt <= 0.40;
  const inRetentionRange = l8Complete >= 0.20 && l8Complete <= 0.60;
  const inRejectionRange = l8Reject >= 0.10 && l8Reject <= 0.50;

  if (inAdoptionRange && inRetentionRange && inRejectionRange) {
    console.log('\nSUCCESS: Simulator successfully calibrated. All metrics are within target boundaries.');
  } else {
    console.warn('\nWARNING: Simulator out of target calibration boundaries.');
  }

  console.log('\n=== ORCA STOCHASTIC SIMULATION AUDIT COMPLETE ===');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
