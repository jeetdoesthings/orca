import { prisma } from '../src/lib/prisma';
import { computeAndStoreFrontier } from '../src/lib/frontier/computeAndStoreFrontier';

async function main() {
  const u = await prisma.user.findFirst({
    where: { syncStatus: 'COMPLETE' }
  });
  if (!u) {
    console.log('No complete user found');
    return;
  }
  console.log('Recomputing frontier for user:', u.spotifyId);
  const nodes = JSON.parse(u.globeData).nodes || [];
  await computeAndStoreFrontier(u.spotifyId, nodes, 'mock_token');
  console.log('Done!');
}

main().catch(console.error);
