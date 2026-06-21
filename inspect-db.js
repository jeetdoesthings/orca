const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      spotifyId: true,
      displayName: true,
      syncStatus: true,
      frontierStatus: true,
      frontierComputedAt: true,
      homeRegion: true,
      tasteSummary: true,
      frontierData: true,
    }
  });

  console.log('--- USERS IN DB ---');
  for (const user of users) {
    let frontierNodes = [];
    try {
      if (user.frontierData) {
        frontierNodes = JSON.parse(user.frontierData);
      }
    } catch (e) {}

    console.log({
      id: user.id,
      spotifyId: user.spotifyId,
      displayName: user.displayName,
      syncStatus: user.syncStatus,
      frontierStatus: user.frontierStatus,
      frontierComputedAt: user.frontierComputedAt,
      tasteSummary: user.tasteSummary,
      frontierNodesCount: frontierNodes.length,
    });
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
