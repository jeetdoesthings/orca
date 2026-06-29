const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { runConversionAnalysis } = require('./analyze-affinity-conversion.js');

async function main() {
  console.log('=== SEEDING MOCK HISTORICAL SNAPSHOTS FOR COHORT ANALYSIS ===\n');

  const mockUsers = [
    { spotifyId: 'mock_user_alpha', displayName: 'Mock Alpha' },
    { spotifyId: 'mock_user_beta', displayName: 'Mock Beta' },
    { spotifyId: 'mock_user_gamma', displayName: 'Mock Gamma' }
  ];

  const targetTerritory = 'Territory_v2_001';

  try {
    // 1. Create mock users in DB
    console.log('[Seed] Creating mock users...');
    for (const u of mockUsers) {
      await prisma.user.upsert({
        where: { spotifyId: u.spotifyId },
        create: {
          id: `id_${u.spotifyId}`,
          spotifyId: u.spotifyId,
          displayName: u.displayName,
          syncStatus: 'COMPLETE'
        },
        update: {}
      });
    }

    const now = new Date();
    const MS_PER_DAY = 1000 * 60 * 60 * 24;

    // Day 0: All users triggers as cohort (0% occupancy, high hidden potential)
    const day0 = new Date(now.getTime() - 95 * MS_PER_DAY);
    console.log(`[Seed] Seeding Day 0 Cohorts (Date: ${day0.toISOString().split('T')[0]})...`);
    for (const u of mockUsers) {
      // Create affinity snapshot at Day 0
      const componentScores = {
        traitAffinity: 0.8,
        sonicAffinity: 0.85,
        structuralAffinity: 0.7,
        behavioralAffinity: 0.3,
        explorationAffinity: 0.9,
        momentumAlignment: 0.5,
        accessibility: 0.8,
        occupancy: 0.0
      };

      await prisma.userTerritoryAffinitySnapshot.create({
        data: {
          userId: u.spotifyId,
          territoryId: targetTerritory,
          affinityScore: 0.8,
          confidence: 0.9,
          componentScores: JSON.stringify(componentScores),
          timestamp: day0
        }
      });

      // Create occupancy snapshot at Day 0 showing 0% occupancy
      await prisma.userTerritorySnapshot.create({
        data: {
          userId: u.spotifyId,
          territoryId: targetTerritory,
          occupancy: 0.0,
          timestamp: day0
        }
      });
    }

    // Day 20: User Alpha converts (adopts) within 30 days
    const day20 = new Date(day0.getTime() + 20 * MS_PER_DAY);
    console.log(`[Seed] Seeding Day 20 Adoption for Alpha (Date: ${day20.toISOString().split('T')[0]})...`);
    await prisma.userTerritorySnapshot.create({
      data: {
        userId: 'mock_user_alpha',
        territoryId: targetTerritory,
        occupancy: 0.12, // adopted (>10%)
        timestamp: day20
      }
    });

    // Day 45: User Beta converts (adopts) within 60 days
    const day45 = new Date(day0.getTime() + 45 * MS_PER_DAY);
    console.log(`[Seed] Seeding Day 45 Adoption for Beta (Date: ${day45.toISOString().split('T')[0]})...`);
    await prisma.userTerritorySnapshot.create({
      data: {
        userId: 'mock_user_beta',
        territoryId: targetTerritory,
        occupancy: 0.15, // adopted (>10%)
        timestamp: day45
      }
    });

    // Day 75: User Gamma converts (adopts) within 90 days
    const day75 = new Date(day0.getTime() + 75 * MS_PER_DAY);
    console.log(`[Seed] Seeding Day 75 Adoption for Gamma (Date: ${day75.toISOString().split('T')[0]})...`);
    await prisma.userTerritorySnapshot.create({
      data: {
        userId: 'mock_user_gamma',
        territoryId: targetTerritory,
        occupancy: 0.18, // adopted (>10%)
        timestamp: day75
      }
    });

    console.log('\n[Seed] Mock seeding complete. Running cohort conversion analysis...\n');
    await runConversionAnalysis();

  } catch (err) {
    console.error('Error during historical conversions simulation:', err);
  } finally {
    console.log('\n[Clean] Cleaning up mock data from database...');
    // Clean up created records
    const mockUserIds = mockUsers.map(u => u.spotifyId);
    await prisma.userTerritorySnapshot.deleteMany({ where: { userId: { in: mockUserIds } } });
    await prisma.userTerritoryAffinitySnapshot.deleteMany({ where: { userId: { in: mockUserIds } } });
    await prisma.user.deleteMany({ where: { spotifyId: { in: mockUserIds } } });
    console.log('[Clean] Cleanup complete.');
    await prisma.$disconnect();
  }
}

main();
