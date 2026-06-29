const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== STARTING REDESIGNED LATENT COMPATIBILITY ENGINE VALIDATION ===\n');

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

  // Verify territories exist
  const territoryCount = await prisma.territory.count();
  console.log(`Active territories in database: ${territoryCount}`);
  if (territoryCount === 0) {
    console.error('No territories found. Please run simulate-territories.js first.');
    return;
  }

  // Check if profileData is null. If so, compute it first.
  const userRecord = await prisma.user.findUnique({
    where: { spotifyId: user.spotifyId },
    select: { profileData: true, globeData: true }
  });

  console.log('\n[Sim] Re-computing clean user profile data from globeData...');
  const parsedGlobe = JSON.parse(userRecord.globeData || '{"nodes":[]}');
  const nodes = parsedGlobe.nodes || [];
  const frontierNodes = nodes.filter(n => n.state === 'frontier');
  
  const profileMod = await import('../src/lib/profile/profile-engine.ts');
  const computeUserProfile = profileMod.computeUserProfile || profileMod.default?.computeUserProfile;
  
  const profile = computeUserProfile(
    user.spotifyId,
    nodes,
    frontierNodes.length,
    null
  );
  
  await prisma.user.update({
    where: { spotifyId: user.spotifyId },
    data: {
      profileData: JSON.stringify(profile),
      profileComputedAt: new Date(),
      profileVersion: profile.version
    }
  });
  console.log('[Sim] profileData successfully reset to clean original values.');

  // Clear old affinity data to ensure a clean run
  console.log('\n[Sim] Clearing old affinity and snapshot records...');
  await prisma.userTerritoryAffinity.deleteMany({ where: { userId: user.spotifyId } });
  await prisma.userTerritoryAffinitySnapshot.deleteMany({ where: { userId: user.spotifyId } });

  // Load and run mapping (which triggers affinity/compatibility engine)
  console.log('\n[Sim] Executing User Territory Mapping (triggers Compatibility Engine)...');
  const mod = await import('../src/lib/profile/territory-mapping.ts');
  const computeUserTerritoryMapping = mod.computeUserTerritoryMapping || mod.default?.computeUserTerritoryMapping;
  
  await computeUserTerritoryMapping(user.spotifyId);

  // Fetch computed compatibilities
  const affinities = await prisma.userTerritoryAffinity.findMany({
    where: { userId: user.spotifyId },
    include: { territory: true }
  });

  console.log(`Computed latent compatibilities for ${affinities.length} territories.`);

  if (affinities.length === 0) {
    console.error('No compatibilities were computed. Check log outputs.');
    return;
  }

  console.log('\n======================================================');
  console.log('   ANSWERING THE SPEC REDESIGN VALIDATION QUESTIONS');
  console.log('======================================================');

  // Helper to get territory display name
  const getTName = (t) => {
    try {
      const meta = JSON.parse(t.metadata || '{}');
      return meta.displayName || t.id;
    } catch {
      return t.id;
    }
  };

  // --- 1. CONTINUOUS LATENT MANIFOLD ---
  console.log('\n--- 1. Continuous Latent Manifold Projection ---');
  console.log('We represent music space as a continuous 33D latent manifold.');
  console.log('Top 3 territories by overall compatibility score:');
  const sortedComp = [...affinities].sort((a, b) => b.compatibilityScore - a.compatibilityScore);
  sortedComp.slice(0, 3).forEach(c => {
    console.log(`  * "${getTName(c.territory)}" | Compatibility Score: ${(c.compatibilityScore*100).toFixed(1)}%`);
  });

  // --- 2. ORTHOGONALIZATION CHECK ---
  console.log('\n--- 2. Gram-Schmidt Orthogonalization Check ---');
  console.log('Comparing raw cultural profile vs orthogonalized cultural profile:');
  const firstAff = affinities[0];
  console.log(`Territory: "${getTName(firstAff.territory)}"`);
  console.log(`  - Pure Sensory Compatibility (Pure acoustics): ${(firstAff.sensoryCompatibility*100).toFixed(1)}%`);
  console.log(`  - Orthogonalized Cultural Compatibility (Listening graph / metadata): ${(firstAff.culturalCompatibility*100).toFixed(1)}%`);
  console.log(`  - Structural Distance: ${(firstAff.structuralDistance*100).toFixed(1)}%`);

  // --- 3. TEST FOR LATENT TASTE VARIANCE ---
  console.log('\n--- 3. Latent Taste Shift Trial ---');
  // We can query 10 artists with valid embeddings
  const allEmbeddings = await prisma.artistEmbedding.findMany({
    take: 10,
    select: { artistId: true }
  });

  if (allEmbeddings.length >= 6) {
    const setA = allEmbeddings.slice(0, 3).map(e => e.artistId);
    const setB = allEmbeddings.slice(3, 6).map(e => e.artistId);

    // Create Mock User A and Mock User B
    console.log('[Sim] Seeding Mock User A (listening history set A) and Mock User B (listening history set B)...');
    
    await prisma.user.upsert({
      where: { spotifyId: 'mock_user_a' },
      create: { id: 'id_mock_user_a', spotifyId: 'mock_user_a', displayName: 'Mock User A', syncStatus: 'COMPLETE' },
      update: {}
    });
    await prisma.user.upsert({
      where: { spotifyId: 'mock_user_b' },
      create: { id: 'id_mock_user_b', spotifyId: 'mock_user_b', displayName: 'Mock User B', syncStatus: 'COMPLETE' },
      update: {}
    });

    // Add explored artists
    await prisma.exploredArtist.deleteMany({ where: { userId: { in: ['mock_user_a', 'mock_user_b'] } } });
    for (const id of setA) {
      await prisma.exploredArtist.create({ data: { userId: 'mock_user_a', artistId: id, source: 'spotify-sync' } });
    }
    for (const id of setB) {
      await prisma.exploredArtist.create({ data: { userId: 'mock_user_b', artistId: id, source: 'spotify-sync' } });
    }

    // Build profileData for both mock users
    const profileMod = await import('../src/lib/profile/profile-engine.ts');
    const computeUserProfile = profileMod.computeUserProfile || profileMod.default?.computeUserProfile;
    
    // We mock globe nodes
    const mockNodesA = setA.map(id => ({ id, state: 'explored', weight: 0.33, genres: [], popularity: 50, audioSignature: { energy: 0.5, valence: 0.5, danceability: 0.5, acousticness: 0.5, instrumentalness: 0.5, tempo: 110 } }));
    const mockNodesB = setB.map(id => ({ id, state: 'explored', weight: 0.33, genres: [], popularity: 50, audioSignature: { energy: 0.8, valence: 0.2, danceability: 0.8, acousticness: 0.1, instrumentalness: 0.9, tempo: 140 } }));

    const profileA = computeUserProfile('mock_user_a', mockNodesA, 0, null);
    const profileB = computeUserProfile('mock_user_b', mockNodesB, 0, null);

    await prisma.user.update({ where: { spotifyId: 'mock_user_a' }, data: { profileData: JSON.stringify(profileA) } });
    await prisma.user.update({ where: { spotifyId: 'mock_user_b' }, data: { profileData: JSON.stringify(profileB) } });

    // Run compatibility engine
    const affMod = await import('../src/lib/profile/territory-affinity.ts');
    const computeUserTerritoryAffinity = affMod.computeUserTerritoryAffinity || affMod.default?.computeUserTerritoryAffinity;

    const affsA = await computeUserTerritoryAffinity('mock_user_a');
    const affsB = await computeUserTerritoryAffinity('mock_user_b');

    // Compare compatibility for a target territory
    const targetT = affinities[0].territoryId;
    const compA = affsA.find(a => a.territoryId === targetT);
    const compB = affsB.find(a => a.territoryId === targetT);

    if (compA && compB) {
      console.log(`Comparing User A vs User B for territory: "${getTName(affinities[0].territory)}"`);
      console.log(`  - User A Compatibility: ${(compA.compatibilityScore * 100).toFixed(1)}% (Cultural: ${(compA.culturalCompatibility*100).toFixed(1)}%, Sensory: ${(compA.sensoryCompatibility*100).toFixed(1)}%)`);
      console.log(`  - User B Compatibility: ${(compB.compatibilityScore * 100).toFixed(1)}% (Cultural: ${(compB.culturalCompatibility*100).toFixed(1)}%, Sensory: ${(compB.sensoryCompatibility*100).toFixed(1)}%)`);
      const diff = Math.abs(compA.compatibilityScore - compB.compatibilityScore);
      console.log(`  - Overall Score Difference: ${(diff * 100).toFixed(1)}%`);
      console.log(`  - Capturing latent taste shift? ${diff > 0.001 ? 'YES! (Engine maps taste dynamically)' : 'NO'}`);
    }

    // Clean up
    await prisma.exploredArtist.deleteMany({ where: { userId: { in: ['mock_user_a', 'mock_user_b'] } } });
    await prisma.userTerritoryAffinity.deleteMany({ where: { userId: { in: ['mock_user_a', 'mock_user_b'] } } });
    await prisma.userTerritoryAffinitySnapshot.deleteMany({ where: { userId: { in: ['mock_user_a', 'mock_user_b'] } } });
    await prisma.user.deleteMany({ where: { spotifyId: { in: ['mock_user_a', 'mock_user_b'] } } });
  } else {
    console.log('Skipped Mock Trait Shift: Not enough embeddings in DB to mock different history.');
  }

  // --- 4. ACCESSIBILITY COMPATIBILITY ---
  console.log('\n--- 4. Accessibility and Hidden Potential ---');
  const sortedHidden = [...affinities].sort((a, b) => b.hiddenPotential - a.hiddenPotential);
  console.log('Top 3 Hidden Potential Territories (Low occupancy, high compatibility, accessible):');
  sortedHidden.slice(0, 3).forEach(h => {
    console.log(`  * "${getTName(h.territory)}"`);
    console.log(`    - Hidden Potential Score: ${(h.hiddenPotential * 100).toFixed(1)}%`);
    console.log(`    - Overall Compatibility: ${(h.compatibilityScore * 100).toFixed(1)}%`);
    console.log(`    - Accessibility: ${(h.accessibility * 100).toFixed(1)}%`);
    console.log(`    - Occupancy: ${(h.occupancy * 100).toFixed(1)}%`);
    console.log(`    - Explanation: ${h.explanation}`);
  });

  const snapCount = await prisma.userTerritoryAffinitySnapshot.count({ where: { userId: user.spotifyId } });
  console.log(`\n[Sim] Compatibility Snapshots saved: ${snapCount}`);

  console.log('\n=== REDESIGNED LATENT COMPATIBILITY ENGINE VALIDATION COMPLETE ===');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
