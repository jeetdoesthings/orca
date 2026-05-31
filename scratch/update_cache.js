const fs = require('fs');
const path = require('path');

const CACHE_FILE_PATH = path.join(__dirname, '../src/lib/graph/orca-cache.json');
const API_KEY = '607ad853543e915b4f977a7665f394f8';
const BASE_URL = 'https://ws.audioscrobbler.com/2.0/';
const CONCURRENCY = 12; // 12 parallel requests for ~10x speedup

function calculatePopularity(listeners) {
  if (listeners <= 0) return 10;
  const score = Math.round(15 * Math.log10(listeners) - 4);
  return Math.max(10, Math.min(100, score));
}

async function fetchArtistListeners(name) {
  const queryParams = new URLSearchParams({
    method: 'artist.getInfo',
    artist: name,
    api_key: API_KEY,
    format: 'json',
  });

  try {
    const res = await fetch(`${BASE_URL}?${queryParams.toString()}`);
    if (!res.ok) return null;
    const data = await res.json();
    const listeners = data?.artist?.stats?.listeners;
    return listeners ? parseInt(listeners, 10) : null;
  } catch (err) {
    return null;
  }
}

async function updateCache() {
  if (!fs.existsSync(CACHE_FILE_PATH)) {
    console.error('Cache file not found!');
    return;
  }

  const raw = fs.readFileSync(CACHE_FILE_PATH, 'utf-8');
  const graph = JSON.parse(raw);

  console.log(`Loaded ${graph.nodes.length} nodes from cache.`);
  const defaultNodes = graph.nodes.filter(n => n.popularity === 50);
  console.log(`Found ${defaultNodes.length} nodes with default popularity of 50.`);

  let updatedCount = 0;
  let failedCount = 0;

  // Gather all indices of nodes that need updating
  const targetIndices = [];
  for (let i = 0; i < graph.nodes.length; i++) {
    if (graph.nodes[i].popularity === 50) {
      targetIndices.push(i);
    }
  }

  console.log(`Starting optimized concurrent fetching with pool size of ${CONCURRENCY}...`);

  // Process in batches of CONCURRENCY
  for (let i = 0; i < targetIndices.length; i += CONCURRENCY) {
    const batchIndices = targetIndices.slice(i, i + CONCURRENCY);
    console.log(`\n[Batch ${Math.floor(i / CONCURRENCY) + 1}/${Math.ceil(targetIndices.length / CONCURRENCY)}] Fetching ${batchIndices.length} artists...`);

    const promises = batchIndices.map(async (idx) => {
      const node = graph.nodes[idx];
      const listeners = await fetchArtistListeners(node.name);
      
      if (listeners) {
        const pop = calculatePopularity(listeners);
        node.popularity = pop;
        node.weight = Math.max(0.2, pop / 100);
        if (node.audioSignature) {
          node.audioSignature.energy = Math.max(0.1, Math.min(0.99, 0.45 + (listeners % 100)/100 * 0.3));
        }
        console.log(`  + ${node.name}: Pop -> ${pop} (Listeners: ${listeners.toLocaleString()})`);
        return true;
      } else {
        console.warn(`  x ${node.name}: Failed stats fetch`);
        return false;
      }
    });

    const results = await Promise.all(promises);
    
    results.forEach(success => {
      if (success) updatedCount++;
      else failedCount++;
    });

    // Auto-save batch progress to disk
    fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(graph, null, 2), 'utf-8');
    console.log(`[Auto-Save] Progress saved.`);

    // Short throttle between batches to avoid spamming the API
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  console.log(`\n=== Update Completed ===`);
  console.log(`Successfully updated: ${updatedCount} nodes.`);
  console.log(`Failed to update: ${failedCount} nodes.`);
  console.log(`Total nodes in cache: ${graph.nodes.length}`);
}

updateCache();
