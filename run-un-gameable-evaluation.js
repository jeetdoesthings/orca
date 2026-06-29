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
  console.log('=== STARTING ORCA UN-GAMEABLE PEER-REVIEW BENCHMARK ===\n');

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

  // Setup external genre map (independent of engine embeddings)
  const externalGenresList = [
    'Rock', 'Pop', 'Hip Hop', 'Jazz', 'Classical', 
    'Electronic', 'Metal', 'Folk', 'Blues', 'Reggae', 
    'R&B', 'Country', 'Punk', 'Soul', 'Latin'
  ];
  const artistGenres = new Map();
  artists.forEach((a, index) => {
    artistGenres.set(a.id, externalGenresList[index % externalGenresList.length]);
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

  // Layer 8 Pathfinding Algorithm
  function computePathway(sourceId, targetId, userProfile, affinities, relState) {
    const overallReadiness = userProfile.overallReadiness;
    const noveltyAppetite = userProfile.noveltyAppetite;

    let style = 'DIRECT';
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

  // ─── REDESIGNED UN-GAMEABLE SIMULATOR SESSION LOOP ─────────────────
  // Evaluates a path under strict skip budgets and generates logs for OPE and DORR.
  function simulateUnGameableSession(path, userProfile, affinities, skipBudget = 3) {
    const targetId = path[path.length - 1];
    const overallReadiness = userProfile.overallReadiness;
    
    // Environment Contexts
    const moodBias = randomNormal(0.0, 0.35);
    const competingRecs = Math.random() * 0.30;
    const targetAff = affinities[targetId] || { compatibility: 0.5 };

    let targetFamiliarity = affinities[targetId]?.familiarity ?? 0.05;
    let targetFluency = 0.30;
    let satiation = 0.0;
    let noveltyFatigue = 0.0;
    let pathRejection = 0.0;

    let totalSkips = 0;
    let secondsListened = 0;
    let completedSteps = 0;
    let genreBoundariesCrossed = 0;
    let sessionDropped = false;

    for (let i = 1; i < path.length; i++) {
      if (sessionDropped) break;

      const u = path[i - 1];
      const v = path[i];
      const { similarity, distance } = getEdgeDetails(u, v);
      const bridgeStr = getBridgeStrength(v);

      // Track genre boundary crossing
      if (artistGenres.get(u) !== artistGenres.get(v)) {
        genreBoundariesCrossed++;
      }

      // A. Forgetting / Time Gap
      if (i > 1) {
        const daysBetweenSteps = Math.random() < 0.4 ? 0 : Math.floor(Math.random() * 7) + 1;
        if (daysBetweenSteps > 0) {
          targetFamiliarity = targetFamiliarity * Math.exp(-0.12 * daysBetweenSteps);
          targetFluency = targetFluency * Math.exp(-0.08 * daysBetweenSteps);
          satiation = satiation * Math.exp(-0.25 * daysBetweenSteps);
        }
      }

      // B. Boredom & Fatigue
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

      if (trackSkipped) {
        totalSkips++;
        secondsListened += 30; // standard skipped song duration
        pathRejection = clamp(pathRejection + 0.45 * (1.0 - pathRejection));
        targetFluency = clamp(targetFluency * 0.70);
        targetFamiliarity = clamp(targetFamiliarity * 0.95);

        // Terminate session if skip budget exceeded
        if (totalSkips >= skipBudget) {
          sessionDropped = true;
          break;
        }
      } else {
        secondsListened += 180; // completed song duration
        completedSteps++;
        pathRejection = pathRejection * 0.90;
        
        const simToTarget = getEdgeDetails(v, targetId).similarity;
        const exposureWeight = similarity * 4.0 + bridgeStr * 2.5;
        const stepFam = clamp(1.0 - Math.exp(-0.25 * exposureWeight)) * (0.2 + 0.8 * simToTarget);
        targetFamiliarity = clamp(targetFamiliarity + stepFam * 0.40 - 0.15 * satiation);

        const stepFluency = clamp((similarity * 0.75 + targetFamiliarity * 0.25 + 0.2) / 1.2);
        targetFluency = clamp(targetFluency * 0.50 + stepFluency * 0.50 + randomNormal(0.0, 0.08));
      }

      // External discoveries
      if (Math.random() < 0.05) {
        targetFamiliarity = clamp(targetFamiliarity + 0.15);
        targetFluency = clamp(targetFluency + 0.10);
        satiation = clamp(satiation + 0.10);
      }

      // Dropout probability (natural frustration & external distractions)
      let dropoutProb = clamp(0.08 + 0.35 * satiation + 0.30 * noveltyFatigue + 0.45 * pathRejection + 0.50 * competingRecs - 0.20 * overallReadiness - moodBias);
      const lifeInterruption = Math.random() < 0.03;
      if (lifeInterruption) dropoutProb = 1.0;

      if (Math.random() < dropoutProb) {
        sessionDropped = true;
        break;
      }
    }

    let adopted = false;
    let organicPlaysCount = 0;

    if (!sessionDropped) {
      // Probit Adoption Gate
      const probitInput = 
        2.2 * targetAff.compatibility 
        + 1.6 * targetFamiliarity 
        + 1.3 * targetFluency 
        - 2.5 * satiation 
        - 2.0 * competingRecs
        + moodBias 
        - 2.1;

      const rawAdoption = clamp(cdfNormal(probitInput));
      const completionRate = clamp(1.0 - pathRejection);
      const adoptProb = clamp(rawAdoption * completionRate);
      adopted = Math.random() < adoptProb;

      // Simulate 14 days of post-intervention organic listening (DORR)
      for (let day = 1; day <= 14; day++) {
        if (Math.random() < 0.25) { // 25% chance of organic listening session on any day
          for (let song = 1; song <= 5; song++) {
            // Choice: 80% standard rotation/charts, 20% taste expansion slot
            if (Math.random() < 0.20) {
              const organicChoiceProb = clamp(targetAff.compatibility * 0.3 + targetFamiliarity * 0.5 + targetFluency * 0.2);
              if (Math.random() < organicChoiceProb) {
                organicPlaysCount++;
              }
            }
          }
        }
      }
    }

    return {
      completed: !sessionDropped && (totalSkips < skipBudget),
      secondsListened,
      genreBoundariesCrossed: !sessionDropped ? genreBoundariesCrossed : 0,
      adopted,
      organicRetentionPlay: organicPlaysCount > 0,
      stepsTaken: completedSteps
    };
  }

  // ─── OFF-POLICY ESTIMATION SEEDER & EVALUATION ──────────────────────
  console.log('Generating off-policy evaluation logging datasets...');
  const loggingDataset = [];
  const neighborCounts = [];
  artists.forEach(a => {
    neighborCounts.push((graph.get(a.id) || []).length || 1);
  });

  for (let idx = 0; idx < 5000; idx++) {
    const uIdx = Math.floor(Math.random() * artists.length);
    const vIdx = Math.floor(Math.random() * artists.length);
    const sourceId = artists[uIdx].id;
    const targetId = artists[vIdx].id;

    // Log transitions under a random behavior logging policy (mu)
    const neighbors = graph.get(sourceId) || [];
    if (neighbors.length > 0) {
      const chosenNeighbor = neighbors[Math.floor(Math.random() * neighbors.length)].neighborId;
      
      // Simulate outcome of this historical step
      const { similarity } = getEdgeDetails(sourceId, chosenNeighbor);
      const completes = Math.random() < similarity;
      
      loggingDataset.push({
        sourceId,
        chosenNeighbor,
        targetId,
        completes,
        muPropensity: 1.0 / neighbors.length
      });
    }
  }

  function evaluateOPE(policySelector) {
    let weightedRewardSum = 0;
    let weightSum = 0;

    loggingDataset.forEach(trial => {
      // Get policy's selection for the same state (source -> target)
      const policyPath = policySelector(trial.sourceId, trial.targetId);
      const policyAction = policyPath[1]; // policy's chosen next step

      // Inverse Propensity Scoring (IPS) weight
      let targetPropensity = 0.0;
      if (policyAction === trial.chosenNeighbor) {
        targetPropensity = 1.0; // deterministic selector
      }

      const weight = targetPropensity / trial.muPropensity;
      const reward = trial.completes ? 1.0 : 0.0;

      weightedRewardSum += reward * weight;
      weightSum += weight;
    });

    return weightSum > 0 ? (weightedRewardSum / weightSum) : 0.0;
  }

  // ─── RUNNING THE BENCHMARK (10,000 SCENARIOS) ──────────────────────
  const BENCHMARK_TRIALS = 10000;
  console.log(`Running benchmark on ${BENCHMARK_TRIALS} scenarios...`);

  const metrics = {
    l8: { completed: 0, sbc: 0, sbcTotal: 0, sbet: 0, dorr: 0 },
    direct: { completed: 0, sbc: 0, sbcTotal: 0, sbet: 0, dorr: 0 },
    random: { completed: 0, sbc: 0, sbcTotal: 0, sbet: 0, dorr: 0 }
  };

  let cleanAdoptionCount = 0;
  let noisyAdoptionCount = 0;

  for (let idx = 0; idx < BENCHMARK_TRIALS; idx++) {
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
        compatibility: Math.random() * 0.8 + 0.1,
        accessibility: Math.random(),
        familiarity: a.id === sourceId ? 0.6 + Math.random() * 0.4 : Math.random() * 0.1
      };
    });

    const relState = ['CURIOUS', 'EXPLORING', 'RESISTANT', 'DORMANT', 'RETURNING', 'EMERGING'][Math.floor(Math.random() * 6)];

    // 1. Evaluate Layer 8 Pathway under Clean and Noisy states (ASNS)
    const l8CleanResult = computePathway(sourceId, targetId, userProfile, affinities, relState);
    
    // Inject massive adversarial state noise (+-50% readiness)
    const noisyUserProfile = {
      overallReadiness: clamp(userProfile.overallReadiness + randomNormal(0.0, 0.40)),
      noveltyAppetite: clamp(userProfile.noveltyAppetite + randomNormal(0.0, 0.40))
    };
    const l8NoisyResult = computePathway(sourceId, targetId, noisyUserProfile, affinities, relState);

    // Simulate clean vs noisy outcomes (using clean profile for the user simulation)
    const cleanOutcome = simulateUnGameableSession(l8CleanResult.path, userProfile, affinities);
    const noisyOutcome = simulateUnGameableSession(l8NoisyResult.path, userProfile, affinities);

    if (cleanOutcome.completed) cleanAdoptionCount++;
    if (noisyOutcome.completed) noisyAdoptionCount++;

    // Layer 8 metrics
    metrics.l8.sbet += cleanOutcome.secondsListened;
    if (cleanOutcome.completed) {
      metrics.l8.completed++;
      metrics.l8.sbc += cleanOutcome.genreBoundariesCrossed;
      metrics.l8.sbcTotal++;
      if (cleanOutcome.organicRetentionPlay) {
        metrics.l8.dorr++;
      }
    }

    // 2. Evaluate Direct Baseline
    const directPath = [sourceId, targetId];
    const directOutcome = simulateUnGameableSession(directPath, userProfile, affinities);
    metrics.direct.sbet += directOutcome.secondsListened;
    if (directOutcome.completed) {
      metrics.direct.completed++;
      metrics.direct.sbc += directOutcome.genreBoundariesCrossed;
      metrics.direct.sbcTotal++;
      if (directOutcome.organicRetentionPlay) {
        metrics.direct.dorr++;
      }
    }

    // 3. Evaluate Random Baseline
    const randMidIdx = Math.floor(Math.random() * artists.length);
    const randomPath = [sourceId, artists[randMidIdx].id, targetId];
    const randomOutcome = simulateUnGameableSession(randomPath, userProfile, affinities);
    metrics.random.sbet += randomOutcome.secondsListened;
    if (randomOutcome.completed) {
      metrics.random.completed++;
      metrics.random.sbc += randomOutcome.genreBoundariesCrossed;
      metrics.random.sbcTotal++;
      if (randomOutcome.organicRetentionPlay) {
        metrics.random.dorr++;
      }
    }
  }

  // 4. Calculate Off-Policy expected rewards (OPE)
  const l8OPE = evaluateOPE((src, tgt) => {
    const mockProfile = { overallReadiness: 0.5, noveltyAppetite: 0.5 };
    const mockAffs = {};
    artists.forEach(a => mockAffs[a.id] = { familiarity: 0.1 });
    return computePathway(src, tgt, mockProfile, mockAffs, 'CURIOUS').path;
  });

  const directOPE = evaluateOPE((src, tgt) => [src, tgt]);

  const randomOPE = evaluateOPE((src, tgt) => {
    const dummyRand = artists[(src.charCodeAt(0) + tgt.charCodeAt(0)) % artists.length].id;
    return [src, dummyRand, tgt];
  });

  // Calculate averages
  const asnsDelta = Math.abs(cleanAdoptionCount - noisyAdoptionCount) / BENCHMARK_TRIALS * 100.0;

  console.log('\n================ UN-GAMEABLE BENCHMARK RESULTS ================');

  console.log(`\nLayer 8 Pathway (Sequencing Engine):`);
  console.log(`  - Completion Rate:         ${(metrics.l8.completed / BENCHMARK_TRIALS * 100).toFixed(2)}%`);
  console.log(`  - Genre Boundary Crossings: ${(metrics.l8.sbc / (metrics.l8.sbcTotal || 1)).toFixed(2)} genre steps`);
  console.log(`  - Skip Budget Engagement:  ${(metrics.l8.sbet / BENCHMARK_TRIALS).toFixed(1)} seconds`);
  console.log(`  - Durable Organic Retention: ${(metrics.l8.dorr / (metrics.l8.completed || 1) * 100).toFixed(2)}%`);
  console.log(`  - Off-Policy IPS Estimator: ${(l8OPE * 100).toFixed(2)}% expected reward`);

  console.log(`\nDirect Recommendation Baseline:`);
  console.log(`  - Completion Rate:         ${(metrics.direct.completed / BENCHMARK_TRIALS * 100).toFixed(2)}%`);
  console.log(`  - Genre Boundary Crossings: ${(metrics.direct.sbc / (metrics.direct.sbcTotal || 1)).toFixed(2)} genre steps`);
  console.log(`  - Skip Budget Engagement:  ${(metrics.direct.sbet / BENCHMARK_TRIALS).toFixed(1)} seconds`);
  console.log(`  - Durable Organic Retention: ${(metrics.direct.dorr / (metrics.direct.completed || 1) * 100).toFixed(2)}%`);
  console.log(`  - Off-Policy IPS Estimator: ${(directOPE * 100).toFixed(2)}% expected reward`);

  console.log(`\nRandom Intermediate Pathway Baseline:`);
  console.log(`  - Completion Rate:         ${(metrics.random.completed / BENCHMARK_TRIALS * 100).toFixed(2)}%`);
  console.log(`  - Genre Boundary Crossings: ${(metrics.random.sbc / (metrics.random.sbcTotal || 1)).toFixed(2)} genre steps`);
  console.log(`  - Skip Budget Engagement:  ${(metrics.random.sbet / BENCHMARK_TRIALS).toFixed(1)} seconds`);
  console.log(`  - Durable Organic Retention: ${(metrics.random.dorr / (metrics.random.completed || 1) * 100).toFixed(2)}%`);
  console.log(`  - Off-Policy IPS Estimator: ${(randomOPE * 100).toFixed(2)}% expected reward`);

  console.log(`\n--- ADVANCED PEER-REVIEW METRICS ---`);
  console.log(`Adversarial State Noise Sensitivity (ASNS Delta): ${asnsDelta.toFixed(2)}% (Target: < 15%)`);
  
  if (asnsDelta < 15.0) {
    console.log(`  ASNS Status: PASS (Robust Adaptation. Model degrades gracefully under noise.)`);
  } else {
    console.warn(`  ASNS Status: FAIL (High sensitivity to state inputs. Likely exploiting flat simulator thresholds.)`);
  }

  const dorrLift = ((metrics.l8.dorr / (metrics.l8.completed || 1)) - (metrics.direct.dorr / (metrics.direct.completed || 1))) * 100.0;
  console.log(`Organic Taste Retention Lift (L8 vs Direct): ${dorrLift.toFixed(2)}%`);

  console.log('\n=== ORCA UN-GAMEABLE PEER-REVIEW BENCHMARK COMPLETE ===');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
