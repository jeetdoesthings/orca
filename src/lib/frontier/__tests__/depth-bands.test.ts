/**
 * Depth band projection + unexplored-by-territory precompute.
 */
import { describe, it, expect } from 'vitest';
import {
  applyProjectionVisibility,
  buildUnexploredByTerritory,
  depthBandForDistance,
  getDepthBandWindow,
} from '@/lib/frontier/world-projection';
import type { OrcaNode } from '@/lib/graph/types';

function node(
  id: string,
  d: number,
  opts?: Partial<OrcaNode>,
): OrcaNode {
  return {
    id,
    name: id,
    genres: opts?.genres ?? ['house'],
    popularity: 50,
    imageUrl: '',
    weight: 0.3,
    state: 'frontier',
    audioSignature: {
      energy: 0.5,
      valence: 0.5,
      danceability: 0.5,
      acousticness: 0.5,
      instrumentalness: 0.1,
      tempo: 120,
    },
    expansionDistance: d,
    reachable: opts?.reachable ?? true,
    ...opts,
  } as OrcaNode;
}

describe('depth bands', () => {
  it('maps distances to exclusive quadrants', () => {
    expect(depthBandForDistance(0.1)).toBe('shallow');
    expect(depthBandForDistance(0.3)).toBe('deeper');
    expect(depthBandForDistance(0.6)).toBe('deep');
    expect(depthBandForDistance(0.9)).toBe('deepest');
  });

  it('shallow shows only 0–25%; all shows every reachable', () => {
    const nodes = [
      node('a', 0.1),
      node('b', 0.3),
      node('c', 0.6),
      node('d', 0.9),
      node('blocked', 0.2, { reachable: false }),
    ];
    const shallow = applyProjectionVisibility(nodes, 'shallow');
    expect(shallow.find((n) => n.id === 'a')?.visible).toBe(true);
    expect(shallow.find((n) => n.id === 'b')?.visible).toBe(false);
    expect(shallow.find((n) => n.id === 'blocked')?.visible).toBe(false);

    const all = applyProjectionVisibility(nodes, 'all');
    expect(all.filter((n) => n.visible && n.id !== 'blocked').length).toBe(4);
    expect(all.find((n) => n.id === 'blocked')?.visible).toBe(false);
  });

  it('buildUnexploredByTerritory groups by primary genre', () => {
    const buckets = buildUnexploredByTerritory([
      node('1', 0.2, { genres: ['house'] }),
      node('2', 0.8, { genres: ['house'] }),
      node('3', 0.4, { genres: ['techno'] }),
      { ...node('e', 0.1), state: 'explored' } as OrcaNode,
    ]);
    expect(buckets.find((b) => b.territory === 'house')?.count).toBe(2);
    expect(buckets.find((b) => b.territory === 'techno')?.count).toBe(1);
    const house = buckets.find((b) => b.territory === 'house')!;
    expect(house.byDepth.shallow + house.byDepth.deeper + house.byDepth.deep + house.byDepth.deepest).toBe(
      house.count,
    );
  });

  it('getDepthBandWindow all covers full range', () => {
    const w = getDepthBandWindow('all');
    expect(w.min).toBe(0);
    expect(w.max).toBeGreaterThan(1);
  });
});
