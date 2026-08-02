import { NextRequest } from 'next/server';

/** Audit fix M1: cap proxied image size (Content-Length + post-read check). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** True when the content-type is an image (audit fix M1). */
export function isImageContentType(contentType: string | null | undefined): boolean {
  return Boolean(contentType && contentType.toLowerCase().startsWith('image/'));
}

const ALLOWED_DOMAINS = [
  'i.scdn.co',
  'mosaic.scdn.co',
  'image-cdn-ak.spotifycdn.com',
  'image-cdn-fa.spotifycdn.com',
  'spotifycdn.com',
  'scdn.co',
  'dzcdn.net',
  'cdns-images.dzcdn.net',
  'e-cdns-images.dzcdn.net',
  'deezer.com',
  'last.fm',
  'lastfm.freetls.fastly.net',
  'fastly.net',
  'audioscrobbler.com',
  'wikimedia.org',
  'upload.wikimedia.org',
  'commons.wikimedia.org',
  'wikipedia.org',
  'en.wikipedia.org',
];

export function isAllowedDomain(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const hostname = parsed.hostname.toLowerCase();
    return ALLOWED_DOMAINS.some(domain => 
      hostname === domain || hostname.endsWith('.' + domain)
    );
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  if (!url) {
    return new Response('Missing url parameter', { status: 400 });
  }

  if (!isAllowedDomain(url)) {
    return new Response('Forbidden target URL domain', { status: 403 });
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!res.ok) {
      return new Response(`Failed to fetch external image: ${res.status}`, { status: res.status });
    }

    const contentType = res.headers.get('content-type') || 'image/jpeg';

    // Audit fix M1: only proxy real images. Without this check the endpoint is
    // an open proxy for HTML/JSON/JS resources on the allow-listed domains.
    if (!isImageContentType(contentType)) {
      return new Response('Forbidden content type', { status: 400 });
    }

    // Reject oversized responses up front when the server declares a length.
    const declaredLength = parseInt(res.headers.get('content-length') || '0', 10);
    if (declaredLength > MAX_IMAGE_BYTES) {
      return new Response('Image too large', { status: 400 });
    }

    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      return new Response('Image too large', { status: 400 });
    }

    return new Response(buffer, {
      headers: {
        'Content-Type': contentType || 'image/jpeg',
        'Cache-Control': 'public, max-age=604800, s-maxage=2592000, stale-while-revalidate=86400',
        'CDN-Cache-Control': 'public, max-age=2592000',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  } catch (err) {
    console.error('Image proxy error:', err);
    return new Response('Internal error proxying image', { status: 500 });
  }
}
