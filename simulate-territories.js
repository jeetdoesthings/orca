const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== STARTING TASTE TERRITORIES SIMULATION ===\n');

  // Step 1: Check database and auto-populate artist embeddings if empty
  const artistCount = await prisma.artist.count();
  const embeddingCount = await prisma.artistEmbedding.count();
  console.log(`Current DB Stats: Artists=${artistCount}, Embeddings=${embeddingCount}`);

  if (embeddingCount < 10) {
    console.log('\n[Prep] DB is empty/low on embeddings. Auto-populating from User globeData...');
    
    // Import latent space processing logic
    // Using dynamic import because tsx resolves TS files correctly
    const { processArtistLatentRepresentation, seedTraitDefinitions } = (await import('./src/lib/latent/latent-space.ts')).default;
    
    console.log('[Prep] Seeding trait definitions...');
    await seedTraitDefinitions();

    console.log('[Prep] Loading users\' globe graphs...');
    const users = await prisma.user.findMany({ select: { globeData: true } });
    
    const uniqueArtists = new Map();
    for (const user of users) {
      if (!user.globeData) continue;
      try {
        const globe = JSON.parse(user.globeData);
        const nodes = globe.nodes || [];
        for (const node of nodes) {
          if (node.id && node.name && node.audioSignature) {
            uniqueArtists.set(node.id, node);
          }
        }
      } catch (e) {
        console.error(`[Prep] Failed to parse globeData: ${e.message}`);
      }
    }

    console.log(`[Prep] Found ${uniqueArtists.size} unique artists to embed. Processing...`);

    let count = 0;
    for (const artistNode of uniqueArtists.values()) {
      try {
        await processArtistLatentRepresentation({
          spotifyId: artistNode.id,
          name: artistNode.name,
          genres: artistNode.genres || [],
          popularity: artistNode.popularity || 50,
          followers: 0,
          imageUrl: artistNode.imageUrl || '',
          audioSignature: artistNode.audioSignature,
        });
        count++;
        if (count % 20 === 0) {
          console.log(`[Prep] Embedded ${count}/${uniqueArtists.size} artists...`);
        }
      } catch (err) {
        console.error(`[Prep] Failed to embed ${artistNode.name}:`, err.message);
      }
    }
    console.log(`[Prep] Finished embedding population. Processed: ${count} artists.`);
  }

  // Step 2: Clear any existing territories to run a clean simulation
  console.log('\n[Simulation] Cleaning old territories data...');
  await prisma.territoryMembership.deleteMany({});
  await prisma.territoryBridge.deleteMany({});
  await prisma.territorySimilarity.deleteMany({});
  await prisma.territorySnapshot.deleteMany({});
  await prisma.territory.deleteMany({});

  // Step 3: Run pipeline for version 1
  console.log('\n[Simulation] Running Territory Pipeline for Version 1...');
  const { generateTasteTerritories } = (await import('./src/lib/latent/territory-pipeline.ts')).default;
  
  const result1 = await generateTasteTerritories({
    minConfidence: 0.4, // Using 0.4 to include more artists for this simulation
    k: 10,
    minSimilarity: 0.87,
    fuzzyThreshold: 0.82,
    coreThreshold: 0.90,
  });

  console.log('\n--- Pipeline V1 Logs ---');
  result1.logs.forEach(l => console.log(l));
  console.log('------------------------\n');

  console.log('=== Version 1 Output ===');
  console.log(`Version: ${result1.version}`);
  console.log(`Territories Generated: ${result1.territoryCount}`);
  console.log(`Artists Clustered: ${result1.artistCount}`);
  console.log(`Bridges Found: ${result1.bridgeCount}`);

  // Fetch and inspect some generated territories
  const territoriesV1 = await prisma.territory.findMany({
    where: { version: result1.version },
    orderBy: { size: 'desc' },
    take: 3,
  });

  console.log('\nTop 3 V1 Territories:');
  for (const t of territoriesV1) {
    const meta = JSON.parse(t.metadata || '{}');
    console.log(`- ID: ${t.id} | Name: "${meta.displayName}" | Size: ${t.size} | Cohesion: ${t.cohesion.toFixed(4)} | Density: ${t.density.toFixed(2)}`);
  }

  // Step 4: Run pipeline for version 2 (verifies evolution, stability, splits/merges, and snapshots)
  console.log('\n[Simulation] Running Territory Pipeline for Version 2...');
  const result2 = await generateTasteTerritories({
    minConfidence: 0.4,
    k: 8, // slight parameter shift to simulate space drift/evolution
    minSimilarity: 0.85,
    fuzzyThreshold: 0.80,
    coreThreshold: 0.88,
  });

  console.log('\n--- Pipeline V2 Logs ---');
  result2.logs.forEach(l => console.log(l));
  console.log('------------------------\n');

  console.log('=== Version 2 Output ===');
  console.log(`Version: ${result2.version}`);
  console.log(`Territories Generated: ${result2.territoryCount}`);
  console.log(`Artists Clustered: ${result2.artistCount}`);
  console.log(`Bridges Found: ${result2.bridgeCount}`);

  // Fetch and inspect version 2 stability stats
  const territoriesV2 = await prisma.territory.findMany({
    where: { version: result2.version },
    orderBy: { size: 'desc' },
  });

  console.log('\nV2 Territories Stability & Evolution Events:');
  for (const t of territoriesV2) {
    const meta = JSON.parse(t.metadata || '{}');
    console.log(`- ID: ${t.id} | Name: "${meta.displayName}" | Stability: ${t.stability.toFixed(4)} | Event: ${meta.evolutionEvent} | Matched: ${meta.matchedPreviousId}`);
  }

  // Fetch snaps count
  const snapshotCount = await prisma.territorySnapshot.count();
  const similarityCount = await prisma.territorySimilarity.count();
  console.log(`\nSimulation database persistence verify:`);
  console.log(`- Total Snapshots in DB: ${snapshotCount}`);
  console.log(`- Total Similarity Edges in DB: ${similarityCount}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
