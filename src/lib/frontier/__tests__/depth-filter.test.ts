import { describe, it, expect } from 'vitest';
import {
  filterFrontierByDepth,
  ensureDistanceSpread,
} from '@/lib/frontier/depth-filter';
import type { OrcaNode } from '@/lib/graph/types';

function node(id: string, d: number): OrcaNode {
  return {
    id,
    name: id,
    genres: ['pop'],
    popularity: 50,
    weight: 0.5,
    state: 'frontier',
    expansionDistance: d,
    reachable: true,
    x: 0,
    y: 0,
    z: 1,
  } as OrcaNode;
}

describe('filterFrontierByDepth', () => {
  const universe = [
    node('near', 0.1),
    node('near2', 0.2),
    node('mid', 0.45),
    node('mid2', 0.55),
    node('far', 0.75),
    node('far2', 0.9),
  ];

  it('close only keeps low distance', () => {
    const { nodes: out } = filterFrontierByDepth(universe, 'close');
    const visible = out
      .filter((n) => n.visible && n.inActiveDepth)
      .map((n) => n.id);
    expect(visible.sort()).toEqual(['near', 'near2']);
    expect(out.find((n) => n.id === 'far')!.visible).toBe(false);
  });

  it('farther only keeps high distance — close nodes gone', () => {
    const { nodes: out } = filterFrontierByDepth(universe, 'farther');
    const visible = out
      .filter((n) => n.visible && n.inActiveDepth)
      .map((n) => n.id);
    expect(visible.sort()).toEqual(['far', 'far2']);
    expect(out.find((n) => n.id === 'near')!.visible).toBe(false);
    expect(out.find((n) => n.id === 'mid')!.visible).toBe(false);
    const display = out.filter((n) => n.visible !== false);
    expect(display.map((n) => n.id).sort()).toEqual(['far', 'far2']);
    expect(display.some((n) => n.id === 'near')).toBe(false);
  });

  it('far is exclusive mid band', () => {
    const { nodes: out } = filterFrontierByDepth(universe, 'far');
    const visible = out.filter((n) => n.visible).map((n) => n.id);
    expect(visible.sort()).toEqual(['mid', 'mid2']);
  });

  it('all shows all reachable', () => {
    const { nodes: out } = filterFrontierByDepth(universe, 'all');
    expect(out.every((n) => n.visible === true)).toBe(true);
  });

  it('allowRemap=false leaves mid/far-only Close honestly empty (no fabrication)', () => {
    const midFar = [
      node('a', 0.42),
      node('b', 0.5),
      node('c', 0.58),
      node('d', 0.72),
      node('e', 0.85),
      node('f', 0.95),
    ];
    const { nodes: out, meta } = filterFrontierByDepth(midFar, 'close', {
      allowRemap: false,
    });
    const visible = out.filter((n) => n.visible && n.inActiveDepth);
    expect(visible.length).toBe(0);
    expect(meta.didRemap).toBe(false);
    expect(meta.shoreBucketFallback).toBe(false);
  });

  it('last-resort remap on empty Close sets shoreBucketFallback (not silent)', () => {
    const midFar = [
      node('a', 0.4),
      node('b', 0.5),
      node('c', 0.55),
      node('d', 0.7),
      node('e', 0.8),
      node('f', 0.9),
    ];
    const { nodes: spread, meta } = ensureDistanceSpread(midFar, {
      allowRemap: true,
    });
    expect(meta.didRemap).toBe(true);
    expect(meta.shoreBucketFallback).toBe(true);
    // Variance was real — not the collapsed path
    expect(meta.distanceVarianceCollapsed).toBe(false);
    const vals = spread.map((n) => n.expansionDistance!);
    expect(vals.some((d) => d < 0.34)).toBe(true);
  });

  it('variance collapse sets distanceVarianceCollapsed independently of shoreBucketFallback', () => {
    // All same distance → variance ~0, not "empty band" as primary trigger
    const flat = [0, 1, 2, 3, 4, 5].map((i) => node(`n${i}`, 0.5));
    const { nodes: spread, meta } = ensureDistanceSpread(flat, {
      allowRemap: true,
    });
    expect(meta.didRemap).toBe(true);
    expect(meta.distanceVarianceCollapsed).toBe(true);
    // Collapsed path returns before band-empty check — close flag must stay false
    expect(meta.shoreBucketFallback).toBe(false);
    const vals = spread.map((n) => n.expansionDistance!);
    expect(Math.max(...vals) - Math.min(...vals)).toBeGreaterThan(0.3);
  });

  it('flags fire independently: band-empty vs variance-collapse', () => {
    const midFar = [
      node('a', 0.4),
      node('b', 0.55),
      node('c', 0.7),
      node('d', 0.85),
      node('e', 0.9),
      node('f', 0.95),
    ];
    const bandEmpty = ensureDistanceSpread(midFar);
    const collapsed = ensureDistanceSpread(
      [0, 1, 2, 3, 4, 5].map((i) => node(`f${i}`, 0.5)),
    );

    expect(bandEmpty.meta.shoreBucketFallback).toBe(true);
    expect(bandEmpty.meta.distanceVarianceCollapsed).toBe(false);

    expect(collapsed.meta.distanceVarianceCollapsed).toBe(true);
    expect(collapsed.meta.shoreBucketFallback).toBe(false);

    // Distinguishable
    expect(bandEmpty.meta.shoreBucketFallback).not.toBe(
      collapsed.meta.shoreBucketFallback,
    );
    expect(bandEmpty.meta.distanceVarianceCollapsed).not.toBe(
      collapsed.meta.distanceVarianceCollapsed,
    );
  });
});
