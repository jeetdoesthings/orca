const fs = require('fs');
const path = require('path');

const IDENTITY_FILE_PATH = path.join(__dirname, '../src/lib/identity.ts');
const CACHE_FILE_PATH = path.join(__dirname, '../src/lib/graph/orca-cache.json');

// ── Dynamically Parse ALIAS_MAP from identity.ts to ensure 100% accurate sync ──
function loadAliasMap() {
  if (!fs.existsSync(IDENTITY_FILE_PATH)) {
    throw new Error(`identity.ts not found at: ${IDENTITY_FILE_PATH}`);
  }

  const content = fs.readFileSync(IDENTITY_FILE_PATH, 'utf8');
  // Match the ALIAS_MAP object literal
  const match = content.match(/const ALIAS_MAP:\s*Record<string,\s*string>\s*=\s*({[\s\S]*?});/);
  if (!match) {
    throw new Error('Failed to parse ALIAS_MAP from identity.ts using regex.');
  }

  // Clean comments and newlines to parse safely
  const cleanObjectStr = match[1]
    .replace(/\/\/.*$/gm, '') // strip single line comments
    .replace(/\/\*[\s\S]*?\*\//g, '') // strip multi-line comments
    .replace(/[\r\n]/g, ' '); // collapse to single line

  try {
    return eval(`(${cleanObjectStr})`);
  } catch (err) {
    throw new Error(`Failed to parse alias map JavaScript: ${err.message}`);
  }
}

const ALIAS_MAP = loadAliasMap();
console.log(`[DEDUP] Successfully loaded ${Object.keys(ALIAS_MAP).length} aliases dynamically from identity.ts.`);

function getStandardisedComparisonKey(name) {
  if (!name) return '';
  return name
    .trim()
    .toLowerCase()
    .replace(/\$/g, 's')
    .replace(/&/g, 'and')
    .replace(/\+/g, 'and')
    .replace(/[^a-z0-9]/g, '');
}

const STANDARDISED_ALIAS_MAP = {};
Object.entries(ALIAS_MAP).forEach(([key, value]) => {
  const stdKey = getStandardisedComparisonKey(key);
  if (stdKey) {
    STANDARDISED_ALIAS_MAP[stdKey] = value;
  }
});

function getCanonicalArtistName(name) {
  const cleanName = name.trim();
  const stdKey = getStandardisedComparisonKey(cleanName);

  if (STANDARDISED_ALIAS_MAP[stdKey]) {
    return STANDARDISED_ALIAS_MAP[stdKey];
  }

  const splitPattern = /\s+(?:&|and|feat\.?|featuring|with|vs\.?)\s+|,\s+/i;
  if (splitPattern.test(cleanName)) {
    const parts = cleanName.split(splitPattern);
    for (const part of parts) {
      const partStdKey = getStandardisedComparisonKey(part);
      if (STANDARDISED_ALIAS_MAP[partStdKey]) {
        return STANDARDISED_ALIAS_MAP[partStdKey];
      }
    }
    if (parts[0]) return parts[0].trim();
  }

  return cleanName;
}

function getCanonicalArtistId(name) {
  const canonical = getCanonicalArtistName(name);
  const stdKey = getStandardisedComparisonKey(canonical);
  return 'lastfm-' + stdKey;
}

function runGlobalDeduplication() {
  if (!fs.existsSync(CACHE_FILE_PATH)) {
    console.error(`Cache file not found at: ${CACHE_FILE_PATH}`);
    return;
  }

  const raw = fs.readFileSync(CACHE_FILE_PATH, 'utf8');
  const graph = JSON.parse(raw);

  console.log(`[DEDUP] Read cache with ${graph.nodes.length} nodes and ${graph.edges.length} edges.`);

  // 1. Group nodes by their new canonical ID
  const nodeGroups = new Map();
  const idMappings = new Map(); // oldId -> newId

  for (const node of graph.nodes) {
    const newId = getCanonicalArtistId(node.name);
    idMappings.set(node.id, newId);

    if (!nodeGroups.has(newId)) {
      nodeGroups.set(newId, []);
    }
    nodeGroups.get(newId).push(node);
  }

  // 2. Merge nodes in each group
  const mergedNodes = [];
  let mergeCount = 0;

  for (const [newId, group] of nodeGroups.entries()) {
    if (group.length === 1) {
      const node = group[0];
      node.id = newId;
      node.name = getCanonicalArtistName(node.name);
      mergedNodes.push(node);
    } else {
      mergeCount++;
      console.log(`[DEDUP] Merging duplicate group for ID "${newId}" (${group.length} nodes):`);
      group.forEach(n => console.log(`  - "${n.name}" (ID: ${n.id}, image: ${n.imageUrl ? 'YES' : 'NO'}, popularity: ${n.popularity || 'None'})`));

      // Choose a primary node in the group to base merging on (prefer explored and high popularity)
      const primary = group.sort((a, b) => {
        const stateOrder = { explored: 0, frontier: 1, dormant: 2 };
        if (stateOrder[a.state] !== stateOrder[b.state]) {
          return stateOrder[a.state] - stateOrder[b.state];
        }
        return (b.popularity || 0) - (a.popularity || 0);
      })[0];

      const mergedNode = {
        id: newId,
        name: getCanonicalArtistName(primary.name),
        genres: Array.from(new Set(group.flatMap(n => n.genres || []))),
        popularity: Math.max(...group.map(n => n.popularity || 0)),
        imageUrl: group.map(n => n.imageUrl).find(url => !!url) || '', // Grab first non-empty imageUrl!
        weight: Math.max(...group.map(n => n.weight || 0.1)),
        state: group.some(n => n.state === 'explored') ? 'explored' : 'frontier',
        audioSignature: primary.audioSignature || group.find(n => !!n.audioSignature)?.audioSignature
      };

      console.log(`  => RESULT: "${mergedNode.name}" (ID: ${mergedNode.id}, image: ${mergedNode.imageUrl ? 'YES' : 'NO'}, popularity: ${mergedNode.popularity})`);
      mergedNodes.push(mergedNode);
    }
  }

  console.log(`[DEDUP] Merged ${graph.nodes.length} nodes into ${mergedNodes.length} canonical nodes (eliminated ${mergeCount} duplicate groups).`);

  // 3. Map edges and deduplicate
  const mergedEdges = [];
  const edgeKeys = new Set();
  let selfLoopCount = 0;

  for (const edge of graph.edges) {
    const oldSrc = typeof edge.source === 'string' ? edge.source : edge.source.id;
    const oldTgt = typeof edge.target === 'string' ? edge.target : edge.target.id;

    const src = idMappings.get(oldSrc) || getCanonicalArtistId(oldSrc);
    const tgt = idMappings.get(oldTgt) || getCanonicalArtistId(oldTgt);

    if (src === tgt) {
      selfLoopCount++;
      continue; // Filter self-loops
    }

    const min = src < tgt ? src : tgt;
    const max = src > tgt ? src : tgt;
    const key = `${min}:${max}:${edge.type}`;

    if (!edgeKeys.has(key)) {
      edgeKeys.add(key);
      mergedEdges.push({
        source: src,
        target: tgt,
        type: edge.type,
        weight: edge.weight
      });
    }
  }

  console.log(`[DEDUP] Mapped edges: originally ${graph.edges.length}, now ${mergedEdges.length} after merging, self-loop filtering (-${selfLoopCount}), and deduplication.`);

  // 4. Update genre regions
  if (graph.genres && Array.isArray(graph.genres)) {
    for (const genre of graph.genres) {
      if (genre.nodeIds && Array.isArray(genre.nodeIds)) {
        const originalNodeIds = genre.nodeIds;
        const mappedIds = originalNodeIds.map(id => idMappings.get(id) || getCanonicalArtistId(id));
        const uniqueIds = Array.from(new Set(mappedIds));
        genre.nodeIds = uniqueIds;
        genre.nodeCount = uniqueIds.length;
      }
    }
    console.log('[DEDUP] Updated genre regions with canonical IDs.');
  }

  // 5. Write back to cache file
  const updatedGraph = {
    nodes: mergedNodes,
    edges: mergedEdges,
    genres: graph.genres
  };

  fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(updatedGraph, null, 2), 'utf8');
  console.log('[DEDUP] Successfully wrote clean, fully deduplicated graph to orca-cache.json!');
}

runGlobalDeduplication();
