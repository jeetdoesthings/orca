/**
 * POST /api/orca/expand
 * Last.fm-based music discovery graph dynamic expansion.
 */
import { NextRequest, NextResponse } from 'next/server';
import { expandLastFmGraph } from '@/lib/lastfm';

const MAX_EXPAND_BATCH = 10;

export async function POST(request: NextRequest) {
  try {
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
