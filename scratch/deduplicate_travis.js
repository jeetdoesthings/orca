const fs = require('fs');
const path = require('path');

const CACHE_FILE_PATH = path.join(__dirname, '../src/lib/graph/orca-cache.json');

function mergeTravis() {
  if (!fs.existsSync(CACHE_FILE_PATH)) {
    console.error('Cache file does not exist.');
    return;
  }

  const raw = fs.readFileSync(CACHE_FILE_PATH, 'utf8');
  const graph = JSON.parse(raw);

  const duplicateId = 'lastfm-travi--scott';
  const canonicalId = 'lastfm-travis-scott';

  const dupNode = graph.nodes.find(n => n.id === duplicateId);
  const canonNode = graph.nodes.find(n => n.id === canonicalId);

  if (!dupNode) {
    console.log(`Duplicate node "${duplicateId}" not found in cache. Already merged?`);
  }
  if (!canonNode) {
    console.error(`Canonical node "${canonicalId}" not found in cache!`);
    return;
  }

  // 1. Merge image and metrics
  if (dupNode) {
    if (dupNode.imageUrl && !canonNode.imageUrl) {
      console.log(`Copying image URL from duplicate to canonical node: ${dupNode.imageUrl}`);
      canonNode.imageUrl = dupNode.imageUrl;
    }
    // Remove the duplicate node from nodes list
    graph.nodes = graph.nodes.filter(n => n.id !== duplicateId);
    console.log(`Removed duplicate node "${duplicateId}" from nodes list.`);
  }

  // 2. Re-route edges and deduplicate
  const originalEdgeCount = graph.edges.length;
  const newEdges = [];
  const edgeKeys = new Set();

  for (const edge of graph.edges) {
    let src = typeof edge.source === 'string' ? edge.source : edge.source.id;
    let tgt = typeof edge.target === 'string' ? edge.target : edge.target.id;

    // Map duplicate ID to canonical ID
    if (src === duplicateId) src = canonicalId;
    if (tgt === duplicateId) tgt = canonicalId;

    // Prevent self-loops
    if (src === tgt) continue;

    // Create unique key for deduplication
    const min = src < tgt ? src : tgt;
    const max = src > tgt ? src : tgt;
    const key = `${min}:${max}:${edge.type}`;

    if (!edgeKeys.has(key)) {
      edgeKeys.add(key);
      newEdges.push({
        source: src,
        target: tgt,
        type: edge.type,
        weight: edge.weight
      });
    }
  }

  graph.edges = newEdges;
  console.log(`Processed edges: originally ${originalEdgeCount}, now ${graph.edges.length} after merging and deduplicating.`);

  // 3. Update genre regions
  if (graph.genres && Array.isArray(graph.genres)) {
    for (const genre of graph.genres) {
      if (genre.nodeIds && Array.isArray(genre.nodeIds)) {
        const originalNodeIds = genre.nodeIds;
        // Map duplicate ID to canonical ID
        const mappedIds = originalNodeIds.map(id => id === duplicateId ? canonicalId : id);
        // Deduplicate
        const uniqueIds = Array.from(new Set(mappedIds));
        genre.nodeIds = uniqueIds;
        genre.nodeCount = uniqueIds.length;
      }
    }
  }
  console.log('Updated genre regions with new node lists.');

  // Save the result back to file
  fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(graph, null, 2), 'utf8');
  console.log('Successfully saved merged graph to orca-cache.json.');
}

mergeTravis();
