/**
 * fetch with a hard timeout. External API calls in the retrieval/enrich
 * pipeline (MusicBrainz, Last.fm, Spotify, Deezer, Wikipedia) must never hang
 * on a dead connection — a single stuck fetch would stall the whole
 * materialization for minutes and (with concurrent runs) wedge the server.
 */
export async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs = 15_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
