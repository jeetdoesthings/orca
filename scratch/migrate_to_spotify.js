const fs = require('fs');
const path = require('path');

// Manually parse .env to load credentials
function loadEnv() {
  const envPath = path.join(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const index = trimmed.indexOf('=');
      if (index === -1) return;
      const key = trimmed.substring(0, index).trim();
      const val = trimmed.substring(index + 1).trim();
      process.env[key] = val;
    });
  }
}
loadEnv();

const CACHE_FILE_PATH = path.join(__dirname, '../src/lib/graph/orca-cache.json');
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

let cachedToken = null;
let tokenExpiresAt = 0;

async function getSpotifyToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
  
  console.log('Fetching new Spotify token...');
  const credentials = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) throw new Error(`Spotify token error: ${res.status}`);
  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchWithRetry(url, token, retries = 3) {
  for (let i = 0; i < retries; i++) {
    console.log(`  -> Fetching: ${url}`);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log(`  <- Status: ${res.status} for ${url}`);
    
    if (res.status === 429) {
      const retryAfter = res.headers.get('retry-after') || 2;
      console.log(`Rate limited! Sleeping for ${retryAfter} seconds...`);
      await sleep(retryAfter * 1000);
      continue;
    }
    
    if (!res.ok) {
      console.log(`  <- Error Body: ${await res.text()}`);
      if (i === retries - 1) return null;
      await sleep(1000);
      continue;
    }
    
    return await res.json();
  }
  return null;
}

async function migrate() {
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    console.error('Missing Spotify credentials in environment variables.');
    return;
  }

  const raw = fs.readFileSync(CACHE_FILE_PATH, 'utf-8');
  const graph = JSON.parse(raw);
  
  // We need a quick way to find nodes by name for related artists mapping
  const nodeNameMap = new Map();
  for (const node of graph.nodes) {
    nodeNameMap.set(node.name.toLowerCase().trim(), node);
  }

  const existingEdgesSet = new Set();
  for (const edge of graph.edges) {
    const src = typeof edge.source === 'string' ? edge.source : edge.source.id;
    const tgt = typeof edge.target === 'string' ? edge.target : edge.target.id;
    const min = src < tgt ? src : tgt;
    const max = src > tgt ? src : tgt;
    existingEdgesSet.add(`${min}:${max}`);
  }

  console.log(`Loaded ${graph.nodes.length} nodes and ${graph.edges.length} edges.`);

  let updatedCount = 0;
  let newEdgesCount = 0;

  const CONCURRENCY = 5; 
  // Let's loop through all nodes
  for (let i = 0; i < graph.nodes.length; i += CONCURRENCY) {
    const batch = graph.nodes.slice(i, i + CONCURRENCY);
    console.log(`Processing batch ${Math.floor(i/CONCURRENCY) + 1} / ${Math.ceil(graph.nodes.length / CONCURRENCY)}...`);
    
    const token = await getSpotifyToken();

    const promises = batch.map(async (node) => {
      // 1. Search for artist
      const searchParams = new URLSearchParams({ q: node.name, type: 'artist', limit: '1' });
      const searchData = await fetchWithRetry(`https://api.spotify.com/v1/search?${searchParams}`, token);
      
      const artist = searchData?.artists?.items?.[0];
      if (!artist) {
        console.log(`  x ${node.name}: Not found on Spotify`);
        return;
      }
      
      // Update Popularity
      node.popularity = artist.popularity;
      node.weight = Math.max(0.2, artist.popularity / 100);
      
      // Update Genres
      if (artist.genres && artist.genres.length > 0) {
        node.genres = artist.genres;
      }

      // Update Image URL if available
      if (artist.images && artist.images.length > 0) {
        // Find image with width closest to 150px - 320px for rapid downscaled loading
        const bestImage = artist.images.find(img => img.width >= 150 && img.width <= 320) || artist.images[artist.images.length - 1];
        if (bestImage && bestImage.url) {
          node.imageUrl = bestImage.url;
        }
      }
      
      updatedCount++;
    });

    await Promise.all(promises);
    
    // Save periodically
    if (i % (CONCURRENCY * 10) === 0) {
      fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(graph, null, 2));
      console.log(`[Auto-Save] Progress saved.`);
    }

    // Rate limiting precaution
    await sleep(250);
  }

  // Final save
  fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(graph, null, 2));
  console.log(`\n=== Migration Completed ===`);
  console.log(`Updated ${updatedCount} nodes.`);
  console.log(`Added ${newEdgesCount} new edges from Spotify.`);
}

migrate();
