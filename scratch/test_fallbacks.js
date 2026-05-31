async function fetchFromDeezer(artist) {
  try {
    const url = `https://api.deezer.com/search/artist?q=${encodeURIComponent(artist)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Deezer HTTP error: ${res.status}`);
    const data = await res.json();
    const item = data?.data?.[0];
    if (!item) return null;
    return item.picture_medium || item.picture_big || null;
  } catch (err) {
    console.error('Deezer err:', err);
    return null;
  }
}

async function fetchFromWikipediaDirectSearch(artistName) {
  try {
    const wikiSearchUrl = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(artistName)}&gsrlimit=1&prop=pageimages&format=json&pithumbsize=200&origin=*`;
    const res = await fetch(wikiSearchUrl);
    if (!res.ok) return null;
    const data = await res.json();
    const pages = data?.query?.pages || {};
    const pageId = Object.keys(pages)[0];
    if (pageId && pageId !== '-1') {
      const page = pages[pageId];
      return page?.thumbnail?.source || null;
    }
    return null;
  } catch (err) {
    console.error('Wiki err:', err);
    return null;
  }
}

async function testFallbacks() {
  console.log('--- Testing Deezer for "Travis Scott" ---');
  const deezerImg = await fetchFromDeezer('Travis Scott');
  console.log('Deezer Image:', deezerImg);

  console.log('\n--- Testing Wikipedia for "Travis Scott" ---');
  const wikiImg = await fetchFromWikipediaDirectSearch('Travis Scott');
  console.log('Wikipedia Image:', wikiImg);
}

testFallbacks();
