const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Calculates cohort conversion rates for High Hidden Potential territories
 * @param {object} options - Threshold options
 */
async function runConversionAnalysis(options = {}) {
  const potentialThreshold = options.potentialThreshold ?? 0.45; // High Hidden Potential threshold
  const adoptionOccupancyThreshold = options.adoptionOccupancyThreshold ?? 0.10; // Threshold to count as "adopted"
  const lowOccupancyThreshold = options.lowOccupancyThreshold ?? 0.05; // Max occupancy at t_0 to qualify as unexplored

  console.log('=== RUNNING AFFINITY CONVERSION COHORT ANALYSIS ===');
  console.log(`Parameters:`);
  console.log(`  - High Hidden Potential Threshold: >= ${potentialThreshold}`);
  console.log(`  - Target Adoption Occupancy: >= ${adoptionOccupancyThreshold}`);
  console.log(`  - Baseline Unexplored Occupancy: < ${lowOccupancyThreshold}\n`);

  // 1. Fetch all affinity snapshots sorted by timestamp
  const affinitySnapshots = await prisma.userTerritoryAffinitySnapshot.findMany({
    orderBy: { timestamp: 'asc' }
  });

  if (affinitySnapshots.length === 0) {
    console.log('No historical affinity snapshots found in database.');
    return null;
  }

  // Group snapshots by unique user-territory pairs
  const cohorts = new Map(); // Key: userId_territoryId -> { startTimestamp, adoptedTimestamp: null }

  affinitySnapshots.forEach(snap => {
    let componentScores = {};
    try {
      componentScores = JSON.parse(snap.componentScores || '{}');
    } catch {}

    const occupancy = componentScores.occupancy ?? 0.0;
    const accessibility = componentScores.accessibility ?? 0.5;
    
    // Hidden Potential = Affinity * (1 - Occupancy) * Accessibility
    const hiddenPotential = snap.affinityScore * (1.0 - occupancy) * accessibility;

    const key = `${snap.userId}_${snap.territoryId}`;

    // If we haven't tracked this pair yet, check if it qualifies as a "high hidden potential cohort trigger"
    if (!cohorts.has(key)) {
      if (hiddenPotential >= potentialThreshold && occupancy < lowOccupancyThreshold) {
        cohorts.set(key, {
          userId: snap.userId,
          territoryId: snap.territoryId,
          startTimestamp: snap.timestamp,
          adoptedTimestamp: null
        });
      }
    }
  });

  console.log(`Identified ${cohorts.size} high hidden-potential cohorts to track.\n`);

  if (cohorts.size === 0) {
    console.log('No cohorts met the "high potential + low occupancy" baseline criteria.');
    return { cohortsTracked: 0, rates: { d30: 0, d60: 0, d90: 0 } };
  }

  // 2. Query all UserTerritorySnapshot entries (occupancy history) for the tracked cohort users
  const userIds = Array.from(new Set(Array.from(cohorts.values()).map(c => c.userId)));
  const occupancySnapshots = await prisma.userTerritorySnapshot.findMany({
    where: { userId: { in: userIds } },
    orderBy: { timestamp: 'asc' }
  });

  // Find when (if ever) each cohort pair crossed the adoption threshold after starting
  for (const [key, cohort] of cohorts.entries()) {
    const relevantSnaps = occupancySnapshots.filter(os => 
      os.userId === cohort.userId && 
      os.territoryId === cohort.territoryId && 
      os.timestamp > cohort.startTimestamp
    );

    const firstAdoption = relevantSnaps.find(os => os.occupancy >= adoptionOccupancyThreshold);
    if (firstAdoption) {
      cohort.adoptedTimestamp = firstAdoption.timestamp;
    }
  }

  // 3. Compute Conversion Stats
  let totalTracked = cohorts.size;
  let adopted30 = 0;
  let adopted60 = 0;
  let adopted90 = 0;

  const MS_PER_DAY = 1000 * 60 * 60 * 24;

  cohorts.forEach(cohort => {
    if (cohort.adoptedTimestamp) {
      const elapsedDays = (new Date(cohort.adoptedTimestamp).getTime() - new Date(cohort.startTimestamp).getTime()) / MS_PER_DAY;
      
      if (elapsedDays <= 30) adopted30++;
      if (elapsedDays <= 60) adopted60++;
      if (elapsedDays <= 90) adopted90++;
    }
  });

  const rate30 = (adopted30 / totalTracked) * 100;
  const rate60 = (adopted60 / totalTracked) * 100;
  const rate90 = (adopted90 / totalTracked) * 100;

  console.log('--- CONVERSION ANALYSIS RESULTS ---');
  console.log(`Total Cohorts Tracked: ${totalTracked}`);
  console.log(`Adopted within 30 days: ${adopted30} (${rate30.toFixed(1)}%)`);
  console.log(`Adopted within 60 days: ${adopted60} (${rate60.toFixed(1)}%)`);
  console.log(`Adopted within 90 days: ${adopted90} (${rate90.toFixed(1)}%)`);

  return {
    cohortsTracked: totalTracked,
    rates: {
      d30: rate30,
      d60: rate60,
      d90: rate90
    }
  };
}

// Export for module importing, or execute if run directly
if (require.main === module) {
  runConversionAnalysis()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
} else {
  module.exports = { runConversionAnalysis };
}
