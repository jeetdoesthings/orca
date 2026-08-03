/**
 * Collaboration-name splitting (user-reported: "21 Savage & Metro Boomin"
 * appearing as its own artist alongside "21 Savage").
 */
import { describe, it, expect } from 'vitest';
import { splitCollabName } from '@/lib/artists/enrich-identity';

describe('splitCollabName', () => {
  it('splits collaboration names on separators (purely syntactic)', () => {
    expect(splitCollabName('21 Savage & Metro Boomin')).toEqual(['21 Savage', 'Metro Boomin']);
    expect(splitCollabName('JAY-Z & Kanye West')).toEqual(['JAY-Z', 'Kanye West']);
    expect(splitCollabName('Hans Zimmer & James Newton Howard')).toEqual(['Hans Zimmer', 'James Newton Howard']);
    expect(splitCollabName('Drake feat. Future')).toEqual(['Drake', 'Future']);
    expect(splitCollabName('A with B')).toEqual(['A', 'B']);
    expect(splitCollabName('A vs B')).toEqual(['A', 'B']);
    // Band names split syntactically too — protection happens at the resolver
    // level (a collab only merges when a part exists as a solo Artist row).
    expect(splitCollabName('Chase & Status')).toEqual(['Chase', 'Status']);
    expect(splitCollabName('Mumford & Sons')).toEqual(['Mumford', 'Sons']);
    expect(splitCollabName('Above & Beyond')).toEqual(['Above', 'Beyond']);
  });

  it('returns [] for single names without separators', () => {
    expect(splitCollabName('Kanye West')).toEqual([]);
    expect(splitCollabName('')).toEqual([]);
    expect(splitCollabName('  ')).toEqual([]);
  });

  it('does not split names with & glued to words (Soap&Skin, W&W)', () => {
    // No spaces around & means it's part of the act's name, not a feature.
    expect(splitCollabName('Soap&Skin')).toEqual([]);
    expect(splitCollabName('W&W')).toEqual([]);
  });
});
