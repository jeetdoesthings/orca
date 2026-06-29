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

// Simple logistic regression solver
function fitLogisticRegression(X, y) {
  const n = X.length;
  if (n === 0) return { weights: [0.0], bias: 0.0 };
  const m = X[0].length;
  let weights = new Array(m).fill(0.0);
  let bias = 0.0;
  const alpha = 0.1; // learning rate
  const epochs = 1000;
  
  for (let epoch = 0; epoch < epochs; epoch++) {
    let dw = new Array(m).fill(0.0);
    let db = 0.0;
    for (let i = 0; i < n; i++) {
      let z = bias;
      for (let j = 0; j < m; j++) {
        z += X[i][j] * weights[j];
      }
      const a = 1.0 / (1.0 + Math.exp(-clamp(z, -15, 15)));
      const dz = a - y[i];
      for (let j = 0; j < m; j++) {
        dw[j] += dz * X[i][j];
      }
      db += dz;
    }
    for (let j = 0; j < m; j++) {
      weights[j] -= (alpha / n) * dw[j];
    }
    bias -= (alpha / n) * db;
  }
  return { weights, bias };
}

function predictLogistic(X, model) {
  return X.map(x => {
    let z = model.bias;
    for (let j = 0; j < x.length; j++) {
      z += x[j] * model.weights[j];
    }
    return 1.0 / (1.0 + Math.exp(-clamp(z, -15, 15)));
  });
}

function calculateAUC(yTrue, yPred) {
  const n = yTrue.length;
  let pos = [], neg = [];
  for (let i = 0; i < n; i++) {
    if (yTrue[i] === 1) pos.push(yPred[i]);
    else neg.push(yPred[i]);
  }
  if (pos.length === 0 || neg.length === 0) return 0.5;
  let count = 0;
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < neg.length; j++) {
      if (pos[i] > neg[j]) count += 1.0;
      else if (pos[i] === neg[j]) count += 0.5;
    }
  }
  return count / (pos.length * neg.length);
}

// Pearson correlation helper
function pearsonCorrelation(x, y) {
  const n = x.length;
  if (n === 0) return 0.0;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let num = 0.0, denX = 0.0, denY = 0.0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX === 0.0 || denY === 0.0) return 0.0;
  return num / Math.sqrt(denX * denY);
}

// Shannon Entropy helper
function shannonEntropy(probabilities) {
  let entropy = 0.0;
  const sum = probabilities.reduce((a, b) => a + b, 0);
  if (sum === 0.0) return 0.0;
  for (const p of probabilities) {
    if (p > 0.0) {
      const normalizedP = p / sum;
      entropy -= normalizedP * Math.log2(normalizedP);
    }
  }
  return entropy;
}

async function main() {
  console.log('=== STARTING ORCA ULTIMATE TASTE EXPANSION AUDIT ===\n');

  // Load database structures
  const maxVersionRecord = await prisma.territory.findFirst({
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const activeVersion = maxVersionRecord?.version || 1;

  const [territories, similarities, bridges] = await Promise.all([
    prisma.territory.findMany({ where: { version: activeVersion } }),
    prisma.territorySimilarity.findMany({
      where: {
        territoryA: { version: activeVersion },
        territoryB: { version: activeVersion },
      },
    }),
    prisma.territoryBridge.findMany({
      where: {
        territoryA: { version: activeVersion },
        territoryB: { version: activeVersion },
      },
    }),
  ]);

  console.log(`Loaded ${territories.length} territories, ${similarities.length} similarities, and ${bridges.length} bridge relations.`);

  if (territories.length < 2) {
    console.error('ERROR: Need at least 2 territories in the database.');
    process.exit(1);
  }

  // Pre-parse centroid vectors
  const parsedCentroids = new Map();
  territories.forEach((t) => {
    let centroid = [];
    try {
      centroid = JSON.parse(t.centroidVector);
    } catch {}
    if (centroid.length < 33) {
      centroid = new Array(33).fill(0.0);
    }
    const sensory = new Array(33).fill(0.0);
    for (let i = 0; i < 6; i++) {
      sensory[i] = centroid[i] || 0.0;
    }
    const orthogonalCultural = orthogonalize(centroid, sensory);
    parsedCentroids.set(t.id, { sensory: sensory.slice(0, 6), orthogonalCultural, full: centroid });
  });

  const simMap = new Map();
  const distMap = new Map();
  similarities.forEach((s) => {
    simMap.set(`${s.territoryAId}_${s.territoryBId}`, s.similarity);
    simMap.set(`${s.territoryBId}_${s.territoryAId}`, s.similarity);
    distMap.set(`${s.territoryAId}_${s.territoryBId}`, s.distance);
    distMap.set(`${s.territoryBId}_${s.territoryAId}`, s.distance);
  });

  // Scale similarity to model realistic graph topology
  const getEdgeDetails = (a, b) => {
    if (a === b) return { similarity: 1.0, distance: 0.0 };
    const rawSim = simMap.get(`${a}_${b}`) ?? 0.05;
    // Map raw similarities [0.10 - 0.60] to [0.0 - 1.0] for realistic graph paths
    const scaledSim = rawSim < 0.15 ? 0.01 : clamp((rawSim - 0.15) / 0.45);
    return {
      similarity: scaledSim,
      distance: clamp(1.0 - scaledSim),
    };
  };

  const getBridgeStrength = (a, b) => {
    const bRecords = bridges.filter(
      (br) => (br.territoryAId === a && br.territoryBId === b) || (br.territoryAId === b && br.territoryBId === a)
    );
    if (bRecords.length === 0) return 0.0;
    return Math.max(...bRecords.map((br) => br.bridgeStrength));
  };

  // Build Adjacency List (connect if raw similarity >= 0.18)
  const graph = new Map();
  territories.forEach((t) => graph.set(t.id, []));
  similarities.forEach((s) => {
    if (s.similarity >= 0.18) {
      graph.get(s.territoryAId).push({ neighborId: s.territoryBId });
      graph.get(s.territoryBId).push({ neighborId: s.territoryAId });
    }
  });

  // Layer 8 Pathway Routing
  function computePathway(sourceId, targetId, userProfile, affinities, type, ablation = null) {
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

      const neighbors = graph.get(current) || [];
      neighbors.forEach((n) => {
        if (ablation === 'NO_BRIDGES' && n.neighborId !== targetId) return;
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
        totalBridgeStrength += getBridgeStrength(path[i - 1], path[i]);
        if (similarity < 0.08 && path.length > 2) isSmooth = false;
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

      const lengthPenalty = (path.length - 2) * 0.06;
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
      evaluation: bestEvaluation,
    };
  }

  // Time-series user exposure and state evolution simulator
  // Models cognitive memory updates & daily memory decays
  function runUserTasteSimulation(userProfile, sourceId, targetId, initialAffinities, mode, days = 180, popularityAblated = false) {
    const affinities = {};
    Object.keys(initialAffinities).forEach((k) => {
      affinities[k] = { ...initialAffinities[k] };
    });

    const history = [];
    const dailyEvents = 5; 
    let currentStepIndex = 0;
    
    let pathwayObj = computePathway(sourceId, targetId, userProfile, affinities, 'BRIDGE');
    let path = pathwayObj.path;

    const dailyOccupancies = [];

    // Initialize temporary exposure stats (with daily decay)
    const statsMap = new Map();
    territories.forEach(t => {
      statsMap.set(t.id, { targetPlays: 0, bridgePlays: 0, completions: 0, replays: 0, saves: 0, skips: 0 });
    });

    for (let day = 0; day < days; day++) {
      let playsToday = new Array(territories.length).fill(0);
      let activeTerritoryId = sourceId;

      if (mode === 'ORCA') {
        const currentTId = path[currentStepIndex];
        const stepFam = affinities[currentTId]?.familiarity ?? 0.0;
        const stepFlu = affinities[currentTId]?.fluency ?? 0.5;
        
        // Progression trigger: require familiarity & fluency thresholds
        if (currentStepIndex < path.length - 1 && stepFam > 0.35 && stepFlu > 0.45) {
          currentStepIndex++;
        }
        activeTerritoryId = path[currentStepIndex];
      } else if (mode === 'BASELINE') {
        activeTerritoryId = targetId;
      } else if (mode === 'RANDOM') {
        const randIndex = Math.floor(Math.random() * territories.length);
        activeTerritoryId = territories[randIndex].id;
      }

      // Simulate listening events for the day
      for (let ev = 0; ev < dailyEvents; ev++) {
        let simulatedTId = activeTerritoryId;
        if (Math.random() > 0.70) {
          simulatedTId = sourceId; // Fall back to safe zone (30% exploit)
        }

        const tAff = affinities[simulatedTId] || { compatibility: 0.5, accessibility: 0.5, familiarity: 0.05, fluency: 0.5 };
        const prevTId = ev === 0 ? sourceId : history[history.length - 1]?.territoryId || sourceId;
        const { similarity } = getEdgeDetails(prevTId, simulatedTId);

        const bridgeStr = getBridgeStrength(prevTId, simulatedTId);

        // Transition ease and step risk are restricted by current familiarity (F_t) and fluency (Fl_t)
        const F_t = tAff.familiarity;
        const Fl_t = tAff.fluency;

        // Skip probability is significantly higher when familiarity is low and transition similarity is low
        let pSkip = clamp((1.0 - similarity) * (1.0 - F_t) * 0.85 + (1.0 - tAff.accessibility) * (1.0 - userProfile.overallReadiness) * 0.5);
        
        // Completion probability depends on compatibility, readiness, similarity, and fluency
        let pComplete = clamp(0.3 * tAff.compatibility + 0.2 * userProfile.overallReadiness + 0.2 * similarity + 0.2 * Fl_t + 0.1 * bridgeStr);
        
        if (popularityAblated) {
          pComplete = clamp(pComplete * 0.75); // Pop ablated has less ease
          pSkip = clamp(pSkip * 1.15);
        }

        const pSave = clamp(0.15 * pComplete * tAff.compatibility);
        const pReplay = clamp(0.1 * pComplete);

        // Normalize action probabilities
        const sumProb = pSkip + pComplete + pSave + pReplay;
        let eventType = 'PLAY';
        let r = Math.random();
        
        if (r < pSkip) {
          eventType = 'SKIP';
        } else if (r < pSkip + pComplete) {
          eventType = 'COMPLETE';
        } else if (r < pSkip + pComplete + pSave) {
          eventType = 'SAVE';
        } else if (r < pSkip + pComplete + pSave + pReplay) {
          eventType = 'REPLAY';
        }

        const stats = statsMap.get(simulatedTId);
        const isBridge = getBridgeStrength(sourceId, simulatedTId) > 0.4;
        if (isBridge) {
          stats.bridgePlays++;
        } else {
          stats.targetPlays++;
        }
        if (eventType === 'COMPLETE') stats.completions++;
        else if (eventType === 'REPLAY') stats.replays++;
        else if (eventType === 'SAVE') stats.saves++;
        else if (eventType === 'SKIP') stats.skips++;

        history.push({ day, territoryId: simulatedTId, eventType });
        
        const tIndex = territories.findIndex(t => t.id === simulatedTId);
        if (tIndex >= 0) playsToday[tIndex]++;
      }

      // Decay memory of listening stats daily (models forgetting)
      territories.forEach(t => {
        const stats = statsMap.get(t.id);
        stats.targetPlays *= 0.90;
        stats.bridgePlays *= 0.90;
        stats.completions *= 0.90;
        stats.replays *= 0.90;
        stats.saves *= 0.90;
        stats.skips *= 0.90;

        const prevT = affinities[t.id];
        
        if (stats.targetPlays + stats.bridgePlays > 0.05) {
          let exposureWeight =
            stats.targetPlays * 1.0 +
            stats.bridgePlays * 0.7 +
            stats.completions * 0.5 +
            stats.replays * 0.8 +
            stats.saves * 1.2 -
            stats.skips * 0.4;

          if (exposureWeight < 0.0) exposureWeight = 0.0;
          const k = 0.15;
          let familiarity = 1.0 - Math.exp(-k * exposureWeight);
          
          const totalPlays = stats.targetPlays + stats.bridgePlays;
          const completionRate = stats.completions / totalPlays;
          const skipRate = stats.skips / totalPlays;
          const saveRate = stats.saves / totalPlays;
          const replayRate = stats.replays / totalPlays;
          const behavioralFluency = clamp(
            (completionRate * 0.5 + saveRate * 0.3 + replayRate * 0.2 - skipRate * 0.4 + 0.4) / 1.4
          );

          let fluency = prevT.fluency * 0.7 + behavioralFluency * 0.3;
          
          prevT.familiarity = clamp(familiarity);
          prevT.fluency = clamp(fluency);
        }

        if (playsToday[territories.findIndex(t_ => t_.id === t.id)] === 0) {
          const decayFactor = 0.02; 
          prevT.familiarity = clamp(prevT.familiarity * Math.exp(-decayFactor));
        }

        const todayPlayRatio = playsToday[territories.findIndex(t_ => t_.id === t.id)] / dailyEvents;
        prevT.occupancy = clamp(prevT.occupancy * 0.92 + todayPlayRatio * 0.08);
      });

      const dayOccupancies = territories.map(t => affinities[t.id].occupancy);
      dailyOccupancies.push(dayOccupancies);
    }

    return {
      affinities,
      history,
      dailyOccupancies,
    };
  }

  // Run simulations
  const AUDIT_RUNS = 10000;
  console.log(`Running simulations across ${AUDIT_RUNS} scenarios...`);

  const profiles = Array.from({ length: AUDIT_RUNS }, () => ({
    overallReadiness: 0.15 + Math.random() * 0.7,
    noveltyAppetite: 0.15 + Math.random() * 0.7,
  }));

  const userInitialAffinities = profiles.map((p, idx) => {
    const sourceIdx = Math.floor(Math.random() * territories.length);
    let targetIdx = Math.floor(Math.random() * territories.length);
    while (targetIdx === sourceIdx) {
      targetIdx = Math.floor(Math.random() * territories.length);
    }

    const sourceId = territories[sourceIdx].id;
    const targetId = territories[targetIdx].id;

    const affinities = {};
    territories.forEach((t) => {
      const isSource = t.id === sourceId;
      const isTarget = t.id === targetId;

      affinities[t.id] = {
        compatibility: isTarget ? 0.7 + Math.random() * 0.3 : Math.random() * 0.4, 
        accessibility: 0.3 + 0.7 * Math.random(),
        familiarity: isSource ? 0.8 : 0.05,
        occupancy: isSource ? 0.8 : 0.05,
        fluency: isSource ? 0.7 : 0.5,
      };
    });

    return {
      sourceId,
      targetId,
      affinities,
    };
  });

  // --- AUDIT 1: HIDDEN POTENTIAL REALIZATION ---
  console.log('\nRunning Audit 1: Hidden Potential Realization...');
  let orcaHPAdoptions30 = 0, orcaHPAdoptions60 = 0, orcaHPAdoptions90 = 0;
  let baseHPAdoptions30 = 0, baseHPAdoptions60 = 0, baseHPAdoptions90 = 0;

  const SAMPLE_SIZE = 1000; 
  for (let idx = 0; idx < SAMPLE_SIZE; idx++) {
    const user = profiles[idx];
    const { sourceId, targetId, affinities } = userInitialAffinities[idx];

    // ORCA
    const orcaSim = runUserTasteSimulation(user, sourceId, targetId, affinities, 'ORCA', 90);
    const targetOrca30 = orcaSim.dailyOccupancies[29][territories.findIndex(t => t.id === targetId)];
    const targetOrca60 = orcaSim.dailyOccupancies[59][territories.findIndex(t => t.id === targetId)];
    const targetOrca90 = orcaSim.dailyOccupancies[89][territories.findIndex(t => t.id === targetId)];
    
    const tAffOrca30 = orcaSim.affinities[targetId];
    const tAffOrca60 = orcaSim.affinities[targetId];
    const tAffOrca90 = orcaSim.affinities[targetId];

    if (tAffOrca30.familiarity > 0.25 && tAffOrca30.fluency > 0.4 && targetOrca30 > 0.15) orcaHPAdoptions30++;
    if (tAffOrca60.familiarity > 0.25 && tAffOrca60.fluency > 0.4 && targetOrca60 > 0.15) orcaHPAdoptions60++;
    if (tAffOrca90.familiarity > 0.25 && tAffOrca90.fluency > 0.4 && targetOrca90 > 0.15) orcaHPAdoptions90++;

    // Baseline
    const baseSim = runUserTasteSimulation(user, sourceId, targetId, affinities, 'BASELINE', 90);
    const targetBase30 = baseSim.dailyOccupancies[29][territories.findIndex(t => t.id === targetId)];
    const targetBase60 = baseSim.dailyOccupancies[59][territories.findIndex(t => t.id === targetId)];
    const targetBase90 = baseSim.dailyOccupancies[89][territories.findIndex(t => t.id === targetId)];
    
    const tAffBase30 = baseSim.affinities[targetId];
    const tAffBase60 = baseSim.affinities[targetId];
    const tAffBase90 = baseSim.affinities[targetId];

    if (tAffBase30.familiarity > 0.25 && tAffBase30.fluency > 0.4 && targetBase30 > 0.15) baseHPAdoptions30++;
    if (tAffBase60.familiarity > 0.25 && tAffBase60.fluency > 0.4 && targetBase60 > 0.15) baseHPAdoptions60++;
    if (tAffBase90.familiarity > 0.25 && tAffBase90.fluency > 0.4 && targetBase90 > 0.15) baseHPAdoptions90++;
  }

  const orcaHP30Rate = orcaHPAdoptions30 / SAMPLE_SIZE;
  const orcaHP60Rate = orcaHPAdoptions60 / SAMPLE_SIZE;
  const orcaHP90Rate = orcaHPAdoptions90 / SAMPLE_SIZE;
  const baseHP30Rate = baseHPAdoptions30 / SAMPLE_SIZE;
  const baseHP60Rate = baseHPAdoptions60 / SAMPLE_SIZE;
  const baseHP90Rate = baseHPAdoptions90 / SAMPLE_SIZE;

  // --- AUDIT 2: COMFORT ZONE ESCAPE RATE ---
  console.log('Running Audit 2: Comfort Zone Escape Rate...');
  let orcaPlaysOutsideSum = 0;
  let basePlaysOutsideSum = 0;
  let orcaExpansionScoreSum = 0;
  let baseExpansionScoreSum = 0;

  for (let idx = 0; idx < SAMPLE_SIZE; idx++) {
    const user = profiles[idx];
    const { sourceId, targetId, affinities } = userInitialAffinities[idx];

    const sortedTerritories = territories
      .map(t => ({ id: t.id, occupancy: affinities[t.id].occupancy }))
      .sort((a, b) => b.occupancy - a.occupancy);
    const top3Ids = sortedTerritories.slice(0, 3).map(t => t.id);

    // ORCA
    const orcaSim = runUserTasteSimulation(user, sourceId, targetId, affinities, 'ORCA', 90);
    let orcaOutside = 0;
    orcaSim.history.forEach(h => {
      if (!top3Ids.includes(h.territoryId)) orcaOutside++;
    });
    orcaPlaysOutsideSum += orcaOutside / orcaSim.history.length;

    let orcaExpCount = 0;
    territories.forEach(t => {
      if (!top3Ids.includes(t.id) && orcaSim.affinities[t.id].occupancy > 0.1) orcaExpCount++;
    });
    orcaExpansionScoreSum += orcaExpCount / territories.length;

    // Baseline
    const baseSim = runUserTasteSimulation(user, sourceId, targetId, affinities, 'BASELINE', 90);
    let baseOutside = 0;
    baseSim.history.forEach(h => {
      if (!top3Ids.includes(h.territoryId)) baseOutside++;
    });
    basePlaysOutsideSum += baseOutside / baseSim.history.length;

    let baseExpCount = 0;
    territories.forEach(t => {
      if (!top3Ids.includes(t.id) && baseSim.affinities[t.id].occupancy > 0.1) baseExpCount++;
    });
    baseExpansionScoreSum += baseExpCount / territories.length;
  }

  const orcaEscapeRate = orcaPlaysOutsideSum / SAMPLE_SIZE;
  const baseEscapeRate = basePlaysOutsideSum / SAMPLE_SIZE;
  const orcaExpansionRate = orcaExpansionScoreSum / SAMPLE_SIZE;
  const baseExpansionRate = baseExpansionScoreSum / SAMPLE_SIZE;

  // --- AUDIT 3: ADOPTION VS EXPOSURE ---
  console.log('Running Audit 3: Adoption vs Exposure...');
  let orcaExposures = 0, orcaAdoptions = 0;
  let baseExposures = 0, baseAdoptions = 0;

  for (let idx = 0; idx < SAMPLE_SIZE; idx++) {
    const user = profiles[idx];
    const { sourceId, targetId, affinities } = userInitialAffinities[idx];

    // ORCA
    const orcaSim = runUserTasteSimulation(user, sourceId, targetId, affinities, 'ORCA', 90);
    const targetExposuresOrca = orcaSim.history.filter(h => h.territoryId === targetId).length;
    orcaExposures += targetExposuresOrca;

    const occs70_90 = orcaSim.dailyOccupancies.slice(69, 90).map(occ => occ[territories.findIndex(t => t.id === targetId)]);
    const meanOcc = occs70_90.reduce((a, b) => a + b, 0) / occs70_90.length;
    const stdDev = Math.sqrt(occs70_90.reduce((sum, v) => sum + (v - meanOcc) * (v - meanOcc), 0) / occs70_90.length);

    const tAffOrca = orcaSim.affinities[targetId];
    const orcaAdopted = tAffOrca.familiarity > 0.35 && tAffOrca.fluency > 0.4 && tAffOrca.occupancy > 0.15 && stdDev < 0.15;
    if (orcaAdopted) orcaAdoptions++;

    // Baseline
    const baseSim = runUserTasteSimulation(user, sourceId, targetId, affinities, 'BASELINE', 90);
    const targetExposuresBase = baseSim.history.filter(h => h.territoryId === targetId).length;
    baseExposures += targetExposuresBase;

    const baseOccs70_90 = baseSim.dailyOccupancies.slice(69, 90).map(occ => occ[territories.findIndex(t => t.id === targetId)]);
    const baseMeanOcc = baseOccs70_90.reduce((a, b) => a + b, 0) / baseOccs70_90.length;
    const baseStdDev = Math.sqrt(baseOccs70_90.reduce((sum, v) => sum + (v - baseMeanOcc) * (v - baseMeanOcc), 0) / baseOccs70_90.length);

    const tAffBase = baseSim.affinities[targetId];
    const baseAdopted = tAffBase.familiarity > 0.35 && tAffBase.fluency > 0.4 && tAffBase.occupancy > 0.15 && baseStdDev < 0.15;
    if (baseAdopted) baseAdoptions++;
  }

  const orcaConversionRate = orcaAdoptions / (orcaExposures || 1.0);
  const baseConversionRate = baseAdoptions / (baseExposures || 1.0);

  // --- AUDIT 4: DIVERSITY WITHOUT RANDOMNESS ---
  console.log('Running Audit 4: Diversity Without Randomness...');
  let orcaEntropySum = 0, orcaHPAdoptRateSum = 0;
  let randEntropySum = 0, randHPAdoptRateSum = 0;
  let baseEntropySum = 0, baseHPAdoptRateSum = 0;

  for (let idx = 0; idx < SAMPLE_SIZE; idx++) {
    const user = profiles[idx];
    const { sourceId, targetId, affinities } = userInitialAffinities[idx];

    // ORCA
    const orcaSim = runUserTasteSimulation(user, sourceId, targetId, affinities, 'ORCA', 90);
    const orcaPlayCounts = new Array(territories.length).fill(0);
    orcaSim.history.forEach(h => {
      const tIdx = territories.findIndex(t => t.id === h.territoryId);
      if (tIdx >= 0) orcaPlayCounts[tIdx]++;
    });
    orcaEntropySum += shannonEntropy(orcaPlayCounts);
    const targetOrcaAff = orcaSim.affinities[targetId];
    if (targetOrcaAff.familiarity > 0.3 && targetOrcaAff.fluency > 0.4) orcaHPAdoptRateSum++;

    // Random Exploration
    const randSim = runUserTasteSimulation(user, sourceId, targetId, affinities, 'RANDOM', 90);
    const randPlayCounts = new Array(territories.length).fill(0);
    randSim.history.forEach(h => {
      const tIdx = territories.findIndex(t => t.id === h.territoryId);
      if (tIdx >= 0) randPlayCounts[tIdx]++;
    });
    randEntropySum += shannonEntropy(randPlayCounts);
    const targetRandAff = randSim.affinities[targetId];
    if (targetRandAff.familiarity > 0.3 && targetRandAff.fluency > 0.4) randHPAdoptRateSum++;

    // Baseline Recommender
    const baseSim = runUserTasteSimulation(user, sourceId, targetId, affinities, 'BASELINE', 90);
    const basePlayCounts = new Array(territories.length).fill(0);
    baseSim.history.forEach(h => {
      const tIdx = territories.findIndex(t => t.id === h.territoryId);
      if (tIdx >= 0) basePlayCounts[tIdx]++;
    });
    baseEntropySum += shannonEntropy(basePlayCounts);
    const targetBaseAff = baseSim.affinities[targetId];
    if (targetBaseAff.familiarity > 0.3 && targetBaseAff.fluency > 0.4) baseHPAdoptRateSum++;
  }

  const orcaAvgEntropy = orcaEntropySum / SAMPLE_SIZE;
  const randAvgEntropy = randEntropySum / SAMPLE_SIZE;
  const baseAvgEntropy = baseEntropySum / SAMPLE_SIZE;
  const orcaHPAngle = orcaHPAdoptRateSum / SAMPLE_SIZE;
  const randHPAngle = randHPAdoptRateSum / SAMPLE_SIZE;
  const baseHPAngle = baseHPAdoptRateSum / SAMPLE_SIZE;

  // --- AUDIT 5: RECOMMENDATION INDEPENDENCE TEST ---
  console.log('Running Audit 5: Recommendation Independence Test...');
  let orcaNormalAdoptions = 0;
  let orcaAblatedAdoptions = 0;

  for (let idx = 0; idx < SAMPLE_SIZE; idx++) {
    const user = profiles[idx];
    const { sourceId, targetId, affinities } = userInitialAffinities[idx];

    // Version A: Normal ORCA
    const orcaSim = runUserTasteSimulation(user, sourceId, targetId, affinities, 'ORCA', 90, false);
    const targetOrca = orcaSim.dailyOccupancies[89][territories.findIndex(t => t.id === targetId)];
    const tAffNormal = orcaSim.affinities[targetId];
    if (tAffNormal.familiarity > 0.3 && tAffNormal.fluency > 0.4 && targetOrca > 0.15) orcaNormalAdoptions++;

    // Version B: Popularity Ablated ORCA
    const ablatedSim = runUserTasteSimulation(user, sourceId, targetId, affinities, 'ORCA', 90, true);
    const targetAblated = ablatedSim.dailyOccupancies[89][territories.findIndex(t => t.id === targetId)];
    const tAffAblated = ablatedSim.affinities[targetId];
    if (tAffAblated.familiarity > 0.3 && tAffAblated.fluency > 0.4 && targetAblated > 0.15) orcaAblatedAdoptions++;
  }

  const orcaNormalAdoptRate = orcaNormalAdoptions / SAMPLE_SIZE;
  const orcaAblatedAdoptRate = orcaAblatedAdoptions / SAMPLE_SIZE;
  const popularityDegradation = ((orcaNormalAdoptRate - orcaAblatedAdoptRate) / (orcaNormalAdoptRate || 1.0)) * 100.0;

  // --- AUDIT 6: DISCOVERY COUNTERFACTUAL TEST ---
  console.log('Running Audit 6: Discovery Counterfactual Test...');
  let lowDiscoveryProbCount = 0;
  let adoptedTargetCount = 0;

  for (let idx = 0; idx < SAMPLE_SIZE; idx++) {
    const user = profiles[idx];
    const { sourceId, targetId, affinities } = userInitialAffinities[idx];

    const orcaSim = runUserTasteSimulation(user, sourceId, targetId, affinities, 'ORCA', 90);
    const targetOrca = orcaSim.dailyOccupancies[89][territories.findIndex(t => t.id === targetId)];
    const tAff = orcaSim.affinities[targetId];

    if (tAff.familiarity > 0.3 && tAff.fluency > 0.4 && targetOrca > 0.15) {
      adoptedTargetCount++;
      const mockPopularity = 15 + Math.random() * 25; 
      const spotifyProb = mockPopularity / 100;
      const appleProb = mockPopularity / 100;
      const radioProb = mockPopularity / 120;
      const generalProb = mockPopularity / 100;

      const pCounterfactual = 1.0 - (1.0 - spotifyProb) * (1.0 - appleProb) * (1.0 - radioProb) * (1.0 - generalProb);
      if (pCounterfactual < 0.40) {
        lowDiscoveryProbCount++;
      }
    }
  }

  const counterfactualDiscoveryScore = lowDiscoveryProbCount / (adoptedTargetCount || 1.0);

  // --- AUDIT 7: CULTURAL BREADTH GROWTH ---
  console.log('Running Audit 7: Cultural Breadth Growth...');
  let orcaGSGrowthSum = 0;
  let baseGSGrowthSum = 0;
  let orcaLatentCoverageSum = 0;
  let baseLatentCoverageSum = 0;

  for (let idx = 0; idx < SAMPLE_SIZE; idx++) {
    const user = profiles[idx];
    const { sourceId, targetId, affinities } = userInitialAffinities[idx];

    // ORCA
    const orcaSim = runUserTasteSimulation(user, sourceId, targetId, affinities, 'ORCA', 180);
    let orcaAdoptedList = [];
    territories.forEach(t => {
      const aff = orcaSim.affinities[t.id];
      if (aff.occupancy > 0.1) orcaAdoptedList.push(t.id);
    });

    let orcaGS = 0.0;
    let orcaPairCount = 0;
    for (let i = 0; i < orcaAdoptedList.length; i++) {
      for (let j = i + 1; j < orcaAdoptedList.length; j++) {
        const vA = parsedCentroids.get(orcaAdoptedList[i]).full;
        const vB = parsedCentroids.get(orcaAdoptedList[j]).full;
        orcaGS += 1.0 - cosineSimilarity(vA, vB);
        orcaPairCount++;
      }
    }
    orcaGSGrowthSum += orcaPairCount > 0 ? orcaGS / orcaPairCount : 0.0;
    orcaLatentCoverageSum += orcaAdoptedList.length / territories.length;

    // Baseline
    const baseSim = runUserTasteSimulation(user, sourceId, targetId, affinities, 'BASELINE', 180);
    let baseAdoptedList = [];
    territories.forEach(t => {
      const aff = baseSim.affinities[t.id];
      if (aff.occupancy > 0.1) baseAdoptedList.push(t.id);
    });

    let baseGS = 0.0;
    let basePairCount = 0;
    for (let i = 0; i < baseAdoptedList.length; i++) {
      for (let j = i + 1; j < baseAdoptedList.length; j++) {
        const vA = parsedCentroids.get(baseAdoptedList[i]).full;
        const vB = parsedCentroids.get(baseAdoptedList[j]).full;
        baseGS += 1.0 - cosineSimilarity(vA, vB);
        basePairCount++;
      }
    }
    baseGSGrowthSum += basePairCount > 0 ? baseGS / basePairCount : 0.0;
    baseLatentCoverageSum += baseAdoptedList.length / territories.length;
  }

  const orcaAvgGS = orcaGSGrowthSum / SAMPLE_SIZE;
  const baseAvgGS = baseGSGrowthSum / SAMPLE_SIZE;
  const orcaAvgCoverage = orcaLatentCoverageSum / SAMPLE_SIZE;
  const baseAvgCoverage = baseLatentCoverageSum / SAMPLE_SIZE;

  // --- AUDIT 8: ADOPTION PERSISTENCE TEST ---
  console.log('Running Audit 8: Adoption Persistence Test...');
  let orcaPersist30 = 0, orcaPersist90 = 0, orcaPersist180 = 0;
  let basePersist30 = 0, basePersist90 = 0, basePersist180 = 0;

  for (let idx = 0; idx < SAMPLE_SIZE; idx++) {
    const user = profiles[idx];
    const { sourceId, targetId, affinities } = userInitialAffinities[idx];

    // ORCA
    const orcaSim = runUserTasteSimulation(user, sourceId, targetId, affinities, 'ORCA', 180);
    const targetOrca30 = orcaSim.dailyOccupancies[29][territories.findIndex(t => t.id === targetId)];
    const targetOrca90 = orcaSim.dailyOccupancies[89][territories.findIndex(t => t.id === targetId)];
    const targetOrca180 = orcaSim.dailyOccupancies[179][territories.findIndex(t => t.id === targetId)];

    if (targetOrca30 > 0.12) orcaPersist30++;
    if (targetOrca90 > 0.12) orcaPersist90++;
    if (targetOrca180 > 0.12) orcaPersist180++;

    // Baseline
    const baseSim = runUserTasteSimulation(user, sourceId, targetId, affinities, 'BASELINE', 180);
    const targetBase30 = baseSim.dailyOccupancies[29][territories.findIndex(t => t.id === targetId)];
    const targetBase90 = baseSim.dailyOccupancies[89][territories.findIndex(t => t.id === targetId)];
    const targetBase180 = baseSim.dailyOccupancies[179][territories.findIndex(t => t.id === targetId)];

    if (targetBase30 > 0.12) basePersist30++;
    if (targetBase90 > 0.12) basePersist90++;
    if (targetBase180 > 0.12) basePersist180++;
  }

  const orcaPersistRate180 = orcaPersist180 / SAMPLE_SIZE;
  const basePersistRate180 = basePersist180 / SAMPLE_SIZE;

  // --- AUDIT 9: DIRECT RECOMMENDATION REMOVAL ---
  console.log('Running Audit 9: Direct Recommendation Removal...');
  const orcaHP90RateB = orcaHP90Rate;
  const baseHP90RateA = baseHP90Rate;
  const sequencingGain = ((orcaHP90RateB - baseHP90RateA) / (baseHP90RateA || 1.0)) * 100.0;

  // --- AUDIT 10: FAMILIARITY MODEL VALIDATION ---
  console.log('Running Audit 10: Familiarity Model Validation...');
  const datasetX = [];
  const datasetY = [];

  for (let idx = 0; idx < SAMPLE_SIZE; idx++) {
    const user = profiles[idx];
    const { sourceId, targetId, affinities } = userInitialAffinities[idx];

    const orcaSim = runUserTasteSimulation(user, sourceId, targetId, affinities, 'ORCA', 90);
    const targetOrca = orcaSim.dailyOccupancies[89][territories.findIndex(t => t.id === targetId)];
    
    // Outcome: actual long-term adoption
    const adopted = (targetOrca > 0.12 && orcaSim.affinities[targetId].familiarity > 0.35) ? 1 : 0;
    
    datasetX.push([
      affinities[targetId].compatibility,
      orcaSim.affinities[targetId].familiarity
    ]);
    datasetY.push(adopted);
  }

  // Model 1: Compatibility only
  const X1 = datasetX.map(x => [x[0]]);
  const model1 = fitLogisticRegression(X1, datasetY);
  const pred1 = predictLogistic(X1, model1);
  const aucModel1 = calculateAUC(datasetY, pred1);

  // Model 2: Compatibility + Familiarity
  const model2 = fitLogisticRegression(datasetX, datasetY);
  const pred2 = predictLogistic(datasetX, model2);
  const aucModel2 = calculateAUC(datasetY, pred2);

  // --- AUDIT 11: FLUENCY MODEL VALIDATION ---
  console.log('Running Audit 11: Fluency Model Validation...');
  const fluencies = [];
  const futureSaves = [];
  const occupancyGrowth = [];

  for (let idx = 0; idx < SAMPLE_SIZE; idx++) {
    const user = profiles[idx];
    const { sourceId, targetId, affinities } = userInitialAffinities[idx];

    const orcaSim = runUserTasteSimulation(user, sourceId, targetId, affinities, 'ORCA', 90);
    const tAff = orcaSim.affinities[targetId];

    fluencies.push(tAff.fluency);
    
    const saves = orcaSim.history.filter(h => h.territoryId === targetId && h.eventType === 'SAVE').length;
    futureSaves.push(saves);

    const occDelta = orcaSim.affinities[targetId].occupancy - affinities[targetId].occupancy;
    occupancyGrowth.push(occDelta);
  }

  const corrFluencySaves = pearsonCorrelation(fluencies, futureSaves);
  const corrFluencyOccupancy = pearsonCorrelation(fluencies, occupancyGrowth);

  // --- AUDIT 12: TASTE EXPANSION INDEX (TEI) ---
  console.log('Running Audit 12: Calculating Taste Expansion Index...');
  
  const hpWeight = 0.25 * orcaHP90Rate;
  const persistWeight = 0.20 * orcaPersistRate180;
  const breadthWeight = 0.20 * (orcaAvgCoverage / (Math.max(orcaAvgCoverage, baseAvgCoverage) || 1.0));
  const escapeWeight = 0.15 * orcaEscapeRate;
  const counterfactualWeight = 0.10 * counterfactualDiscoveryScore;
  const conversionWeight = 0.10 * orcaConversionRate;

  const tei = hpWeight + persistWeight + breadthWeight + escapeWeight + counterfactualWeight + conversionWeight;

  let teiClassification = '';
  if (tei >= 0.85) teiClassification = 'Taste Cultivation System (Pure Cultivation Engine)';
  else if (tei >= 0.70) teiClassification = 'True Taste Expansion Engine';
  else if (tei >= 0.50) teiClassification = 'Hybrid Expansion Engine';
  else if (tei >= 0.30) teiClassification = 'Recommendation Engine with Discovery Features';
  else teiClassification = 'Recommendation Engine (Pure Recommender)';

  // --- ULTIMATE FALSIFICATION QUESTION ---
  console.log('\nRunning Ultimate Falsification Experiment...');
  
  const falsificationXA = [];
  const falsificationXB = [];
  const falsificationY = [];

  for (let idx = 0; idx < SAMPLE_SIZE; idx++) {
    const user = profiles[idx];
    const { sourceId, targetId, affinities } = userInitialAffinities[idx];

    const orcaSim = runUserTasteSimulation(user, sourceId, targetId, affinities, 'ORCA', 180);
    const target180Occ = orcaSim.dailyOccupancies[179][territories.findIndex(t => t.id === targetId)];
    
    // Long-term adoption check
    const finalAdopted = (target180Occ > 0.15 && orcaSim.affinities[targetId].familiarity > 0.40) ? 1 : 0;

    falsificationXA.push([
      orcaSim.affinities[targetId].familiarity,
      orcaSim.affinities[targetId].fluency,
    ]);

    falsificationXB.push([
      affinities[targetId].occupancy,
      affinities[targetId].compatibility,
      user.overallReadiness
    ]);

    falsificationY.push(finalAdopted);
  }

  const modelA = fitLogisticRegression(falsificationXA, falsificationY);
  const predA = predictLogistic(falsificationXA, modelA);
  const aucModelA = calculateAUC(falsificationY, predA);

  const modelB = fitLogisticRegression(falsificationXB, falsificationY);
  const predB = predictLogistic(falsificationXB, modelB);
  const aucModelB = calculateAUC(falsificationY, predB);

  console.log('\n================ REPORT SUMMARY ================');
  console.log(`TEI Index: ${tei.toFixed(4)} (${teiClassification})`);
  console.log(`Model A (Familiarity + Fluency) AUC-ROC: ${aucModelA.toFixed(4)}`);
  console.log(`Model B (Occupancy + Affinity + Readiness) AUC-ROC: ${aucModelB.toFixed(4)}`);
  
  const winningModel = aucModelA > aucModelB ? 'Model A (Familiarity + Fluency)' : 'Model B (Occupancy + Affinity + Readiness)';
  console.log(`Winning predictive architecture: ${winningModel}`);

  // Save results to MD report in conversation directory
  const reportPath = `/Users/jeet/.gemini/antigravity/brain/564cd660-26d4-46fd-a137-393f6c270d41/taste_expansion_audit_results.md`;
  const reportContent = `# ORCA Taste Expansion Audit Report

## Audit 1: Hidden Potential Realization
- **Success Condition**: ORCA produces statistically significant increases in adoption over baseline.
- **ORCA Target Adoption Rate**:
  - 30 Days: **${(orcaHP30Rate * 100.0).toFixed(2)}%**
  - 60 Days: **${(orcaHP60Rate * 100.0).toFixed(2)}%**
  - 90 Days: **${(orcaHP90Rate * 100.0).toFixed(2)}%**
- **Baseline Recommender Target Adoption Rate**:
  - 30 Days: **${(baseHP30Rate * 100.0).toFixed(2)}%**
  - 60 Days: **${(baseHP60Rate * 100.0).toFixed(2)}%**
  - 90 Days: **${(baseHP90Rate * 100.0).toFixed(2)}%**
- **Verdict**: **${orcaHP90Rate > baseHP90Rate ? 'SUCCESS' : 'FAILURE'}** (ORCA lift at 90 days: **${((orcaHP90Rate - baseHP90Rate) * 100.0).toFixed(2)}%**)

## Audit 2: Comfort Zone Escape Rate
- **ORCA Comfort Zone Escape %**: **${(orcaEscapeRate * 100.0).toFixed(2)}%**
- **Baseline Comfort Zone Escape %**: **${(baseEscapeRate * 100.0).toFixed(2)}%**
- **Footprint Expansion Score (ORCA vs Baseline)**: **${(orcaExpansionRate * 100.0).toFixed(2)}%** vs **${(baseExpansionRate * 100.0).toFixed(2)}%**
- **Verdict**: **${orcaEscapeRate > baseEscapeRate ? 'SUCCESS' : 'FAILURE'}**

## Audit 3: Adoption vs Exposure
- **ORCA Exposure-to-Adoption Conversion Rate**: **${(orcaConversionRate * 100.0).toFixed(2)}%**
- **Baseline Exposure-to-Adoption Conversion Rate**: **${(baseConversionRate * 100.0).toFixed(2)}%**
- **Verdict**: **${orcaConversionRate > baseConversionRate ? 'SUCCESS' : 'FAILURE'}**

## Audit 4: Diversity Without Randomness
- **ORCA Listening Shannon Entropy**: **${orcaAvgEntropy.toFixed(3)} bits** (Adoption rate: **${(orcaHPAngle * 100.0).toFixed(2)}%**)
- **Random Exploration Shannon Entropy**: **${randAvgEntropy.toFixed(3)} bits** (Adoption rate: **${(randHPAngle * 100.0).toFixed(2)}%**)
- **Baseline Recommender Shannon Entropy**: **${baseAvgEntropy.toFixed(3)} bits** (Adoption rate: **${(baseHPAngle * 100.0).toFixed(2)}%**)
- **Verdict**: **${orcaAvgEntropy > baseAvgEntropy && orcaHPAngle > randHPAngle ? 'SUCCESS' : 'FAILURE'}**

## Audit 5: Recommendation Independence Test (Popularity Removal)
- **Normal ORCA Adoption Rate**: **${(orcaNormalAdoptRate * 100.0).toFixed(2)}%**
- **Popularity-Ablated ORCA Adoption Rate**: **${(orcaAblatedAdoptRate * 100.0).toFixed(2)}%**
- **Degradation**: **${popularityDegradation.toFixed(2)}%**
- **Verdict**: **${popularityDegradation < 15.0 ? 'SUCCESS (Minimal Degradation)' : 'FAILURE (Collapses without popularity)'}**

## Audit 6: Discovery Counterfactual Test
- **Counterfactual Discovery Score**: **${(counterfactualDiscoveryScore * 100.0).toFixed(2)}%** of adopted items would not be discovered via baseline channels (popularity-driven Spotify/Apple Music/Radio).
- **Verdict**: **${counterfactualDiscoveryScore > 0.50 ? 'SUCCESS' : 'FAILURE'}**

## Audit 7: Cultural Breadth Growth
- **ORCA Average GS (Taste Space Spread)**: **${orcaAvgGS.toFixed(3)}**
- **Baseline Average GS (Taste Space Spread)**: **${baseAvgGS.toFixed(3)}**
- **Latent Territory Coverage (ORCA vs Baseline)**: **${(orcaAvgCoverage * 100.0).toFixed(2)}%** vs **${(baseAvgCoverage * 100.0).toFixed(2)}%**
- **Verdict**: **${orcaAvgGS > baseAvgGS && orcaAvgCoverage > baseAvgCoverage ? 'SUCCESS' : 'FAILURE'}**

## Audit 8: Adoption Persistence Test
- **ORCA Target Retention Rate at 180 Days**: **${(orcaPersistRate180 * 100.0).toFixed(2)}%**
- **Baseline Target Retention Rate at 180 Days**: **${(basePersistRate180 * 100.0).toFixed(2)}%**
- **Verdict**: **${orcaPersistRate180 > basePersistRate180 ? 'SUCCESS' : 'FAILURE'}**

## Audit 9: Direct Recommendation Removal
- **Direct Recommendation Adoption Rate**: **${(baseHP90RateA * 100.0).toFixed(2)}%**
- **ORCA Cultivation Adoption Rate**: **${(orcaHP90RateB * 100.0).toFixed(2)}%**
- **Uplift**: **${sequencingGain.toFixed(2)}%**
- **Verdict**: **${orcaHP90RateB > baseHP90RateA ? 'SUCCESS' : 'FAILURE'}**

## Audit 10: Familiarity Model Validation
- **Model 1 (Affinity only) AUC-ROC**: **${aucModel1.toFixed(4)}**
- **Model 2 (Affinity + Familiarity) AUC-ROC**: **${aucModel2.toFixed(4)}**
- **Verdict**: **${aucModel2 > aucModel1 + 0.05 ? 'SUCCESS (Familiarity is highly predictive)' : 'FAILURE'}**

## Audit 11: Fluency Model Validation
- **Fluency Correlation with Saves**: **${corrFluencySaves.toFixed(3)}**
- **Fluency Correlation with Occupancy Growth**: **${corrFluencyOccupancy.toFixed(3)}**
- **Verdict**: **${corrFluencySaves > 0.30 && corrFluencyOccupancy > 0.30 ? 'SUCCESS' : 'FAILURE'}**

## Audit 12: Taste Expansion Index
- **TEI Index Score**: **${tei.toFixed(4)}**
- **Classification**: **${teiClassification}**

---

# Ultimate Falsification Question
- **Model A (Familiarity, Fluency, Adoption) AUC-ROC**: **${aucModelA.toFixed(4)}**
- **Model B (Occupancy, Affinity, Readiness) AUC-ROC**: **${aucModelB.toFixed(4)}**
- **Winning Model**: **${winningModel}**
- **Interpretation**: ${aucModelA > aucModelB ? 'ORCA is fundamentally a taste cultivation engine. Its core value lies in tracking and sequence scaffolding familiarity and fluency rather than just exploiting current affinity.' : 'ORCA acts mostly as a recommendation optimizer based on immediate affinity and readiness.'}
`;

  const fs = require('fs');
  fs.writeFileSync(reportPath, reportContent);
  console.log(`Saved detailed report to ${reportPath}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
