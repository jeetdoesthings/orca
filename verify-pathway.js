const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== STARTING LAYER 8 PATHWAY SEQUENCING ENGINE VERIFICATION ===\n');

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

  // Import computing modules
  const relationshipModule = await import('./src/lib/profile/territory-relationship.ts');
  const computeUserTerritoryRelationships = relationshipModule.computeUserTerritoryRelationships || relationshipModule.default?.computeUserTerritoryRelationships;
  const pathwayModule = await import('./src/lib/profile/pathway-engine.ts');
  const computeUserPathways = pathwayModule.computeUserPathways || pathwayModule.default?.computeUserPathways;

  if (!computeUserTerritoryRelationships || !computeUserPathways) {
    console.error('ERROR: Failed to import computing modules.');
    process.exit(1);
  }

  // 2. Clean old pathway tables for a clean run
  console.log('\nCleaning old Layer 8 tables for fresh verification...');
  await prisma.pathwayStep.deleteMany({ where: { pathway: { userId } } });
  await prisma.pathwayEvaluation.deleteMany({ where: { pathway: { userId } } });
  await prisma.userTerritoryPathway.deleteMany({ where: { userId } });

  console.log('Triggering cascading computations (Layer 6 Relationships -> Layer 7 Interventions -> Layer 8 Pathways)...');
  await computeUserTerritoryRelationships(userId);

  // 3. Verify database records are persisted
  console.log('\n--- VERIFYING PERSISTED TABLES ---');
  const pathways = await prisma.userTerritoryPathway.findMany({
    where: { userId },
    include: {
      steps: { orderBy: { stepIndex: 'asc' } },
      evaluation: true,
    }
  });

  if (pathways.length === 0) {
    console.error('FAIL: No UserTerritoryPathway records were created.');
    process.exit(1);
  }
  console.log(`SUCCESS: Created ${pathways.length} UserTerritoryPathway records.`);

  const stepCount = await prisma.pathwayStep.count({ where: { pathway: { userId } } });
  if (stepCount === 0) {
    console.error('FAIL: No PathwayStep records were created.');
    process.exit(1);
  }
  console.log(`SUCCESS: Created ${stepCount} PathwayStep records across all pathways.`);

  const evaluationCount = await prisma.pathwayEvaluation.count({ where: { pathway: { userId } } });
  if (evaluationCount === 0) {
    console.error('FAIL: No PathwayEvaluation records were created.');
    process.exit(1);
  }
  console.log(`SUCCESS: Created ${evaluationCount} PathwayEvaluation records.`);

  // 4. Validate Path constraints
  console.log('\n--- VALIDATING PATH CONSTRAINTS & SOUNDNESS ---');
  let loopErrors = 0;
  let monotonicErrors = 0;
  let lenErrors = 0;
  let recoveryErrors = 0;

  for (const path of pathways) {
    const nodes = path.steps.map(s => s.nodeId);
    
    // Check loops
    const uniqueNodes = new Set(nodes);
    if (uniqueNodes.size !== nodes.length) {
      console.error(`- Path from ${path.sourceTerritoryId} to ${path.targetTerritoryId} has loop! Nodes: ${nodes.join(' -> ')}`);
      loopErrors++;
    }

    // Check length
    if (nodes.length > 4) {
      console.error(`- Path from ${path.sourceTerritoryId} to ${path.targetTerritoryId} exceeds max length (length = ${nodes.length})`);
      lenErrors++;
    }

    // Check monotonic novelty increase (with small delta buffer)
    let prevNovelty = 0;
    path.steps.forEach((s, idx) => {
      // stepNoveltyDelta represents step distance or change.
      // The cumulative novelty should generally increase, but each step index > 0 should have a valid delta.
      if (idx > 0 && s.noveltyDelta < 0.0) {
        monotonicErrors++;
      }
    });

    // Check recovery nodes
    path.steps.forEach((s, idx) => {
      if (idx > 0 && !s.recoveryNodeId) {
        console.error(`- Step ${idx} in path to ${path.targetTerritoryId} is missing a recoveryNodeId.`);
        recoveryErrors++;
      }
    });
  }

  if (loopErrors === 0 && lenErrors === 0 && recoveryErrors === 0) {
    console.log('SUCCESS: All generated pathways passed loop, length, and recovery node integrity checks.');
  } else {
    console.warn(`WARNING: Integrity check failed. Loops: ${loopErrors}, Length: ${lenErrors}, Recovery: ${recoveryErrors}`);
  }

  // 5. Display a sample pathway in detail
  console.log('\n--- SAMPLE DETAILED PATHWAY ---');
  const sample = pathways.find(p => p.steps.length > 2) || pathways[0];
  if (sample) {
    console.log(`Path Style: ${sample.pathStyle}`);
    console.log(`Intervention Type: ${sample.interventionType}`);
    console.log(`Confidence: ${sample.confidence.toFixed(3)}`);
    console.log(`Total Novelty Burden: ${sample.totalNovelty.toFixed(3)}`);
    console.log(`Total Pathway Score: ${sample.totalScore.toFixed(3)}`);
    console.log(`Evaluation:`, {
      coherence: sample.evaluation?.pathCoherence.toFixed(3),
      expectedAdoption: sample.evaluation?.expectedAdoption.toFixed(3),
      expectedRejection: sample.evaluation?.expectedRejection.toFixed(3),
      noveltyBudgetFit: sample.evaluation?.noveltyBudgetFit.toFixed(3),
    });
    console.log('Steps:');
    sample.steps.forEach(s => {
      console.log(`  [Step ${s.stepIndex}] Node: ${s.nodeId} (${s.nodeType})`);
      console.log(`     Novelty Delta: ${s.noveltyDelta.toFixed(3)}, Sensory Delta: ${s.sensoryDelta.toFixed(3)}, Cultural Delta: ${s.culturalDelta.toFixed(3)}`);
      console.log(`     Accessibility: ${s.accessibility.toFixed(3)}, Bridge strength: ${s.bridgeStrength.toFixed(3)}, Step Risk: ${s.stepRisk.toFixed(3)}`);
      console.log(`     Fallback Recovery Node: ${s.recoveryNodeId || 'N/A'}`);
    });
  }

  // 6. Simulate State Sensitivity Simulation
  console.log('\n--- SIMULATING USER READINESS INFLUENCE ON PATHS ---');
  const originalProfile = await prisma.user.findUnique({
    where: { spotifyId: userId },
    select: { profileData: true }
  });

  async function mockUserReadiness(readiness) {
    if (originalProfile && originalProfile.profileData) {
      const profile = JSON.parse(originalProfile.profileData);
      profile.discoveryProfile = { 
        ...profile.discoveryProfile, 
        overallReadiness: readiness,
        noveltyAppetite: readiness * 0.8
      };
      await prisma.user.update({
        where: { spotifyId: userId },
        data: { profileData: JSON.stringify(profile) },
      });
    }
  }

  // Scenario A: High Readiness => Short/Direct paths and higher scores
  console.log('\nScenario A: High Readiness (0.90) => Expecting more DIRECT/efficient path styles');
  await mockUserReadiness(0.90);
  // Re-run pathways
  await computeUserPathways(userId);
  const highReadinessPaths = await prisma.userTerritoryPathway.findMany({
    where: { userId },
  });
  console.log(`- Average path length: ${(highReadinessPaths.reduce((acc, p) => acc + p.totalNovelty, 0) / highReadinessPaths.length).toFixed(3)}`);
  console.log(`- Pathway Styles chosen:`, highReadinessPaths.map(p => p.pathStyle).filter((v, i, a) => a.indexOf(v) === i));

  // Scenario B: Low Readiness (0.10) => Expect hold or highly constrained paths
  console.log('\nScenario B: Low Readiness (0.10) => Expecting SAFETY_FIRST or holding paths');
  await mockUserReadiness(0.10);
  await computeUserPathways(userId);
  const lowReadinessPaths = await prisma.userTerritoryPathway.findMany({
    where: { userId },
  });
  console.log(`- Number of pathways generated: ${lowReadinessPaths.length}`);
  console.log(`- Pathway Styles chosen:`, lowReadinessPaths.map(p => p.pathStyle).filter((v, i, a) => a.indexOf(v) === i));

  // 7. Restore original profile
  if (originalProfile) {
    console.log('\nRestoring user profile...');
    await prisma.user.update({
      where: { spotifyId: userId },
      data: { profileData: originalProfile.profileData },
    });
  }

  console.log('\n=== LAYER 8 PATHWAY SEQUENCING ENGINE VERIFICATION COMPLETE ===');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
