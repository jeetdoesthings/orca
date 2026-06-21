const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function refreshSpotifyToken(refreshToken) {
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(
        `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
      ).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  const data = await response.json();
  if (!response.ok) throw data;
  return data.access_token;
}

async function main() {
  const user = await prisma.user.findFirst();
  if (!user || !user.globeData) {
    console.log('No user or globeData.');
    return;
  }

  const account = await prisma.account.findFirst({
    where: { userId: user.id }
  });

  if (!account || !account.refresh_token) {
    console.log('No refresh token.');
    return;
  }

  console.log('Refreshing Spotify token...');
  const freshToken = await refreshSpotifyToken(account.refresh_token);
  console.log(`Fresh Token: ${freshToken.substring(0, 15)}...`);

  // Update in DB so the app can also use it
  await prisma.account.update({
    where: { id: account.id },
    data: { access_token: freshToken }
  });

  const parsed = JSON.parse(user.globeData);
  const explored = parsed.nodes || [];
  console.log(`Loaded ${explored.length} explored nodes.`);

  console.log('Computing and saving frontier nodes directly to database...');
  const { computeAndStoreFrontier } = require('../src/lib/frontier/computeAndStoreFrontier');
  await computeAndStoreFrontier(user.spotifyId, explored, freshToken);
  
  console.log('Frontier computation and database save successful!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
