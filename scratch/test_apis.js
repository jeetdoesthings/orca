async function testDeezer(artist) {
  try {
    const url = `https://api.deezer.com/search/artist?q=${encodeURIComponent(artist)}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.log('Deezer Error Status:', res.status);
      return null;
    }
    const data = await res.json();
    const item = data?.data?.[0];
    if (!item) {
      console.log('Deezer: No artist found for', artist);
      return null;
    }
    console.log('Deezer Result for', artist, ':');
    console.log('  Name:', item.name);
    console.log('  Picture S (56px):', item.picture_small);
    console.log('  Picture M (120px):', item.picture_medium);
    console.log('  Picture L (250px):', item.picture_big);
    console.log('  Picture XL (1000px):', item.picture_xl);
    console.log('  Nb Fan:', item.nb_fan);
    return item.picture_medium || null;
  } catch (err) {
    console.error('Deezer failed:', err.message);
    return null;
  }
}

async function run() {
  const artists = ['Taylor Swift', 'The Beatles', 'Radiohead', 'NonExistentArtistXYZ123'];
  for (const a of artists) {
    await testDeezer(a);
  }
}

run();
