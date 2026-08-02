import { describe, it, expect } from 'vitest';
import { buildGraph } from '@/lib/graph/builder';
import type { OrcaNode, OrcaEdge } from '@/lib/graph/types';

function node(id: string, name: string): OrcaNode {
  return {
    id,
    name,
    genres: ['hip-hop'],
    popularity: 80,
    weight: 0.5,
    state: 'explored',
    x: 0,
    y: 0,
    z: 1,
  } as OrcaNode;
}

describe('buildGraph edge sanitization', () => {
  it('drops edges whose endpoints are missing (stale lastfm seed ids)', () => {
    const nodes = [
      node('5K4W6rqBFWDnAN6FQUkS6x', 'Kanye West'),
      node('0Y5tJX1MQlPlqiwlOH1tJY', 'Travis Scott'),
    ];
    const edges: OrcaEdge[] = [
      {
        id: 'e1',
        source: '0Y5tJX1MQlPlqiwlOH1tJY',
        target: 'lastfm-kanyewest', // stale — not a node id
        weight: 0.5,
        type: 'genre',
      } as OrcaEdge,
      {
        id: 'e2',
        source: '0Y5tJX1MQlPlqiwlOH1tJY',
        target: '5K4W6rqBFWDnAN6FQUkS6x',
        weight: 0.8,
        type: 'audio-similar',
      } as OrcaEdge,
    ];

    const g = buildGraph(nodes, edges);
    // lastfm-kanyewest remapped via name → Spotify Kanye id, so both may survive if alias works
    const targets = g.edges.map((e) =>
      typeof e.target === 'string' ? e.target : e.target.id,
    );
    expect(targets.every((t) => nodes.some((n) => n.id === t))).toBe(true);
    expect(g.edges.length).toBeGreaterThanOrEqual(1);
    expect(g.edges.some((e) => {
      const t = typeof e.target === 'string' ? e.target : e.target.id;
      return t === 'lastfm-kanyewest';
    })).toBe(false);
  });
});
