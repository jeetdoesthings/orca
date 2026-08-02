/**
 * Change E DoD: tier switch does not change rendered node count;
 * only tierEmphasis changes.
 */
import { describe, it, expect } from 'vitest';
import {
  applyTierEmphasis,
  applyProjectionVisibility,
  nodesInActiveTier,
} from '@/lib/frontier/world-projection';
import type { OrcaNode } from '@/lib/graph/types';

function node(
  id: string,
  bucket: 'comfort' | 'expansion' | 'leap',
): OrcaNode {
  return {
    id,
    name: id,
    genres: ['pop'],
    popularity: 50,
    weight: 0.5,
    state: 'frontier',
    expansionDistance: 0.5,
    readinessBucket: bucket,
    reachable: true,
    x: 0,
    y: 0,
    z: 0,
  } as OrcaNode;
}

describe('tier emphasis (Change E)', () => {
  const nodes: OrcaNode[] = [
    node('a', 'comfort'),
    node('b', 'comfort'),
    node('c', 'expansion'),
    node('d', 'expansion'),
    node('e', 'leap'),
    {
      id: 'explored',
      name: 'Home',
      genres: ['pop'],
      popularity: 80,
      weight: 1,
      state: 'explored',
      x: 0,
      y: 0,
      z: 0,
    } as OrcaNode,
  ];

  it('keeps array length stable; hides out-of-depth frontier', () => {
    const comfortIds = new Set(['a', 'b']);
    const c = applyTierEmphasis(nodes, 'comfort', comfortIds);
    expect(c.length).toBe(nodes.length);
    expect(c.find((n) => n.id === 'a')!.visible).toBe(true);
    expect(c.find((n) => n.id === 'e')!.visible).toBe(false);
    expect(c.find((n) => n.id === 'explored')!.visible).toBe(true);
  });

  it('raises emphasis for active bucket only', () => {
    const comfortIds = new Set(['a', 'b']);
    const c = applyTierEmphasis(nodes, 'comfort', comfortIds);
    const a = c.find((n) => n.id === 'a')!;
    const e = c.find((n) => n.id === 'e')!;
    expect(a.tierEmphasis).toBeGreaterThan(e.tierEmphasis!);
    expect(a.inActiveDepth).toBe(true);
    expect(e.inActiveDepth).toBe(false);
  });

  it('alo shows all reachable frontier', () => {
    const projected = applyTierEmphasis(nodes, 'all', 'all');
    const frontierVisible = projected.filter(
      (n) => n.state === 'frontier' && n.visible !== false,
    );
    expect(frontierVisible.length).toBe(5);
  });

  it('nodesInActiveTier returns only that bucket for cards', () => {
    const active = nodesInActiveTier(nodes, 'expansion');
    expect(active.map((n) => n.id).sort()).toEqual(['c', 'd']);
  });
});
