import { getOrBuildLastFmGraph } from '../src/lib/lastfm';

console.log('[ORCA-PREBUILD] Starting Last.fm query & graph construction...');
getOrBuildLastFmGraph()
  .then((graph) => {
    console.log(`[ORCA-PREBUILD] Successfully created graph with ${graph.nodes.length} nodes and ${graph.edges.length} edges!`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('[ORCA-PREBUILD] Construction failed:', err);
    process.exit(1);
  });
