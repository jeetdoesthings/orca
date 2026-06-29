/**
 * GET /api/orca
 * Last.fm-based music discovery graph generator with local server-side caching.
 */
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]/route';
import { getOrBuildLastFmGraph } from '@/lib/lastfm';

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    const url = new URL(request.url);
    const isDemo = url.searchParams.get('demo') === 'true';

    if (!isDemo && (!session || !session.user)) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

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
