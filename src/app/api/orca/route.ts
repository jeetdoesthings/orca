/**
 * GET /api/orca
 * Last.fm-based music discovery graph generator with local server-side caching.
 */
import { NextResponse } from 'next/server';
import { getOrBuildLastFmGraph } from '@/lib/lastfm';

export async function GET() {
  try {
    const graph = await getOrBuildLastFmGraph();
    return NextResponse.json({
      nodes: graph.nodes,
      edges: graph.edges,
      genres: graph.genres,
      source: 'lastfm-core-graph',
    });
  } catch (error) {
    console.error('Orca API error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
