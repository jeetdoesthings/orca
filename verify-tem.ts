import { PrismaClient } from '@prisma/client';
import { calculateTEM } from './src/lib/metrics/tem';

const prisma = new PrismaClient();

async function main() {
  console.log('=== TEM V2.0 VERIFICATION ===');

  // Create a mock user
  const user = await prisma.user.create({
    data: {
      email: `tem-test-${Date.now()}@test.com`,
      spotifyId: `tem-test-${Date.now()}`,
    }
  });

  console.log(`Created test user: ${user.id}`);

  // Create a mock territory
  const territory = await prisma.territory.create({
    data: {
      id: `t-test-${Date.now()}`,
      version: 1,
      centroidVector: '[0,0,0]',
      size: 10,
      density: 0.5,
      cohesion: 0.5,
      stability: 0.5,
    }
  });

  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const baselineDate = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000);

  // 1. One baseline event (foreignness penalty will be small)
  await prisma.userListeningEvent.create({
    data: {
      userId: user.spotifyId,
      artistId: 'artist-1',
      territoryId: territory.id,
      eventType: 'PLAY',
      initiationType: 'SEARCH',
      durationMs: 3 * 60000,
      timestamp: baselineDate,
      sessionId: 'sess-baseline'
    }
  });

  // 2. Evaluation events - simulating strong meaningful adoption over multiple weeks
  const evalEvents = [
    { type: 'PLAY', init: 'SEARCH', offsetDays: 80, duration: 15 },
    { type: 'COMPLETE', init: 'PLAYLIST', offsetDays: 70, duration: 15 },
    { type: 'SAVE', init: 'ARTIST_PAGE', offsetDays: 50, duration: 10 },
    { type: 'PLAYLIST_ADD', init: 'SEARCH', offsetDays: 30, duration: 10 },
    { type: 'COMPLETE', init: 'VOLUNTARY_REVISIT', offsetDays: 10, duration: 10 },
    { type: 'COMPLETE', init: 'VOLUNTARY_REVISIT', offsetDays: 5, duration: 10 },
    { type: 'PLAY', init: 'VOLUNTARY_REVISIT', offsetDays: 1, duration: 10 }
  ];

  for (let i = 0; i < evalEvents.length; i++) {
    const ev = evalEvents[i];
    await prisma.userListeningEvent.create({
      data: {
        userId: user.spotifyId,
        artistId: `artist-${i % 3}`, // multiple artists
        territoryId: territory.id,
        eventType: ev.type,
        initiationType: ev.init,
        durationMs: ev.duration * 60000,
        timestamp: new Date(now.getTime() - ev.offsetDays * 24 * 60 * 60 * 1000),
        sessionId: `sess-eval-${i}`
      }
    });
  }

  console.log('Running TEM calculation...');
  const result = await calculateTEM(user.spotifyId, now);
  console.log('\n--- TEM RESULT ---');
  console.log(JSON.stringify(result, null, 2));

  if (result.score > 0.05 && result.adoptedTerritories === 1) {
    console.log('\n✅ Verification passed: Strong adoption resulted in positive TEM score.');
  } else {
    console.error('\n❌ Verification failed: Unexpected TEM score.');
  }

  // Cleanup
  await prisma.userListeningEvent.deleteMany({ where: { userId: user.spotifyId } });
  await prisma.territory.delete({ where: { id: territory.id } });
  await prisma.user.delete({ where: { id: user.id } });
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
