const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== STARTING LAYER 8 TASTE CULTIVATION ENGINE VERIFICATION ===\n');

  // 1. Find a demo user
  const user = await prisma.user.findFirst({
    where: { syncStatus: 'COMPLETE', profileData: { not: null } },
    select: { spotifyId: true, displayName: true }
  });

  if (!user) {
    console.error('ERROR: No user with complete syncStatus and profileData found.');
    process.exit(1);
  }

  const userId = user.spotifyId;
  console.log(`Testing with user: "${user.displayName}" (Spotify ID: ${userId})`);

  // Import computing modules
  const relationshipModule = await import('./src/lib/profile/territory-relationship.ts');
  const computeUserTerritoryRelationships = relationshipModule.computeUserTerritoryRelationships || relationshipModule.default?.computeUserTerritoryRelationships;
  const tceModule = await import('./src/lib/profile/tce-engine.ts');
  const computeUserCultivation = tceModule.computeUserCultivation || tceModule.default?.computeUserCultivation;

  if (!computeUserTerritoryRelationships || !computeUserCultivation) {
    console.error('ERROR: Failed to import computing modules.');
    process.exit(1);
  }

  // 2. Clean old TCE tables and listening events for a clean run
  console.log('\nCleaning old Layer 8 TCE tables for fresh verification...');
  await prisma.userListeningEvent.deleteMany({ where: { userId } });
  await prisma.userTerritorySnapshot.deleteMany({ where: { userId } });
  await prisma.territoryFamiliarity.deleteMany({ where: { userId } });
  await prisma.userTerritoryCultivation.deleteMany({ where: { userId } });

  // 3. Seed mock data
  console.log('Seeding mock listening events and weekly snapshots...');
  const activeVersion = (await prisma.territory.findFirst({ orderBy: { version: 'desc' } }))?.version || 1;
  const territories = await prisma.territory.findMany({ where: { version: activeVersion } });
  
  if (territories.length < 3) {
    console.error('ERROR: Need at least 3 territories in DB to test.');
    process.exit(1);
  }

  const tId1 = territories[0].id; // Territory 1: High exposure, high completions
  const tId2 = territories[1].id; // Territory 2: High skips, low completions (declining)
  const tId3 = territories[2].id; // Territory 3: No plays (unexplored)

  // Find membership artists for these territories to map events correctly
  const memberships = await prisma.territoryMembership.findMany({
    where: { territoryId: { in: [tId1, tId2, tId3] } }
  });

  const artId1 = memberships.find(m => m.territoryId === tId1 && m.artistId !== 'lastfm-')?.artistId || 'artist_dummy1';
  const artId2 = memberships.find(m => m.territoryId === tId2 && m.artistId !== 'lastfm-' && m.role !== 'BRIDGE')?.artistId || 'artist_dummy2';

  // Seed events for Territory 1: 8 Plays, 7 Completions, 0 Skips, 2 Saves
  const events = [];
  for (let i = 0; i < 8; i++) {
    events.push({
      userId,
      artistId: artId1,
      territoryId: tId1,
      eventType: i < 7 ? 'COMPLETE' : 'PLAY',
      timestamp: new Date(Date.now() - (8 - i) * 60 * 60 * 1000)
    });
  }
  events.push({ userId, artistId: artId1, territoryId: tId1, eventType: 'SAVE', timestamp: new Date() });
  events.push({ userId, artistId: artId1, territoryId: tId1, eventType: 'PLAYLIST_ADD', timestamp: new Date() });

  // Seed events for Territory 2: 10 Plays, 1 Completion, 8 Skips
  for (let i = 0; i < 10; i++) {
    events.push({
      userId,
      artistId: artId2,
      territoryId: tId2,
      eventType: i === 0 ? 'COMPLETE' : i < 9 ? 'SKIP' : 'PLAY',
      timestamp: new Date(Date.now() - (10 - i) * 60 * 60 * 1000)
    });
  }

  await prisma.userListeningEvent.createMany({ data: events });
  console.log(`Successfully seeded ${events.length} listening events.`);

  // Seed snapshot history for adoption/divergence detection (Moratorium vs Stable)
  const snapshots = [
    // Week 1 snapshot (2 weeks ago)
    { userId, territoryId: tId1, occupancy: 0.1, timestamp: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
    { userId, territoryId: tId2, occupancy: 0.4, timestamp: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
    { userId, territoryId: tId3, occupancy: 0.2, timestamp: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
    // Week 2 snapshot (1 week ago - shifts occupancy to T1)
    { userId, territoryId: tId1, occupancy: 0.6, timestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    { userId, territoryId: tId2, occupancy: 0.1, timestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    { userId, territoryId: tId3, occupancy: 0.1, timestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
  ];
  await prisma.userTerritorySnapshot.createMany({ data: snapshots });
  console.log(`Successfully seeded ${snapshots.length} territory occupancy snapshots.`);

  // 4. Trigger Cascade Computations
  console.log('\nTriggering cascading computations (Layer 6 Relationships -> Layer 7 Interventions -> Layer 8 TCE)...');
  await computeUserTerritoryRelationships(userId);

  // 5. Verify database records are persisted
  console.log('\n--- VERIFYING CULTIVATION STATES ---');
  const cultivations = await prisma.userTerritoryCultivation.findMany({
    where: { userId }
  });

  if (cultivations.length === 0) {
    console.error('FAIL: No UserTerritoryCultivation records were created.');
    process.exit(1);
  }
  console.log(`SUCCESS: Created ${cultivations.length} UserTerritoryCultivation records.`);

  // Test individual territory metrics
  const c1 = cultivations.find(c => c.territoryId === tId1);
  const c2 = cultivations.find(c => c.territoryId === tId2);
  const c3 = cultivations.find(c => c.territoryId === tId3);

  console.log(`\nTerritory 1 (High exposure, high completions) — expected high familiarity and high fluency:`);
  console.log(`  - Familiarity Score: ${c1.familiarityScore.toFixed(3)}`);
  console.log(`  - Fluency Score: ${c1.fluencyScore.toFixed(3)}`);
  console.log(`  - Adoption Probability: ${c1.adoptionProbability.toFixed(3)}`);
  console.log(`  - Adoption State: ${c1.adoptionState}`);
  
  if (c1.familiarityScore > 0.4 && c1.fluencyScore > 0.5) {
    console.log('  SUCCESS: Correctly calculated high familiarity/fluency.');
  } else {
    console.warn('  FAILED: Familiarity/fluency under-calculated.');
  }

  console.log(`\nTerritory 2 (High skips, low completions) — expected low fluency and DECLINED/CULTIVATING state:`);
  console.log(`  - Familiarity Score: ${c2.familiarityScore.toFixed(3)}`);
  console.log(`  - Fluency Score: ${c2.fluencyScore.toFixed(3)}`);
  console.log(`  - Adoption State: ${c2.adoptionState}`);

  if (c2.fluencyScore < 0.35 && c2.adoptionState === 'DECLINED') {
    console.log('  SUCCESS: Correctly detected low fluency and DECLINED state.');
  } else {
    console.warn('  FAILED: Failed to detect skip-driven decline.');
  }

  console.log(`\nTerritory 3 (Unexplored, no listening events) — expected default low values and UNEXPLORED state:`);
  console.log(`  - Familiarity Score: ${c3.familiarityScore.toFixed(3)}`);
  console.log(`  - Fluency Score: ${c3.fluencyScore.toFixed(3)}`);
  console.log(`  - Adoption State: ${c3.adoptionState}`);

  if (c3.familiarityScore === 0.0 && c3.adoptionState === 'UNEXPLORED') {
    console.log('  SUCCESS: Correctly calculated UNEXPLORED baseline.');
  } else {
    console.warn('  FAILED: Unexplored territory initialization incorrect.');
  }

  // 6. Verify Scheduling Rules
  console.log('\n--- VERIFYING EXPOSURE SCHEDULER cadences ---');
  const s1 = JSON.parse(c1.exposureSchedule);
  const s3 = JSON.parse(c3.exposureSchedule);

  console.log(`Territory 1 (High familiarity) Schedule Sample:`);
  console.log(`  - Focus: ${s1[0].focus}`);
  console.log(`  - Target Exposures (Week 1): ${s1[0].targetExposureCount}, Bridge Exposures: ${s1[0].bridgeExposureCount}`);

  console.log(`Territory 3 (Low familiarity) Schedule Sample:`);
  console.log(`  - Focus: ${s3[0].focus}`);
  console.log(`  - Target Exposures (Week 1): ${s3[0].targetExposureCount}, Bridge Exposures: ${s3[0].bridgeExposureCount}`);

  if (s1[0].targetExposureCount > s1[0].bridgeExposureCount && s3[0].bridgeExposureCount > s3[0].targetExposureCount) {
    console.log('  SUCCESS: Scheduler successfully scaled bridge/target exposure balance based on familiarity.');
  } else {
    console.warn('  FAILED: Scheduler exposure ratios incorrect.');
  }

  console.log('\n=== LAYER 8 TASTE CULTIVATION ENGINE VERIFICATION COMPLETE ===');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
