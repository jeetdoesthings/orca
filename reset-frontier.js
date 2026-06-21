const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const userId = '6ce30a74qjmcxe6u7edqrwykz';
  console.log(`Resetting sync and frontier caches in DB for user: ${userId}`);

  const user = await prisma.user.update({
    where: { spotifyId: userId },
    data: {
      syncStatus: 'PENDING',
      globeData: null,
      frontierStatus: 'PENDING',
      frontierData: null,
    },
  });

  console.log(`Reset complete. syncStatus: ${user.syncStatus}, frontierStatus: ${user.frontierStatus}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
