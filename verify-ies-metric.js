const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Helper to calculate the Acoustic-Cultural Taste Shift Distance (Omnivorousness Lift)
// Measures the average squared distance from the target expansion vectors to the baseline taste centroid
function calculateTasteDistanceLift(baselineVectors, targetVectors) {
  if (baselineVectors.length === 0 || targetVectors.length === 0) return 0.0;
  const D = baselineVectors[0].length;
  
  // Compute baseline centroid
  const centroid = new Array(D).fill(0.0);
  baselineVectors.forEach(v => {
    for (let i = 0; i < D; i++) {
      centroid[i] += v[i];
    }
  });
  for (let i = 0; i < D; i++) {
    centroid[i] /= baselineVectors.length;
  }

  // Compute average squared Euclidean distance of target vectors to baseline centroid
  let sumSqDist = 0.0;
  targetVectors.forEach(v => {
    let sqDist = 0.0;
    for (let i = 0; i < D; i++) {
      const diff = v[i] - centroid[i];
      sqDist += diff * diff;
    }
    sumSqDist += sqDist;
  });

  return sumSqDist / targetVectors.length;
}

// Simple exponential decay curve fitting (y = y0 * e^(-lambda * d))
// We linearize: ln(y) = ln(y0) - lambda * d
function fitExponentialDecay(days, plays) {
  const n = days.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  let validCount = 0;

  for (let i = 0; i < n; i++) {
    const yVal = Math.max(0.1, plays[i]);
    const lnY = Math.log(yVal);
    sumX += days[i];
    sumY += lnY;
    sumXY += days[i] * lnY;
    sumXX += days[i] * days[i];
    validCount++;
  }

  if (validCount === 0) return 0.5;

  const denominator = (validCount * sumXX - sumX * sumX);
  if (denominator === 0) return 0.0;

  const slope = (validCount * sumXY - sumX * sumY) / denominator;
  return -slope;
}

async function main() {
  console.log('=== STARTING IDENTITY EVOLUTION SCORE (IES) METRIC VERIFICATION ===\n');

  // Load database artists to use real vector structure for omnivorousness volume math
  const dbArtists = await prisma.artist.findMany({
    include: { embeddings: { where: { embeddingVersion: 1 } } },
    take: 50
  });

  if (dbArtists.length < 5) {
    console.error('ERROR: Need at least 5 artists in DB to run covariance tests.');
    process.exit(1);
  }

  const artists = dbArtists.map(a => {
    const emb = a.embeddings[0];
    let fused = [];
    try {
      fused = JSON.parse(emb?.fusedVector || '[]');
    } catch {}
    if (fused.length < 33) fused = new Array(33).fill(0.0);
    return { id: a.id, fused };
  });

  const targetVector = artists[0].fused;

  // Let's create two mock users and evaluate their Identity Evolution Score (IES)

  // ─── USER A: THE PASSIVE CONSUMER ──────────────────────────────────
  // 1. Omnivorousness: Comfort zone is narrow. Target is far from their comfort zone.
  const userAUniqueBaseline = [artists[1].fused]; 
  const userAUniqueAfter = [targetVector];
  const userAOmnivorousness = calculateTasteDistanceLift(userAUniqueBaseline, userAUniqueAfter);

  // 2. Identity Integration: Passive plays only
  const userAAgency = 0.0 / 40.0; // 0 search/library plays, 40 total plays
  const userAIntegration = userAAgency * Math.log(1 + 40);

  // 3. Resilience: Washout phase shows rapid decay
  const userAWashoutDays = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  const userAWashoutPlays = [5, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; 
  const userADecayRate = fitExponentialDecay(userAWashoutDays, userAWashoutPlays);
  const userAResilience = Math.exp(-Math.max(0.0, userADecayRate) * 14.0);

  const userAIES = userAOmnivorousness * userAIntegration * userAResilience;

  // ─── USER B: THE IDENTITY INTEGRATOR ────────────────────────────────
  // 1. Omnivorousness: Multi-genre baseline. Target is also far.
  const userBUniqueBaseline = [
    artists[1].fused,
    artists[2].fused,
    artists[3].fused,
    artists[4].fused
  ];
  const userBUniqueAfter = [targetVector];
  const userBOmnivorousness = calculateTasteDistanceLift(userBUniqueBaseline, userBUniqueAfter);

  // 2. Identity Integration: Active user-initiated plays (80% agency)
  const userBAgency = 32.0 / 40.0; 
  const userBIntegration = userBAgency * Math.log(1 + 40);

  // 3. Resilience: Washout phase shows high stability
  const userBWashoutDays = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  const userBWashoutPlays = [4, 4, 3, 3, 3, 3, 4, 3, 3, 3, 2, 3, 3, 3]; 
  const userBDecayRate = fitExponentialDecay(userBWashoutDays, userBWashoutPlays);
  const userBResilience = Math.exp(-Math.max(0.0, userBDecayRate) * 14.0);

  const userBIES = userBOmnivorousness * userBIntegration * userBResilience;


  // ─── PRINTING COMPARATIVE RESULTS ──────────────────────────────────
  console.log('================ METRIC CALIBRATION SUMMARY ================');
  
  console.log('\nUSER A: The Passive Consumer');
  console.log(`  - Baseline Unique Artists: 1`);
  console.log(`  - Omnivorousness Lift (Ω): ${userAOmnivorousness.toFixed(3)}`);
  console.log(`  - Agency Ratio (A):        ${(userAAgency * 100).toFixed(2)}%`);
  console.log(`  - Identity Integration (I):${userAIntegration.toFixed(3)}`);
  console.log(`  - Washout Decay Rate (λ):  ${userADecayRate.toFixed(3)}`);
  console.log(`  - Temporal Resilience (R):  ${(userAResilience * 100).toFixed(2)}%`);
  console.log(`  => IDENTITY EVOLUTION SCORE (IES): ${userAIES.toFixed(4)}`);

  console.log('\nUSER B: The Active Identity Integrator');
  console.log(`  - Baseline Unique Artists: 4`);
  console.log(`  - Omnivorousness Lift (Ω): ${userBOmnivorousness.toFixed(3)}`);
  console.log(`  - Agency Ratio (A):        ${(userBAgency * 100).toFixed(2)}%`);
  console.log(`  - Identity Integration (I):${userBIntegration.toFixed(3)}`);
  console.log(`  - Washout Decay Rate (λ):  ${userBDecayRate.toFixed(3)}`);
  console.log(`  - Temporal Resilience (R):  ${(userBResilience * 100).toFixed(2)}%`);
  console.log(`  => IDENTITY EVOLUTION SCORE (IES): ${userBIES.toFixed(4)}`);

  console.log('\n------------------------------------------------------------');
  const ratio = userBIES / (userAIES || 0.0001);
  console.log(`Identity Integrator IES is ${ratio.toFixed(1)}x higher than Passive Consumer.`);
  
  if (userBIES > userAIES && userAIES === 0.0) {
    console.log('\nSUCCESS: IES successfully falsified passive consumption. Core loops broken.');
  } else {
    console.warn('\nWARNING: Check parameter sensitivity.');
  }

  console.log('\n=== IES METRIC VERIFICATION COMPLETE ===');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
