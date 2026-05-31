async function fetchArtistImageFromPipeline(artistName) {
  console.log(`\n=== Running pipeline for: ${artistName} ===`);
  try {
    // Step 1: MusicBrainz search
    const searchUrl = `https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(artistName)}&fmt=json`;
    console.log(`Step 1: Searching MusicBrainz...`);
    const searchRes = await fetch(searchUrl, {
      headers: { 'User-Agent': 'MusicOrca/1.0.0 ( jeetdoesthings@example.com )' }
    });
    
    if (!searchRes.ok) {
      console.log(`MusicBrainz search failed: ${searchRes.status}`);
      return null;
    }
    
    const searchData = await searchRes.json();
    const artist = searchData?.artists?.[0];
    if (!artist) {
      console.log(`No MusicBrainz artist found.`);
      return null;
    }
    
    console.log(`Found MBID: ${artist.id} for "${artist.name}"`);
    
    // Step 2: Fetch artist details and url relations
    console.log(`Step 2: Fetching relations for MBID...`);
    const detailsUrl = `https://musicbrainz.org/ws/2/artist/${artist.id}?inc=url-rels&fmt=json`;
    const detailsRes = await fetch(detailsUrl, {
      headers: { 'User-Agent': 'MusicOrca/1.0.0 ( jeetdoesthings@example.com )' }
    });
    
    if (!detailsRes.ok) {
      console.log(`MusicBrainz details fetch failed: ${detailsRes.status}`);
      return null;
    }
    
    const detailsData = await detailsRes.json();
    const relations = detailsData?.relations || [];
    
    let wikipediaUrl = '';
    let wikidataUrl = '';
    
    for (const rel of relations) {
      if (rel.type === 'wikipedia' || rel.url?.resource?.includes('wikipedia.org')) {
        wikipediaUrl = rel.url.resource;
      }
      if (rel.type === 'wikidata' || rel.url?.resource?.includes('wikidata.org')) {
        wikidataUrl = rel.url.resource;
      }
    }
    
    console.log(`Wikipedia link: ${wikipediaUrl}`);
    console.log(`Wikidata link: ${wikidataUrl}`);
    
    // Step 3: Fetch image from Wikidata or Wikipedia
    // Let's try Wikipedia first if we have a Wikipedia link
    if (wikipediaUrl) {
      console.log(`Step 3: Querying Wikipedia pageimages API...`);
      // Extract title from wikipedia URL (e.g. https://en.wikipedia.org/wiki/Michael_Jackson)
      const parts = wikipediaUrl.split('/wiki/');
      if (parts.length > 1) {
        const title = decodeURIComponent(parts[1]);
        const wikiApiUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=pageimages&format=json&pithumbsize=500&origin=*`;
        
        const wikiRes = await fetch(wikiApiUrl);
        if (wikiRes.ok) {
          const wikiData = await wikiRes.json();
          const pages = wikiData?.query?.pages || {};
          const pageId = Object.keys(pages)[0];
          if (pageId && pageId !== '-1') {
            const thumbnail = pages[pageId]?.thumbnail?.source;
            if (thumbnail) {
              console.log(`Success via Wikipedia! Image URL: ${thumbnail}`);
              return thumbnail;
            }
          }
        }
      }
    }
    
    // Fallback: Try Wikidata if we have a wikidata link
    if (wikidataUrl) {
      console.log(`Step 3 Fallback: Querying Wikidata API...`);
      const qid = wikidataUrl.split('/wiki/')[1] || wikidataUrl.split('/entity/')[1];
      if (qid) {
        const wikidataApiUrl = `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${qid}&property=P18&format=json&origin=*`;
        const wdRes = await fetch(wikidataApiUrl);
        if (wdRes.ok) {
          const wdData = await wdRes.json();
          const imageClaim = wdData?.claims?.P18?.[0];
          const fileName = imageClaim?.mainsnak?.datavalue?.value;
          if (fileName) {
            const commonsUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fileName)}`;
            console.log(`Success via Wikidata! File name: ${fileName}`);
            console.log(`Commons Special:FilePath URL: ${commonsUrl}`);
            return commonsUrl;
          }
        }
      }
    }
    
    console.log(`Failed to resolve image via pipeline.`);
    return null;
  } catch (err) {
    console.error(`Pipeline error:`, err);
    return null;
  }
}

async function run() {
  await fetchArtistImageFromPipeline('Michael Jackson');
  await fetchArtistImageFromPipeline('Travis Scott');
  await fetchArtistImageFromPipeline('Taylor Swift');
}

run();
