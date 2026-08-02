import { describe, it, expect } from 'vitest';
import {
  diversifyExpansionDistancesIfCollapsed,
  isProtectedRetrievalPath,
} from '@/lib/frontier/stages/diversify-distances';
import type { OrcaNode } from '@/lib/graph/types';

function node(
  id: string,
  d: number,
  path?: 'adjacency' | 'shore_seek' | 'leap_seek',
): OrcaNode {
  return {
    id,
    name: id,
    genres: ['hip-hop'],
    popularity: 50,
    weight: 0.5,
    state: 'frontier',
    expansionDistance: d,
    retrievalPath: path ?? 'adjacency',
    reachable: true,
    x: 0,
    y: 0,
    z: 1,
  } as OrcaNode;
}

describe('diversifyExpansionDistancesIfCollapsed honesty', () => {
  it('protects shore_seek / leap_seek under collapse', () => {
    // Flat variance + mix of paths
    const nodes = [
      node('s1', 0.2, 'shore_seek'),
      node('s2', 0.22, 'shore_seek'),
      node('s3', 0.18, 'shore_seek'),
      node('a1', 0.21, 'adjacency'),
      node('a2', 0.21, 'adjacency'),
      node('a3', 0.21, 'adjacency'),
      node('a4', 0.2, 'adjacency'),
      node('l1', 0.19, 'leap_seek'),
    ];
    const meta = diversifyExpansionDistancesIfCollapsed(nodes);
    expect(meta.distanceVarianceCollapsed).toBe(true);
    expect(nodes.find((n) => n.id === 's1')!.expansionDistance).toBe(0.2);
    expect(nodes.find((n) => n.id === 's2')!.expansionDistance).toBe(0.22);
    expect(nodes.find((n) => n.id === 's3')!.expansionDistance).toBe(0.18);
    expect(nodes.find((n) => n.id === 'l1')!.expansionDistance).toBe(0.19);
    // Adjacency may remapped
    expect(meta.protectedCount).toBe(4);
  });

  it('isProtectedRetrievalPath only real paths', () => {
    expect(isProtectedRetrievalPath('shore_seek')).toBe(true);
    expect(isProtectedRetrievalPath('leap_seek')).toBe(true);
    expect(isProtectedRetrievalPath('adjacency')).toBe(false);
    expect(isProtectedRetrievalPath(undefined)).toBe(false);
  });
});
