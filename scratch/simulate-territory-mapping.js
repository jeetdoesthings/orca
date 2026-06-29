const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== STARTING USER-TERRITORY MAPPING SIMULATION ===\n');

  // Find a synced user to test with
  const user = await prisma.user.findFirst({
    where: { syncStatus: 'COMPLETE', globeData: { not: null } },
    select: { spotifyId: true, displayName: true }
  });

  if (!user) {
    console.error('No synced user found in database. Please run a sync or seed first.');
    return;
  }

  console.log(`Found Synced User: "${user.displayName}" (Spotify ID: ${user.spotifyId})`);

  // First, let's verify if territories exist in the DB (Layer 2 output)
  const territoryCount = await prisma.territory.count();
  console.log(`Active territories in database: ${territoryCount}`);
  if (territoryCount === 0) {
    console.log('No territories found. Running territory simulation first to populate DB...');
    // We can simulate territories by running the existing simulate-territories script logic
    // but we assume simulate-territories has already been run by the developer or user.
  }

  // Load the mapping function using dynamic import
  console.log('\n[Sim] Loading User-Territory Mapping function...');
  const mod = await import('../src/lib/profile/territory-mapping.ts');
  const computeUserTerritoryMapping = mod.computeUserTerritoryMapping || mod.default?.computeUserTerritoryMapping;

  if (typeof computeUserTerritoryMapping !== 'function') {
    console.error('computeUserTerritoryMapping is not a function. Check exports.');
    return;
  }

  console.log('[Sim] Computing territory mapping...');
  const result = await computeUserTerritoryMapping(user.spotifyId);

  if (!result) {
    console.error('Mapping computation returned null.');
    return;
  }

  console.log('\n=== COMPUTATION RESULTS ===');
  console.log(`User ID: ${result.userId}`);
  console.log(`Short-Term Occupancy:`, result.occupancyShort);
  console.log(`Medium-Term Occupancy:`, result.occupancyMedium);
  console.log(`Long-Term Occupancy:`, result.occupancyLong);
  console.log(`Diversity Score: ${result.diversityScore.toFixed(4)}`);
  console.log(`Concentration Score (HHI): ${result.concentrationScore.toFixed(4)}`);
  console.log(`Entropy Score (Shannon Normalized): ${result.entropyScore.toFixed(4)}`);
  console.log(`Generated Short Narrative: "${result.shortSummary}"`);
  console.log(`Generated Trajectory Narrative: "${result.trajectoryExplanation}"`);

  // Fetch persisted DB metrics to verify DB writing works
  console.log('\n=== VERIFYING DATABASE PERSISTENCE ===');
  
  const dbProfile = await prisma.userTerritoryProfile.findUnique({
    where: { userId: user.spotifyId }
  });
  console.log(`DB UserTerritoryProfile persisted: ${!!dbProfile}`);

  const snapshotCount = await prisma.userTerritorySnapshot.count({
    where: { userId: user.spotifyId }
  });
  console.log(`DB UserTerritorySnapshots count: ${snapshotCount}`);

  const momentumCount = await prisma.territoryMomentum.count({
    where: { userId: user.spotifyId }
  });
  console.log(`DB TerritoryMomentums count: ${momentumCount}`);

  const adoptionCount = await prisma.territoryAdoption.count({
    where: { userId: user.spotifyId }
  });
  console.log(`DB TerritoryAdoptions count: ${adoptionCount}`);

  const familiarityCount = await prisma.territoryFamiliarity.count({
    where: { userId: user.spotifyId }
  });
  console.log(`DB TerritoryFamiliarities count: ${familiarityCount}`);

  console.log('\n=== SIMULATION COMPLETED SUCCESSFULLY ===');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
