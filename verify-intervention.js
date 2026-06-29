const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== STARTING LAYER 7 INTERVENTION ENGINE VERIFICATION ===\n');

  // 1. Find a demo user
  const user = await prisma.user.findFirst({
    where: { syncStatus: 'COMPLETE', profileData: { not: null } },
    select: { spotifyId: true, displayName: true, profileData: true }
  });

  if (!user) {
    console.error('ERROR: No user with complete syncStatus and profileData found.');
    process.exit(1);
  }

  const userId = user.spotifyId;
  console.log(`Testing with user: "${user.displayName}" (Spotify ID: ${userId})`);

  // Ensure relationship mapping runs first
  const relationshipModule = await import('./src/lib/profile/territory-relationship.ts');
  const computeUserTerritoryRelationships = relationshipModule.computeUserTerritoryRelationships || relationshipModule.default?.computeUserTerritoryRelationships;
  const interventionModule = await import('./src/lib/profile/intervention-engine.ts');
  const computeUserInterventions = interventionModule.computeUserInterventions || interventionModule.default?.computeUserInterventions;

  if (!computeUserTerritoryRelationships || !computeUserInterventions) {
    console.error('ERROR: Failed to import computing modules.');
    process.exit(1);
  }

  // 2. Clean old intervention tables for a clean run
  console.log('\nCleaning old Layer 7 tables for fresh verification...');
  await prisma.userTerritoryIntervention.deleteMany({ where: { userId } });
  await prisma.interventionScoreBreakdown.deleteMany({ where: { userId } });
  await prisma.interventionExplanation.deleteMany({ where: { userId } });

  console.log('Triggering cascading computations (Layer 6 Relationships -> Layer 7 Interventions)...');
  await computeUserTerritoryRelationships(userId);

  // 3. Verify database records are persisted
  console.log('\n--- VERIFYING PERSISTED TABLES ---');
  const interventions = await prisma.userTerritoryIntervention.findMany({ where: { userId } });
  if (interventions.length === 0) {
    console.error('FAIL: No UserTerritoryIntervention records were created.');
    process.exit(1);
  }
  console.log(`SUCCESS: Created ${interventions.length} UserTerritoryIntervention records.`);

  const breakdown = await prisma.interventionScoreBreakdown.findFirst({ where: { userId } });
  if (!breakdown) {
    console.error('FAIL: InterventionScoreBreakdown record was not created.');
    process.exit(1);
  }
  console.log('SUCCESS: InterventionScoreBreakdown created successfully.');
  console.log('Breakdown sample:', {
    territoryId: breakdown.territoryId,
    introScore: breakdown.introScore.toFixed(3),
    bridgeScore: breakdown.bridgeScore.toFixed(3),
    reinforceScore: breakdown.reinforceScore.toFixed(3),
    holdScore: breakdown.holdScore.toFixed(3),
  });

  const explanation = await prisma.interventionExplanation.findFirst({ where: { userId } });
  if (!explanation) {
    console.error('FAIL: InterventionExplanation record was not created.');
    process.exit(1);
  }
  console.log('SUCCESS: InterventionExplanation created successfully.');
  console.log('Explanation payload sample:', JSON.parse(explanation.explanationPayload));

  // 4. State Sensitivity Simulations
  console.log('\n--- SIMULATING SPECIFIC INTERVENTION SCENARIOS ---');
  const targetTerritoryId = interventions[0].territoryId;

  // We will mock the DB states, call computeUserInterventions directly, and check outputs.
  const originalProfile = await prisma.userTerritoryProfile.findUnique({ where: { userId } });

  async function mockUserReadiness(readiness) {
    const dbUser = await prisma.user.findUnique({
      where: { spotifyId: userId },
      select: { profileData: true }
    });
    if (dbUser && dbUser.profileData) {
      const profile = JSON.parse(dbUser.profileData);
      profile.discoveryProfile = { ...profile.discoveryProfile, overallReadiness: readiness };
      await prisma.user.update({
        where: { spotifyId: userId },
        data: { profileData: JSON.stringify(profile) },
      });
    }
  }

  async function mockTerritoryMetrics({ state, compatibility, accessibility, strengths }) {
    // Mock Affinity (Layer 4)
    await prisma.userTerritoryAffinity.upsert({
      where: { userId_territoryId: { userId, territoryId: targetTerritoryId } },
      create: { userId, territoryId: targetTerritoryId, compatibilityScore: compatibility, accessibility, confidence: 1.0 },
      update: { compatibilityScore: compatibility, accessibility },
    });

    // Mock Relationship (Layer 6)
    await prisma.userTerritoryRelationship.upsert({
      where: { userId_territoryId: { userId, territoryId: targetTerritoryId } },
      create: {
        userId,
        territoryId: targetTerritoryId,
        currentState: state,
        stateConfidence: 1.0,
        residenceStrength: strengths.residenceStrength ?? 0.0,
        explorationStrength: strengths.explorationStrength ?? 0.0,
        curiosityStrength: strengths.curiosityStrength ?? 0.0,
        resistanceStrength: strengths.resistanceStrength ?? 0.0,
        dormancyStrength: strengths.dormancyStrength ?? 0.0,
        returnStrength: strengths.returnStrength ?? 0.0,
        emergenceStrength: strengths.emergenceStrength ?? 0.0,
      },
      update: {
        currentState: state,
        residenceStrength: strengths.residenceStrength ?? 0.0,
        explorationStrength: strengths.explorationStrength ?? 0.0,
        curiosityStrength: strengths.curiosityStrength ?? 0.0,
        resistanceStrength: strengths.resistanceStrength ?? 0.0,
        dormancyStrength: strengths.dormancyStrength ?? 0.0,
        returnStrength: strengths.returnStrength ?? 0.0,
        emergenceStrength: strengths.emergenceStrength ?? 0.0,
      },
    });
  }

  // Scenario A: Curious + High Readiness => INTRODUCE
  console.log('\nScenario A: Curious user + High Readiness + Highly Compatible');
  await mockUserReadiness(0.85);
  await mockTerritoryMetrics({
    state: 'CURIOUS',
    compatibility: 0.80,
    accessibility: 0.70,
    strengths: { curiosityStrength: 0.85 }
  });
  let results = await computeUserInterventions(userId);
  let match = results.find(r => r.territoryId === targetTerritoryId);
  console.log(`- Selected: ${match.selectedIntervention} (Score: ${match.interventionScore.toFixed(3)})`);
  if (match.selectedIntervention === 'INTRODUCE') {
    console.log('  SUCCESS: Correctly chose INTRODUCE.');
  } else {
    console.warn(`  FAILED: Chose ${match.selectedIntervention}`);
  }

  // Scenario B: Resistant + High Compatibility => BRIDGE
  console.log('\nScenario B: Resistant user + High Compatibility + Low Accessibility');
  await mockUserReadiness(0.50);
  await mockTerritoryMetrics({
    state: 'RESISTANT',
    compatibility: 0.85,
    accessibility: 0.20,
    strengths: { resistanceStrength: 0.70 }
  });
  results = await computeUserInterventions(userId);
  match = results.find(r => r.territoryId === targetTerritoryId);
  console.log(`- Selected: ${match.selectedIntervention} (Score: ${match.interventionScore.toFixed(3)})`);
  console.log(`- Routing details: Source: ${match.sourceTerritoryId}, Bridge: ${match.bridgeTerritoryId}`);
  if (match.selectedIntervention === 'BRIDGE') {
    console.log('  SUCCESS: Correctly chose BRIDGE.');
  } else {
    console.warn(`  FAILED: Chose ${match.selectedIntervention}`);
  }

  // Scenario C: Resident + High Stability => EXPAND_OUTWARD
  console.log('\nScenario C: Resident user + High Stability');
  await mockUserReadiness(0.70);
  await mockTerritoryMetrics({
    state: 'RESIDENT',
    compatibility: 0.90,
    accessibility: 0.85,
    strengths: { residenceStrength: 0.80 }
  });
  results = await computeUserInterventions(userId);
  match = results.find(r => r.territoryId === targetTerritoryId);
  console.log(`- Selected: ${match.selectedIntervention} (Score: ${match.interventionScore.toFixed(3)})`);
  console.log(`- Routing details: Source: ${match.sourceTerritoryId}, Bridge: ${match.bridgeTerritoryId}`);
  if (match.selectedIntervention === 'EXPAND_OUTWARD') {
    console.log('  SUCCESS: Correctly chose EXPAND_OUTWARD.');
  } else {
    console.warn(`  FAILED: Chose ${match.selectedIntervention}`);
  }

  // Scenario D: Low Readiness + Low Accessibility => HOLD
  console.log('\nScenario D: Low Readiness + Low Accessibility');
  await mockUserReadiness(0.15);
  await mockTerritoryMetrics({
    state: 'UNEXPLORED',
    compatibility: 0.40,
    accessibility: 0.10,
    strengths: {}
  });
  results = await computeUserInterventions(userId);
  match = results.find(r => r.territoryId === targetTerritoryId);
  console.log(`- Selected: ${match.selectedIntervention} (Score: ${match.interventionScore.toFixed(3)})`);
  console.log(`- Expected Adoption Impact: ${match.expectedAdoptionImpact.toFixed(3)}, Expected Rejection Risk: ${match.expectedRejectionRisk.toFixed(3)}`);
  if (match.selectedIntervention === 'HOLD') {
    console.log('  SUCCESS: Correctly chose HOLD.');
  } else {
    console.warn(`  FAILED: Chose ${match.selectedIntervention}`);
  }

  // Scenario E: Dormant + Rising Return => REINTRODUCE
  console.log('\nScenario E: Dormant territory + Rising return signals');
  await mockUserReadiness(0.60);
  await mockTerritoryMetrics({
    state: 'DORMANT',
    compatibility: 0.75,
    accessibility: 0.60,
    strengths: { dormancyStrength: 0.75, returnStrength: 0.50 }
  });
  results = await computeUserInterventions(userId);
  match = results.find(r => r.territoryId === targetTerritoryId);
  console.log(`- Selected: ${match.selectedIntervention} (Score: ${match.interventionScore.toFixed(3)})`);
  if (match.selectedIntervention === 'REINTRODUCE') {
    console.log('  SUCCESS: Correctly chose REINTRODUCE.');
  } else {
    console.warn(`  FAILED: Chose ${match.selectedIntervention}`);
  }

  // Scenario F: Stable Policy (Inertia check)
  console.log('\nScenario F: Testing policy stability (inertia boost)');
  // Save current choice as BRIDGE in DB
  await prisma.userTerritoryIntervention.update({
    where: { userId_territoryId: { userId, territoryId: targetTerritoryId } },
    data: { interventionType: 'BRIDGE' }
  });

  // Make HOLD base score slightly higher than BRIDGE, but ensure the inertia boost prevents HOLD from taking over.
  // Hold base score: 0.42. Bridge base score: 0.342.
  // With 0.08 inertia, BRIDGE becomes 0.422, beating HOLD.
  await mockUserReadiness(0.60); // Moderate readiness
  await mockTerritoryMetrics({
    state: 'UNEXPLORED',
    compatibility: 0.90,
    accessibility: 0.40,
    strengths: { resistanceStrength: 0.20 }
  });
  results = await computeUserInterventions(userId);
  match = results.find(r => r.territoryId === targetTerritoryId);
  console.log(`- Selected: ${match.selectedIntervention} (BRIDGE score with inertia: ${match.scoreBreakdown.bridgeScore.toFixed(3)}, HOLD score: ${match.scoreBreakdown.holdScore.toFixed(3)})`);
  if (match.selectedIntervention === 'BRIDGE') {
    console.log('  SUCCESS: Verified stable policy inertia holds the prior state.');
  } else {
    console.warn(`  FAILED: Strategy flipped to ${match.selectedIntervention} despite inertia.`);
  }

  // 5. Restore original user state
  if (originalProfile) {
    console.log('\nRestoring user profile...');
    await prisma.user.update({
      where: { spotifyId: userId },
      data: { profileData: JSON.stringify(originalProfile) },
    });
  }

  console.log('\n=== LAYER 7 INTERVENTION ENGINE VERIFICATION COMPLETE ===');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
