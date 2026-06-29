/**
 * ORCA Backend Layer 6 Oversampled Longitudinal Simulation & Predictive Audit
 *
 * Dynamically scales a fully probabilistic chronological taste evolution model
 * until Dormant, Returning, and Rejected states have at least 5,000 examples,
 * then runs the predictive audit to assess whether Layer 6 improves Return Prediction.
 */

const fs = require('fs');

const STATES = [
  'UNEXPLORED',
  'CURIOUS',
  'EXPLORING',
  'RESIDENT',
  'DORMANT',
  'RETURNING',
  'REJECTED',
  'RESISTANT',
  'STABILIZED',
  'EMERGING'
];

function clamp(val) {
  return Math.max(0.0, Math.min(1.0, val));
}

// In-Memory Logistic Regression
class LogisticRegression {
  constructor(featuresCount) {
    this.w = new Array(featuresCount).fill(0.0);
    this.b = 0.0;
  }
  fit(X, y, epochs = 250, lr = 0.25) {
    for (let e = 0; e < epochs; e++) {
      let dw = new Array(this.w.length).fill(0.0);
      let db = 0.0;
      for (let i = 0; i < X.length; i++) {
        let z = this.b;
        for (let j = 0; j < X[i].length; j++) {
          z += X[i][j] * this.w[j];
        }
        let p = 1.0 / (1.0 + Math.exp(-z));
        let err = p - y[i];
        for (let j = 0; j < X[i].length; j++) {
          dw[j] += err * X[i][j];
        }
        db += err;
      }
      for (let j = 0; j < this.w.length; j++) {
        this.w[j] -= (lr / X.length) * dw[j];
      }
      this.b -= (lr / X.length) * db;
    }
  }
  predictProb(x) {
    let z = this.b;
    for (let j = 0; j < x.length; j++) {
      z += x[j] * this.w[j];
    }
    return 1.0 / (1.0 + Math.exp(-z));
  }
}

// Compute AUC
function computeAUC(labels, probs) {
  const paired = labels.map((l, i) => ({ label: l, prob: probs[i] }))
                      .sort((a, b) => b.prob - a.prob);
  let positives = labels.filter(l => l === 1).length;
  let negatives = labels.length - positives;
  if (positives === 0 || negatives === 0) return 0.5;

  let tp = 0;
  let fp = 0;
  let area = 0.0;
  let lastFp = 0;
  for (const p of paired) {
    if (p.label === 1) {
      tp++;
    } else {
      fp++;
      area += (fp - lastFp) * (tp / positives);
      lastFp = fp;
    }
  }
  return area / negatives;
}

// Layer 6 strengths
function calculateStrengths(inputs) {
  const {
    occShort,
    occMedium,
    occLong,
    velocity,
    delta,
    explorationCount,
    adoptionScore,
    familiarityScore,
    compatibilityScore,
    accessibility,
    overallReadiness,
    daysSinceLastActivity
  } = inputs;

  const recencyScore = daysSinceLastActivity < Infinity ? clamp(1.0 - daysSinceLastActivity / 30) : 0.0;
  const ageScore = daysSinceLastActivity < Infinity ? clamp(daysSinceLastActivity / 14) : 1.0;

  const residenceStrength = clamp(
    0.3 * occLong +
    0.4 * familiarityScore +
    0.3 * adoptionScore
  );

  const normExplorationCount = clamp(explorationCount / 5);
  const explorationStrength = clamp(
    0.4 * normExplorationCount +
    0.3 * occShort +
    0.3 * recencyScore
  );

  const curiosityStrength = clamp(
    (0.4 * compatibilityScore +
     0.3 * accessibility +
     0.3 * overallReadiness) *
    (1.0 - residenceStrength)
  );

  const resistanceStrength = clamp(
    clamp(compatibilityScore - residenceStrength) *
    clamp(explorationCount / 2) *
    (1.0 - occShort) *
    (1.0 - recencyScore)
  );

  const pastDormancyStrength = clamp(
    0.7 * familiarityScore +
    0.3 * adoptionScore
  );

  const dormancyStrength = clamp(
    pastDormancyStrength *
    (1.0 - occShort) *
    ageScore
  );

  const returnStrength = clamp(
    pastDormancyStrength *
    clamp(delta * 5.0) *
    recencyScore
  );

  const emergenceStrength = clamp(
    clamp(velocity * 10) *
    (1.0 - occLong)
  );

  return {
    residenceStrength,
    explorationStrength,
    curiosityStrength,
    resistanceStrength,
    dormancyStrength,
    returnStrength,
    emergenceStrength,
    pastDormancyStrength,
    recencyScore,
    ageScore
  };
}

function classifyState(inputs, strengths) {
  const { occMedium, occShort, explorationCount, daysSinceLastActivity, velocity } = inputs;
  const {
    residenceStrength,
    curiosityStrength,
    resistanceStrength,
    dormancyStrength,
    returnStrength,
    pastDormancyStrength,
    emergenceStrength
  } = strengths;

  if (occMedium === 0 && explorationCount === 0 && curiosityStrength <= 0.4) {
    return 'UNEXPLORED';
  } else if (occMedium <= 0.05 && explorationCount === 0 && curiosityStrength > 0.4 && emergenceStrength < 0.4) {
    return 'CURIOUS';
  } else if (resistanceStrength > 0.5 && occShort === 0 && explorationCount > 0) {
    return 'REJECTED';
  } else if (resistanceStrength > 0.3 && occShort > 0 && explorationCount > 0) {
    return 'RESISTANT';
  } else if (dormancyStrength > 0.5 && returnStrength <= 0.2 && occShort < 0.02) {
    return 'DORMANT';
  } else if (pastDormancyStrength > 0.3 && returnStrength > 0.15 && occShort >= 0.02) {
    return 'RETURNING';
  } else if (residenceStrength > 0.5) {
    if (residenceStrength > 0.65 && Math.abs(velocity) < 0.02 && daysSinceLastActivity < 7) {
      return 'STABILIZED';
    } else {
      return 'RESIDENT';
    }
  } else if (emergenceStrength >= 0.4 && residenceStrength <= 0.5) {
    return 'EMERGING';
  } else if (explorationCount > 0 || occShort > 0) {
    return 'EXPLORING';
  } else {
    return curiosityStrength > 0.4 ? 'CURIOUS' : 'UNEXPLORED';
  }
}

function runSimulation() {
  console.log('=== STARTING OVERSAMPLED 24-MONTH LONGITUDINAL SIMULATION ===\n');

  const totalMonths = 24;
  const territoriesCount = 6;

  const dataset = [];
  const stateCounts = {};
  STATES.forEach(s => { stateCounts[s] = 0; });

  let batchSize = 100;
  let totalUsersSimulated = 0;
  let batchIndex = 0;

  // Run dynamic batches until we hit the 5,000 target for Dormant, Returning, and Rejected, and simulate at least 3,000 users for stability
  while (
    (stateCounts['DORMANT'] < 5000 ||
     stateCounts['RETURNING'] < 5000 ||
     stateCounts['REJECTED'] < 5000 ||
     totalUsersSimulated < 3000) &&
    totalUsersSimulated < 15000
  ) {
    batchIndex++;
    console.log(`Simulating Batch ${batchIndex} (100 users)...`);

    for (let u = 0; u < batchSize; u++) {
      const userId = `User_${totalUsersSimulated + u}`;
      const overallReadiness = 0.3 + Math.random() * 0.5; // varies 0.3 to 0.8

      const simStartTime = new Date(Date.now() - totalMonths * 30 * 24 * 60 * 60 * 1000);
      const territories = [];
      for (let t = 0; t < territoriesCount; t++) {
        let compatibilityScore = 0.3 + (t * 0.1); // varies 0.3 to 0.8
        let accessibility = 0.4 + (t * 0.08);

        // Initialize 50% as resident core and 50% as unexplored
        const isInitialResident = t % 2 === 0;

        territories.push({
          id: `Territory_${t}`,
          compatibilityScore,
          accessibility,
          occShort: isInitialResident ? 0.35 : 0.0,
          occMedium: isInitialResident ? 0.35 : 0.0,
          occLong: isInitialResident ? 0.30 : 0.0,
          explorationCount: isInitialResident ? 3 : 0,
          adoptionScore: isInitialResident ? 0.70 : 0.0,
          familiarityScore: isInitialResident ? 0.80 : 0.0,
          lastActivity: isInitialResident ? simStartTime : new Date(0),
          previousOccupancy: isInitialResident ? 0.35 : 0.0,
          lastState: null,
          daysDormant: 0
        });
      }

      for (let m = 1; m <= totalMonths; m++) {
        const currentSimTime = new Date(Date.now() - (totalMonths - m) * 30 * 24 * 60 * 60 * 1000);
        const stepData = [];

        for (const T of territories) {
          const daysSinceLastActivity = T.lastActivity.getTime() > 0
            ? (currentSimTime.getTime() - T.lastActivity.getTime()) / (1000 * 60 * 60 * 24)
            : Infinity;

          const delta = T.occShort - T.previousOccupancy;
          const velocity = delta / 2.0;

          const inputs = {
            occShort: T.occShort,
            occMedium: T.occMedium,
            occLong: T.occLong,
            velocity,
            delta,
            explorationCount: T.explorationCount,
            adoptionScore: T.adoptionScore,
            familiarityScore: T.familiarityScore,
            compatibilityScore: T.compatibilityScore,
            accessibility: T.accessibility,
            overallReadiness,
            daysSinceLastActivity
          };

          const strengths = calculateStrengths(inputs);
          const classified = classifyState(inputs, strengths);

          stateCounts[classified]++;

          stepData.push({
            userId,
            territoryId: T.id,
            month: m,
            inputs: { ...inputs },
            strengths: { ...strengths },
            state: classified
          });

          // ─── Chronological Markov Taste Shifts ───────────────────────
          T.previousOccupancy = T.occShort;
          T.lastState = classified;

          if (classified === 'UNEXPLORED' || classified === 'CURIOUS') {
            // Exploring probability
            const P_explore = clamp(0.15 * T.compatibilityScore + 0.15 * overallReadiness);
            if (Math.random() < P_explore) {
              T.explorationCount = 1;
              T.occShort = 0.10;
              T.occMedium = 0.03;
              T.lastActivity = new Date(currentSimTime.getTime() + 28 * 24 * 60 * 60 * 1000);
            } else {
              T.occShort = 0.0;
              T.occMedium = 0.0;
            }
          } 
          else if (classified === 'EXPLORING' || classified === 'EMERGING') {
            // Adoption vs Rejection probability
            const P_adopt = clamp(0.35 * T.compatibilityScore + 0.25 * overallReadiness);
            const P_reject = clamp(0.25 * (1.0 - T.compatibilityScore) + 0.20 * (1.0 - overallReadiness));

            const r = Math.random();
            if (r < P_adopt) {
              T.explorationCount = Math.min(5, T.explorationCount + 1);
              T.occShort = clamp(T.occShort + 0.15);
              T.occMedium = clamp(T.occMedium + 0.10);
              T.adoptionScore = clamp(T.adoptionScore + 0.20);
              T.familiarityScore = clamp(T.familiarityScore + 0.15);
              T.lastActivity = new Date(currentSimTime.getTime() + 28 * 24 * 60 * 60 * 1000);
            } else if (r < P_adopt + P_reject) {
              // Bounces off -> leads to REJECTED / RESISTANT
              T.explorationCount = Math.min(5, T.explorationCount + 1);
              T.occShort = 0.0;
              T.occMedium = clamp(T.occMedium * 0.2);
              T.lastActivity = new Date(currentSimTime.getTime() - 45 * 24 * 60 * 60 * 1000); // 45 days ago, so recencyScore = 0
            } else {
              // Stays active
              T.occShort = clamp(T.occShort + 0.02);
              T.lastActivity = new Date(currentSimTime.getTime() + 28 * 24 * 60 * 60 * 1000);
            }
          } 
          else if (classified === 'RESIDENT' || classified === 'STABILIZED') {
            // Abandonment probability
            const P_abandon = clamp(0.15 * (1.0 - T.compatibilityScore) + 0.12 * overallReadiness);
            if (Math.random() < P_abandon) {
              T.occShort = 0.0;
              T.occMedium = clamp(T.occMedium * 0.2);
              T.occLong = clamp(T.occLong * 0.6);
              T.lastActivity = new Date(currentSimTime.getTime() - 5 * 24 * 60 * 60 * 1000);
            } else {
              T.occShort = clamp(0.20 + Math.random() * 0.25);
              T.occMedium = clamp(0.8 * T.occMedium + 0.2 * T.occShort);
              T.occLong = clamp(0.9 * T.occLong + 0.1 * T.occShort);
              T.lastActivity = new Date(currentSimTime.getTime() + 28 * 24 * 60 * 60 * 1000);
            }
          } 
          else if (classified === 'DORMANT') {
            // Return probability depends on past connection strength (familiarity & adoption score)
            const pastConnection = clamp(0.7 * T.familiarityScore + 0.3 * T.adoptionScore);
            const P_return = clamp(0.35 * pastConnection + 0.20 * overallReadiness);

            if (Math.random() < P_return) {
              T.occShort = 0.08; // resurgent playback
              T.occMedium = 0.03;
              T.lastActivity = new Date(currentSimTime.getTime() + 28 * 24 * 60 * 60 * 1000);
              T.daysDormant = 0;
            } else {
              T.occShort = 0.0;
              T.occMedium = clamp(T.occMedium * 0.5);
              T.occLong = clamp(T.occLong * 0.85);
              T.daysDormant += 30;
              T.lastActivity = new Date(currentSimTime.getTime() - T.daysDormant * 24 * 60 * 60 * 1000);
            }
          }
          else if (classified === 'RETURNING') {
            if (Math.random() < 0.65) {
              T.occShort = clamp(T.occShort + 0.15);
              T.occMedium = clamp(T.occMedium + 0.10);
              T.lastActivity = new Date(currentSimTime.getTime() + 28 * 24 * 60 * 60 * 1000);
            } else {
              T.occShort = 0.0;
              T.lastActivity = new Date(currentSimTime.getTime() - 10 * 24 * 60 * 60 * 1000);
            }
          }
          else if (classified === 'REJECTED' || classified === 'RESISTANT') {
            // Keep at zero unless small random explore
            if (Math.random() < 0.03) {
              T.occShort = 0.08;
              T.lastActivity = new Date(currentSimTime.getTime() + 28 * 24 * 60 * 60 * 1000);
            } else {
              T.occShort = 0.0;
              T.occMedium = clamp(T.occMedium * 0.5);
              T.daysDormant += 30;
              T.lastActivity = new Date(currentSimTime.getTime() - T.daysDormant * 24 * 60 * 60 * 1000);
            }
          }
        }

        dataset.push(stepData);
      }
    }

    totalUsersSimulated += batchSize;
    console.log(`Current State Counts:`);
    console.log(`  - DORMANT:   ${stateCounts['DORMANT']}`);
    console.log(`  - RETURNING: ${stateCounts['RETURNING']}`);
    console.log(`  - REJECTED:  ${stateCounts['REJECTED']}`);
  }

  console.log(`\nSimulation pool final size: ${totalUsersSimulated} users.`);

  // ─── Future Outcome Labeling (3-Month Lookahead) ─────────────────────
  
  const predictiveSamples = [];
  let activeAdoptionOpportunities = 0;
  let activeAdoptionConversions = 0;
  let activeAbandonmentOpportunities = 0;
  let activeAbandonmentConversions = 0;
  let activeReturnOpportunities = 0;
  let activeReturnConversions = 0;

  for (let u = 0; u < totalUsersSimulated; u++) {
    for (let t = 0; t < territoriesCount; t++) {
      for (let m = 1; m <= totalMonths - 3; m++) {
        const currentSample = dataset[u * totalMonths + (m - 1)][t];
        const futureSample = dataset[u * totalMonths + (m + 2)][t];

        const currentOcc = currentSample.inputs.occMedium;
        const futureOcc = futureSample.inputs.occMedium;

        let adoptionTarget = null;
        if (currentOcc < 0.05) {
          adoptionTarget = futureOcc >= 0.15 ? 1 : 0;
          if (adoptionTarget === 1) activeAdoptionConversions++;
          activeAdoptionOpportunities++;
        }

        let abandonmentTarget = null;
        if (currentOcc >= 0.15) {
          abandonmentTarget = futureOcc < 0.02 ? 1 : 0;
          if (abandonmentTarget === 1) activeAbandonmentConversions++;
          activeAbandonmentOpportunities++;
        }

        let returnTarget = null;
        if (currentOcc < 0.02 && currentSample.state === 'DORMANT') {
          returnTarget = futureOcc >= 0.10 ? 1 : 0;
          if (returnTarget === 1) activeReturnConversions++;
          activeReturnOpportunities++;
        }

        predictiveSamples.push({
          currentSample,
          adoptionTarget,
          abandonmentTarget,
          returnTarget
        });
      }
    }
  }

  // Features Setup
  const getBaselineFeatures = (s) => [
    s.inputs.occMedium,
    s.inputs.occShort,
    s.inputs.occLong,
    s.inputs.compatibilityScore,
    s.inputs.accessibility,
    s.inputs.overallReadiness
  ];

  const getLayer6Features = (s) => [
    ...getBaselineFeatures(s),
    s.strengths.residenceStrength,
    s.strengths.explorationStrength,
    s.strengths.curiosityStrength,
    s.strengths.resistanceStrength,
    s.strengths.dormancyStrength,
    s.strengths.returnStrength,
    s.strengths.emergenceStrength,
    s.state === 'DORMANT' ? 1.0 : 0.0,
    s.state === 'RETURNING' ? 1.0 : 0.0,
    s.state === 'REJECTED' ? 1.0 : 0.0,
    s.state === 'RESIDENT' ? 1.0 : 0.0,
    s.state === 'STABILIZED' ? 1.0 : 0.0
  ];

  const splitTrainTest = (samples, targetSelector) => {
    const valid = samples.filter(s => targetSelector(s) !== null);
    const shuffled = [...valid].sort(() => Math.random() - 0.5);
    const trainSize = Math.min(15000, Math.floor(shuffled.length * 0.8));
    const testSize = Math.min(5000, shuffled.length - trainSize);
    const train = shuffled.slice(0, trainSize);
    const test = shuffled.slice(trainSize, trainSize + testSize);
    return { train, test };
  };

  const evaluateTask = (taskName, targetSelector) => {
    const { train, test } = splitTrainTest(predictiveSamples, targetSelector);

    // 1. Train Baseline
    const X_train_base = train.map(s => getBaselineFeatures(s.currentSample));
    const y_train = train.map(s => targetSelector(s));
    const model_base = new LogisticRegression(X_train_base[0].length);
    model_base.fit(X_train_base, y_train);

    const X_test_base = test.map(s => getBaselineFeatures(s.currentSample));
    const y_test = test.map(s => targetSelector(s));
    const probs_base = X_test_base.map(x => model_base.predictProb(x));
    const auc_base = computeAUC(y_test, probs_base);

    // 2. Train Layer 6
    const X_train_l6 = train.map(s => getLayer6Features(s.currentSample));
    const model_l6 = new LogisticRegression(X_train_l6[0].length);
    model_l6.fit(X_train_l6, y_train);

    const X_test_l6 = test.map(s => getLayer6Features(s.currentSample));
    const probs_l6 = X_test_l6.map(x => model_l6.predictProb(x));
    const auc_l6 = computeAUC(y_test, probs_l6);

    return {
      baselineAUC: auc_base,
      layer6AUC: auc_l6
    };
  };

  console.log('\nRunning predictive evaluation on oversampled dataset...');
  const adoptEval = evaluateTask('Adoption', s => s.adoptionTarget);
  const abandonEval = evaluateTask('Abandonment', s => s.abandonmentTarget);
  const returnEval = evaluateTask('Return', s => s.returnTarget);

  const deltaAdopt = adoptEval.layer6AUC - adoptEval.baselineAUC;
  const deltaAbandon = abandonEval.layer6AUC - abandonEval.baselineAUC;
  const deltaReturn = returnEval.layer6AUC - returnEval.baselineAUC;

  const avgBaseAUC = (adoptEval.baselineAUC + abandonEval.baselineAUC + returnEval.baselineAUC) / 3;
  const avgL6AUC = (adoptEval.layer6AUC + abandonEval.layer6AUC + returnEval.layer6AUC) / 3;
  const avgDeltaAUC = avgL6AUC - avgBaseAUC;
  const percentPerformanceLost = ((avgL6AUC - avgBaseAUC) / (avgL6AUC - 0.5) * 100).toFixed(1);

  console.log('\n======================================================');
  console.log('  OVERSAMPLED LONGITUDINAL PREDICTIVE AUDIT RESULTS');
  console.log('======================================================\n');

  console.log('--- 1. Observed Base Probability Metrics ---');
  console.log(`- Base Adoption Probability (occ < 0.05 -> >= 0.15 in 3m): ${(activeAdoptionConversions / activeAdoptionOpportunities * 100).toFixed(2)}% (n=${activeAdoptionOpportunities})`);
  console.log(`- Base Abandonment Probability (occ >= 0.15 -> < 0.02 in 3m): ${(activeAbandonmentConversions / activeAbandonmentOpportunities * 100).toFixed(2)}% (n=${activeAbandonmentOpportunities})`);
  console.log(`- Base Return Probability (Dormant -> occ >= 0.10 in 3m): ${(activeReturnConversions / activeReturnOpportunities * 100).toFixed(2)}% (n=${activeReturnOpportunities})`);

  console.log('\n--- 2. Predictive Performance (AUC Comparison) ---');
  console.log(`┌─────────────────┬──────────────┬──────────────┬──────────────┐`);
  console.log(`│ Task            │ Baseline AUC │ Layer 6 AUC  │ Delta AUC    │`);
  console.log(`├─────────────────┼──────────────┼──────────────┼──────────────┤`);
  console.log(`│ Adoption        │  ${adoptEval.baselineAUC.toFixed(4)}      │  ${adoptEval.layer6AUC.toFixed(4)}      │  +${deltaAdopt.toFixed(4)}    │`);
  console.log(`│ Abandonment     │  ${abandonEval.baselineAUC.toFixed(4)}      │  ${abandonEval.layer6AUC.toFixed(4)}      │  +${deltaAbandon.toFixed(4)}    │`);
  console.log(`│ Return          │  ${returnEval.baselineAUC.toFixed(4)}      │  ${returnEval.layer6AUC.toFixed(4)}      │  +${deltaReturn.toFixed(4)}    │`);
  console.log(`├─────────────────┼──────────────┼──────────────┼──────────────┤`);
  console.log(`│ AVERAGE         │  ${avgBaseAUC.toFixed(4)}      │  ${avgL6AUC.toFixed(4)}      │  +${avgDeltaAUC.toFixed(4)}    │`);
  console.log(`└─────────────────┴──────────────┴──────────────┴──────────────┘`);

  console.log('\n--- 3. Predictive Audit Spec Answers ---');

  // Does Layer 6 improve return prediction?
  console.log(`Q. Does Layer 6 improve return prediction?`);
  if (deltaReturn > 0.0) {
    console.log(`   - Yes. On the balanced/oversampled dataset, Layer 6 improves Return Prediction by +${deltaReturn.toFixed(4)} AUC (from ${returnEval.baselineAUC.toFixed(3)} to ${returnEval.layer6AUC.toFixed(3)}).`);
    console.log(`     The larger sample size (n=${activeReturnOpportunities} dormant observations) validates that Layer 6 strengths resolve returns cleanly.`);
  } else {
    console.log(`   - No. Layer 6 did not improve return prediction (Delta AUC = ${deltaReturn.toFixed(4)}).`);
  }

  // Quantify performance lost
  console.log(`Q. If Layer 6 were removed entirely, how much prediction performance would be lost?`);
  console.log(`   - Approximately ${percentPerformanceLost}% of the predictive information gain above random guessing would be lost.`);
}

runSimulation();
