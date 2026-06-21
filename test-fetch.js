const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const account = await prisma.account.findFirst();
  if (!account || !account.access_token) {
    console.log('No access token found in database.');
    return;
  }

  const token = account.access_token;
  console.log(`Using access_token: ${token.substring(0, 15)}...`);

  // Kanye West
  const artistId = '5K4W6rqBFWDnAN6FQUkS6x';
  const url = `https://api.spotify.com/v1/artists/${artistId}/related-artists`;

  console.log(`Fetching related artists for Kanye West...`);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  console.log(`Response status: ${res.status}`);
  console.log(`Response headers:`, Object.fromEntries(res.headers.entries()));

  if (!res.ok) {
    const text = await res.text();
    console.log(`Error body:`, text);
    return;
  }

  const data = await res.json();
  const artists = data.artists || [];
  console.log(`Success! Found ${artists.length} related artists.`);
  console.log('First 3:');
  console.log(artists.slice(0, 3).map(a => ({ id: a.id, name: a.name })));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
