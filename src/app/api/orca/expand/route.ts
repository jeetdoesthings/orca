import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../auth/[...nextauth]/route';
import { expandLastFmGraph } from '@/lib/lastfm';

const MAX_EXPAND_BATCH = 10;

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const url = new URL(request.url);
    const isDemo = url.searchParams.get('demo') === 'true';

    if (!isDemo && (!session || !session.user)) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const body = await request.json();
    const artistIds: string[] = (body.artistIds || []).slice(0, MAX_EXPAND_BATCH);

    if (artistIds.length === 0) {
      return NextResponse.json({ nodes: [], edges: [] });
    }

    const { nodes, edges } = await expandLastFmGraph(artistIds, 8);

    return NextResponse.json({
      nodes,
      edges,
      source: 'lastfm-dynamic-expansion',
    });
  } catch (error) {
    console.error('Expand API error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
