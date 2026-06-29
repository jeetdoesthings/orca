const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findFirst({ where: { syncStatus: 'COMPLETE' } });
  if (!user) {
    console.error("No demo user found");
    return;
  }
  const userId = user.spotifyId;
  console.log("Found demo user:", userId);

  // 1. Seed UserArtistMemory using real artists in the DB
  const artists = await prisma.artist.findMany({ take: 15 });
  if (artists.length === 0) {
    console.error("No artists in database to seed memories");
    return;
  }

  console.log(`Seeding memories for ${artists.length} artists...`);
  await prisma.userArtistMemory.deleteMany({ where: { userId } });
  
  for (let i = 0; i < artists.length; i++) {
    const artist = artists[i];
    const memoryState = i < 5 ? 'INTERNALIZED' : i < 10 ? 'FAMILIAR' : 'KNOWN';
    const memoryStrength = 0.5 + (i % 5) * 0.1; // 0.5 to 0.9
    const persistence = 0.2 + (i % 4) * 0.2; // 0.2 to 0.8
    await prisma.userArtistMemory.create({
      data: {
        userId,
        artistId: artist.id,
        memoryStrength,
        memoryState,
        persistence,
        familiarity: 0.6,
        agency: 0.7,
        explorationDepth: 0.5,
        lastReinforced: new Date()
      }
    });
  }

  // 2. Seed GlobalPathwayTemplate and LongitudinalInterventions
  console.log("Seeding global pathway templates and longitudinal interventions...");
  await prisma.longitudinalIntervention.deleteMany({ where: { userId } });
  await prisma.globalPathwayTemplate.deleteMany();

  const t1 = 'Territory_v2_001';
  const t2 = 'Territory_v2_002';
  const t3 = 'Territory_v2_003';

  // Pathway 1: t1 -> t2
  const pathway1Artists = artists.slice(0, 4).map(a => a.id);
  const pathwayHash1 = 'pathway_hash_t1_t2';
  await prisma.globalPathwayTemplate.create({
    data: {
      id: pathwayHash1,
      sourceTerritory: t1,
      targetTerritory: t2,
      pathwayNodes: JSON.stringify(pathway1Artists),
      successCount: 5,
      failureCount: 1,
      conversionRate: 0.83
    }
  });

  // Pathway 2: t1 -> t3
  const pathway2Artists = artists.slice(4, 8).map(a => a.id);
  const pathwayHash2 = 'pathway_hash_t1_t3';
  await prisma.globalPathwayTemplate.create({
    data: {
      id: pathwayHash2,
      sourceTerritory: t1,
      targetTerritory: t3,
      pathwayNodes: JSON.stringify(pathway2Artists),
      successCount: 12,
      failureCount: 2,
      conversionRate: 0.85
    }
  });

  // Active intervention
  await prisma.longitudinalIntervention.create({
    data: {
      userId,
      targetTerritoryId: t2,
      pathwayHash: pathwayHash1,
      state: 'ACTIVE',
      maturationDate: new Date(Date.now() + 1000 * 3600 * 24 * 3), // 3 days from now
      baselineProbability: 0.15,
      expectedOutcome: 0.85
    }
  });

  // Completed intervention
  await prisma.longitudinalIntervention.create({
    data: {
      userId,
      targetTerritoryId: t3,
      pathwayHash: pathwayHash2,
      state: 'RESOLVED_SUCCESS',
      maturationDate: new Date(Date.now() - 1000 * 3600 * 24 * 5), // 5 days ago
      baselineProbability: 0.1,
      expectedOutcome: 0.9,
      createdAt: new Date(Date.now() - 1000 * 3600 * 24 * 10)
    }
  });

  console.log("Database seeded successfully!");
}

main().catch(console.error).finally(() => prisma.$disconnect());
