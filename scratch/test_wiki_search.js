async function testDirectWikipediaSearch(artistName) {
  console.log(`\nTesting direct Wikipedia search for: ${artistName}...`);
  try {
    const wikiSearchUrl = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(artistName)}&gsrlimit=1&prop=pageimages&format=json&pithumbsize=500&origin=*`;
    const res = await fetch(wikiSearchUrl);
    if (!res.ok) {
      console.log('Search failed:', res.status);
      return null;
    }
    const data = await res.json();
    const pages = data?.query?.pages || {};
    const pageId = Object.keys(pages)[0];
    if (pageId && pageId !== '-1') {
      const page = pages[pageId];
      const imageUrl = page?.thumbnail?.source;
      console.log(`  Found Title: "${page.title}"`);
      console.log(`  Found Image: ${imageUrl || 'None'}`);
      return imageUrl || null;
    } else {
      console.log('  No matching Wikipedia page found.');
      return null;
    }
  } catch (err) {
    console.error('  Error:', err.message);
    return null;
  }
}

async function run() {
  await testDirectWikipediaSearch('Aphex Twin');
  await testDirectWikipediaSearch('Bicep');
  await testDirectWikipediaSearch('Charlotte de Witte');
}

run();
