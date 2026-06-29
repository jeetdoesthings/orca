import { PrismaClient } from '@prisma/client';
import { processListeningEvent, getTerritoryMemory } from './src/lib/tme/engine';

const prisma = new PrismaClient();

async function main() {
  console.log('=== TME V1.0 VERIFICATION ===');

  const user = await prisma.user.create({
    data: {
      email: `tme-test-${Date.now()}@test.com`,
      spotifyId: `tme-test-${Date.now()}`,
    }
  });

  const territoryId = `t-test-${Date.now()}`;
  await prisma.territory.create({
    data: {
      id: territoryId,
      version: 1,
      centroidVector: '[0,0,0]',
      size: 10,
      density: 0.5,
      cohesion: 0.5,
      stability: 0.5,
    }
  });

  const now = new Date();
  
  // Test 1: Memory Stability - Repeated passive listening (AUTOPLAY) over 1 day
  // Should NOT produce strong memories
  console.log('\n--- 1. Memory Stability Test (Passive Autoplay Binge) ---');
  for (let i = 0; i < 20; i++) {
    await processListeningEvent({
      id: `ev-stab-${i}`,
      userId: user.spotifyId,
      artistId: 'artist-stab',
      territoryId,
      trackId: 'track-stab',
      eventType: 'PLAY',
      initiationType: 'AUTOPLAY',
      timestamp: new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000 + i * 60000), // 100 days ago, binge
      durationMs: 3 * 60000,
      sessionId: 'sess-stab'
    });
  }
  
  let memStab = await getTerritoryMemory(user.spotifyId, territoryId, new Date(now.getTime() - 99 * 24 * 60 * 60 * 1000));
  console.log(`Passive Binge Memory Strength: ${memStab?.memoryStrength.toFixed(3)} | State: ${memStab?.memoryState}`);
  if (memStab && memStab.memoryStrength < 0.5) {
    console.log('✅ Passed: Passive binge did not create strong memory.');
  } else {
    console.log('❌ Failed: Passive binge created too strong a memory.');
  }

  // Clear memory for next test
  await prisma.userTerritoryMemory.deleteMany({ where: { userId: user.spotifyId } });
  await prisma.userArtistMemory.deleteMany({ where: { userId: user.spotifyId } });
  await prisma.userTrackMemory.deleteMany({ where: { userId: user.spotifyId } });

  // Test 2: Agency Test - Voluntary listening
  console.log('\n--- 2. Agency Test (Voluntary Search vs Autoplay) ---');
  for (let i = 0; i < 5; i++) {
    await processListeningEvent({
      id: `ev-ag-${i}`,
      userId: user.spotifyId,
      artistId: 'artist-ag',
      territoryId,
      trackId: 'track-ag',
      eventType: 'PLAY',
      initiationType: 'SEARCH',
      timestamp: new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000 + i * 60000), // 100 days ago, short session
      durationMs: 3 * 60000,
      sessionId: 'sess-ag'
    });
  }
  let memAg = await getTerritoryMemory(user.spotifyId, territoryId, new Date(now.getTime() - 99 * 24 * 60 * 60 * 1000));
  console.log(`Voluntary (5 plays) Memory Strength: ${memAg?.memoryStrength.toFixed(3)}`);
  if (memAg && memStab && memAg.memoryStrength > memStab.memoryStrength) {
    console.log('✅ Passed: 5 voluntary plays beat 20 passive plays.');
  } else {
    console.log('❌ Failed: Voluntary plays were weaker than passive binge.');
  }

  await prisma.userTerritoryMemory.deleteMany({ where: { userId: user.spotifyId } });
  await prisma.userArtistMemory.deleteMany({ where: { userId: user.spotifyId } });
  await prisma.userTrackMemory.deleteMany({ where: { userId: user.spotifyId } });

  // Test 3: Persistence Test - Spaced repetition
  console.log('\n--- 3. Persistence Test (Spaced Repetition) ---');
  // 5 plays spaced out by weeks
  for (let i = 0; i < 5; i++) {
    await processListeningEvent({
      id: `ev-per-${i}`,
      userId: user.spotifyId,
      artistId: 'artist-per',
      territoryId,
      trackId: 'track-per',
      eventType: 'PLAY',
      initiationType: 'SEARCH',
      timestamp: new Date(now.getTime() - (100 - i * 14) * 24 * 60 * 60 * 1000), // Spaced by 14 days
      durationMs: 3 * 60000,
      sessionId: `sess-per-${i}`
    });
  }
  let memPer = await getTerritoryMemory(user.spotifyId, territoryId, new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000));
  console.log(`Spaced Repetition (5 plays) Memory Strength: ${memPer?.memoryStrength.toFixed(3)} | Persistence: ${memPer?.persistence.toFixed(3)}`);
  if (memPer && memAg && memPer.memoryStrength > memAg.memoryStrength && memPer.persistence > memAg.persistence) {
    console.log('✅ Passed: Spaced repetition created higher persistence and strength than single session.');
  } else {
    console.log('❌ Failed: Spaced repetition did not increase persistence effectively.');
  }

  await prisma.userTerritoryMemory.deleteMany({ where: { userId: user.spotifyId } });
  await prisma.userArtistMemory.deleteMany({ where: { userId: user.spotifyId } });
  await prisma.userTrackMemory.deleteMany({ where: { userId: user.spotifyId } });

  // Test 4: Exploration Test - Deep exploration beats repetition
  console.log('\n--- 4. Exploration Test (Multiple Artists vs One Artist) ---');
  // 15 plays across 5 different artists (depth)
  for (let i = 0; i < 15; i++) {
    await processListeningEvent({
      id: `ev-exp-${i}`,
      userId: user.spotifyId,
      artistId: `artist-exp-${i % 5}`, // 5 artists
      territoryId,
      trackId: `track-exp-${i}`, // 15 tracks
      eventType: 'COMPLETE',
      initiationType: 'ARTIST_PAGE',
      timestamp: new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000 + i * 3600000), // Spaced by hours
      durationMs: 3 * 60000,
      sessionId: 'sess-exp'
    });
  }
  let memExp = await getTerritoryMemory(user.spotifyId, territoryId, new Date(now.getTime() - 99 * 24 * 60 * 60 * 1000));
  console.log(`Deep Exploration Memory Strength: ${memExp?.memoryStrength.toFixed(3)} | Depth: ${memExp?.explorationDepth.toFixed(3)}`);
  
  if (memExp && memExp.explorationDepth > 0.3) {
    console.log('✅ Passed: Multiple artists significantly increased exploration depth.');
  } else {
    console.log('❌ Failed: Exploration depth did not increase correctly.');
  }

  // Test 5: Decay Test
  console.log('\n--- 5. Decay Test ---');
  let memDecay = await getTerritoryMemory(user.spotifyId, territoryId, now); // Fast forward 100 days
  console.log(`Memory Strength 100 days later: ${memDecay?.memoryStrength.toFixed(3)} | Original: ${memExp?.memoryStrength.toFixed(3)}`);
  if (memDecay && memExp && memDecay.memoryStrength < memExp.memoryStrength && memDecay.memoryStrength > 0) {
    console.log('✅ Passed: Memory decayed gradually but did not hit absolute zero.');
  } else {
    console.log('❌ Failed: Memory decay incorrect.');
  }

  // Cleanup
  await prisma.userTerritoryMemory.deleteMany({ where: { userId: user.spotifyId } });
  await prisma.userArtistMemory.deleteMany({ where: { userId: user.spotifyId } });
  await prisma.userTrackMemory.deleteMany({ where: { userId: user.spotifyId } });
  await prisma.territory.delete({ where: { id: territoryId } });
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
