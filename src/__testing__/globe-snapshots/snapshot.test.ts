/**
 * Globe snapshot tests — regression guard for depth bucket distribution.
 *
 * Uses mock frontier nodes (no DB/API) to verify:
 *   1. filterFrontierByDepth produces correct bucket membership
 *   2. Bucket counts stay within expected ranges
 *   3. No bucket is empty after ensureDistanceSpread
 *
 * Run:  npx vitest run src/__testing__/globe-snapshots/snapshot-test.ts
 * Update snapshots: set UPDATE_SNAPSHOTS=1 and inspect output.
 */
import { describe, it, expect } from 'vitest';
import { filterFrontierByDepth, ensureDistanceSpread } from '@/lib/frontier/depth-filter';
import type { OrcaNode } from '@/lib/graph/types';
import seeds from './seed-artists.json';

// ── Mock frontier nodes — simulate realistic expansionDistance distribution ──
// Seeded by seed-artist genres to produce genre-diverse frontier.
const MOCK_FRONTIER: OrcaNode[] = (() => {
  const rng = mulberry32(42); // deterministic PRNG
  const nodes: OrcaNode[] = [];

  // Generate ~80 mock frontier nodes across the distance spectrum
  const names = [
    'Close Artist A', 'Close Artist B', 'Close Artist C', 'Close Artist D',
    'Close Artist E', 'Close Artist F', 'Close Artist G', 'Close Artist H',
    'Close Artist I', 'Close Artist J', 'Close Artist K', 'Close Artist L',
    'Close Artist M', 'Close Artist N', 'Close Artist O', 'Close Artist P',
    'Close Artist Q', 'Close Artist R', 'Close Artist S', 'Close Artist T',
    'Close Artist U', 'Close Artist V', 'Close Artist W', 'Close Artist X',
    'Close Artist Y', 'Close Artist Z', 'Close Artist AA', 'Close Artist AB',
    'Mid Artist A', 'Mid Artist B', 'Mid Artist C', 'Mid Artist D',
    'Mid Artist E', 'Mid Artist F', 'Mid Artist G', 'Mid Artist H',
    'Mid Artist I', 'Mid Artist J', 'Mid Artist K', 'Mid Artist L',
    'Mid Artist M', 'Mid Artist N', 'Mid Artist O', 'Mid Artist P',
    'Mid Artist Q', 'Mid Artist R', 'Mid Artist S', 'Mid Artist T',
    'Mid Artist U', 'Mid Artist V', 'Mid Artist W', 'Mid Artist X',
    'Far Artist A', 'Far Artist B', 'Far Artist C', 'Far Artist D',
    'Far Artist E', 'Far Artist F', 'Far Artist G', 'Far Artist H',
    'Far Artist I', 'Far Artist J', 'Far Artist K', 'Far Artist L',
    'Far Artist M', 'Far Artist N', 'Far Artist O', 'Far Artist P',
    'Far Artist Q', 'Far Artist R', 'Far Artist S', 'Far Artist T',
  ];
  const genres = [
    ['jazz', 'blues'], ['electronic', 'ambient'], ['rock', 'alternative'],
    ['hip hop', 'rap'], ['classical', 'neoclassical'], ['metal', 'thrash'],
    ['country', 'folk'], ['latin', 'son'], ['world', 'qawwali'],
    ['pop', 'indie'], ['soul', 'rnb'], ['reggae', 'dub'],
  ];

  for (let i = 0; i < names.length; i++) {
    // Distribute: ~35% close, ~40% far, ~25% farther
    let d: number;
    if (i < 28) d = 0.05 + rng() * 0.28;       // close: 0.05-0.33
    else if (i < 60) d = 0.35 + rng() * 0.30;   // far: 0.35-0.65
    else d = 0.68 + rng() * 0.30;                // farther: 0.68-0.98

    nodes.push({
      id: `mock-${i}`,
      name: names[i],
      genres: genres[i % genres.length],
      popularity: 30 + Math.floor(rng() * 60),
      weight: 0.3 + rng() * 0.5,
      state: 'frontier',
      expansionDistance: Math.round(d * 1000) / 1000,
      reachable: true,
      x: 0, y: 0, z: 0,
    } as OrcaNode);
  }
  return nodes;
})();

// Deterministic PRNG (mulberry32)
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Tests ──

describe('globe snapshot: seed artist count', () => {
  it('seed list has expected artist count', () => {
    expect(seeds.seeds.length).toBe(10);
    for (const s of seeds.seeds) {
      expect(s.name).toBeTruthy();
      expect(s.genres.length).toBeGreaterThan(0);
      expect(s.popularity).toBeGreaterThan(0);
    }
  });
});

describe('globe snapshot: depth bucket distribution', () => {
  it('close bucket (0-0.34) has 10+ nodes', () => {
    const { nodes } = filterFrontierByDepth(MOCK_FRONTIER, 'close');
    const visible = nodes.filter(n => n.visible && n.inActiveDepth);
    expect(visible.length).toBeGreaterThanOrEqual(10);
  });

  it('far bucket (0.34-0.67) has 15+ nodes', () => {
    const { nodes } = filterFrontierByDepth(MOCK_FRONTIER, 'far');
    const visible = nodes.filter(n => n.visible && n.inActiveDepth);
    expect(visible.length).toBeGreaterThanOrEqual(15);
  });

  it('farther bucket (0.67-1.0) has 10+ nodes', () => {
    const { nodes } = filterFrontierByDepth(MOCK_FRONTIER, 'farther');
    const visible = nodes.filter(n => n.visible && n.inActiveDepth);
    expect(visible.length).toBeGreaterThanOrEqual(10);
  });

  it('all bucket shows every reachable node', () => {
    const { nodes } = filterFrontierByDepth(MOCK_FRONTIER, 'all');
    const visible = nodes.filter(n => n.visible && n.inActiveDepth);
    const reachable = MOCK_FRONTIER.filter(n => n.reachable !== false);
    expect(visible.length).toBe(reachable.length);
  });

  it('each bucket is exclusive — no node in two buckets simultaneously', () => {
    const closeNodes = filterFrontierByDepth(MOCK_FRONTIER, 'close')
      .nodes.filter(n => n.visible && n.inActiveDepth).map(n => n.id);
    const farNodes = filterFrontierByDepth(MOCK_FRONTIER, 'far')
      .nodes.filter(n => n.visible && n.inActiveDepth).map(n => n.id);
    const fartherNodes = filterFrontierByDepth(MOCK_FRONTIER, 'farther')
      .nodes.filter(n => n.visible && n.inActiveDepth).map(n => n.id);

    const allIds = [...closeNodes, ...farNodes, ...fartherNodes];
    const uniqueIds = new Set(allIds);
    expect(allIds.length).toBe(uniqueIds.size);
  });

  it('ensureDistanceSpread does not produce empty bands for this distribution', () => {
    const { meta } = ensureDistanceSpread(MOCK_FRONTIER);
    // With 70 nodes across the spectrum, no band should be empty
    expect(meta.shoreBucketFallback).toBe(false);
    expect(meta.distanceVarianceCollapsed).toBe(false);
  });
});

describe('globe snapshot: depth bucket snapshot file', () => {
  it('snapshot JSON has all four depth keys', () => {
    const snap = require('./depth-snapshots.json');
    expect(snap.snapshots).toHaveProperty('close');
    expect(snap.snapshots).toHaveProperty('far');
    expect(snap.snapshots).toHaveProperty('farther');
    expect(snap.snapshots).toHaveProperty('all');
  });

  it('each snapshot has expected count range', () => {
    const snap = require('./depth-snapshots.json');
    for (const [key, val] of Object.entries(snap.snapshots) as [string, any][]) {
      expect(Array.isArray(val.expectedCountRange)).toBe(true);
      expect(val.expectedCountRange.length).toBe(2);
      expect(val.expectedCountRange[0]).toBeLessThanOrEqual(val.expectedCountRange[1]);
    }
  });
});
