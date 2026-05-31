const fs = require('fs');
const path = require('path');

const CACHE_FILE_PATH = path.join(__dirname, '../src/lib/graph/orca-cache.json');

function analyzeCache() {
  if (!fs.existsSync(CACHE_FILE_PATH)) {
    console.log('Cache file not found!');
    return;
  }

  const raw = fs.readFileSync(CACHE_FILE_PATH, 'utf-8');
  const graph = JSON.parse(raw);

  console.log('Total nodes:', graph.nodes.length);
  console.log('Total edges:', graph.edges.length);

  const popMap = {};
  graph.nodes.forEach(n => {
    popMap[n.popularity] = (popMap[n.popularity] || 0) + 1;
  });

  console.log('Popularity score distribution:');
  console.log(popMap);
}

analyzeCache();
