import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

export async function GET(
  request: Request,
  props: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    // Handle both Sync and Async params (Next.js 15+ compatibility)
    const resolvedParams = 'then' in props.params ? await props.params : props.params;
    const artistId = resolvedParams.id;
    const accessToken = session.spotifyAccessToken;
    const country = (session.user as any).country || 'US';

    if (!artistId) {
      return NextResponse.json({ error: 'Missing artist id' }, { status: 400 });
    }

    // Query Spotify for artist's top tracks
    const url = `https://api.spotify.com/v1/artists/${artistId}/top-tracks?market=${country}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') || '2', 10);
      return new NextResponse('Too Many Requests', {
        status: 429,
        headers: { 'Retry-After': retryAfter.toString() },
      });
    }

    if (!res.ok) {
      return NextResponse.json({ previewUrl: null });
    }

    const data = await res.json();
    const tracks = data.tracks || [];

    // Find first track containing a valid preview URL
    const trackWithPreview = tracks.find((t: any) => t.preview_url);

    if (!trackWithPreview) {
      return NextResponse.json({ previewUrl: null });
    }

    return NextResponse.json(
      { previewUrl: trackWithPreview.preview_url },
      {
        headers: {
          'Cache-Control': 'public, max-age=86400', // Cache preview URLs for 24 hours per spec
        },
      }
    );
  } catch (error) {
    console.error('[API artist preview] GET Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
