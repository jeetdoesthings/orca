/**
 * Part 14 — sidecar contract + soft fallback when down.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  embedPreviewFromService,
  isEmbeddingSidecarReady,
  DEFAULT_EMBEDDING_MODEL_ID,
} from '@/lib/audio/embedder';
import { getOrComputeTrackEmbedding } from '@/lib/audio/embedding-cache';
import { prisma } from '@/lib/prisma';

describe('embedding sidecar client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ORCA_EMBEDDING_URL;
    delete process.env.ORCA_EMBEDDING_ALLOW_MOCK;
  });

  it('returns null when ORCA_EMBEDDING_URL unset (no throw)', async () => {
    delete process.env.ORCA_EMBEDDING_URL;
    const r = await embedPreviewFromService('https://example.com/p.mp3');
    expect(r).toBeNull();
    expect(await isEmbeddingSidecarReady()).toBe(false);
  });

  it('returns null when sidecar unreachable (fallback path)', async () => {
    process.env.ORCA_EMBEDDING_URL = 'http://127.0.0.1:59999';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    const r = await embedPreviewFromService('https://example.com/p.mp3');
    expect(r).toBeNull();
  });

  it('maps successful /embed to high_confidence EmbeddingResult', async () => {
    process.env.ORCA_EMBEDDING_URL = 'http://embed.test';
    const vector = Array.from({ length: 8 }, (_, i) => i * 0.1);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).endsWith('/health')) {
          return {
            ok: true,
            json: async () => ({ ok: true, mode: 'stub', modelId: DEFAULT_EMBEDDING_MODEL_ID }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            vector,
            dim: 8,
            modelId: DEFAULT_EMBEDDING_MODEL_ID,
          }),
        };
      }),
    );

    expect(await isEmbeddingSidecarReady()).toBe(true);
    const emb = await embedPreviewFromService('https://cdn.example/preview.mp3');
    expect(emb).not.toBeNull();
    expect(emb!.confidenceTag).toBe('high_confidence');
    expect(emb!.vector).toEqual(vector);
    expect(emb!.modelId).toBe(DEFAULT_EMBEDDING_MODEL_ID);
  });

  it('getOrComputeTrackEmbedding caches high_confidence from sidecar once', async () => {
    process.env.ORCA_EMBEDDING_URL = 'http://embed.test';
    const trackKey = `test-sidecar:${Date.now()}`;
    const vector = Array.from({ length: 4 }, () => 0.25);
    let embedCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        embedCalls++;
        return {
          ok: true,
          json: async () => ({
            vector,
            dim: 4,
            modelId: 'clap-http-v1',
          }),
        };
      }),
    );

    const first = await getOrComputeTrackEmbedding({
      trackKey,
      previewUrl: 'https://cdn.example/a.mp3',
      modelId: 'clap-http-v1',
    });
    expect(first?.confidenceTag).toBe('high_confidence');
    expect(first?.cacheHit).toBe(false);

    const second = await getOrComputeTrackEmbedding({
      trackKey,
      previewUrl: 'https://cdn.example/a.mp3',
      modelId: 'clap-http-v1',
    });
    expect(second?.cacheHit).toBe(true);
    // Second call should not hit network for embed (cache)
    expect(embedCalls).toBe(1);

    await prisma.trackEmbedding.deleteMany({ where: { trackKey } });
  });
});
