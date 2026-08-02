import { describe, it, expect } from 'vitest';
import {
  cleanGenreTags,
  normaliseGenreOrUnknown,
  resolveArtistGenres,
  scoreGenreTag,
  normaliseGenre,
} from '@/lib/graph/genre-normaliser';

describe('cleanGenreTags', () => {
  it('drops artist self-tags, decades, vocalists', () => {
    const cleaned = cleanGenreTags(
      ['country', 'toby keith', '90s', 'male vocalists', 'contemporary country', 'pop'],
      'Toby Keith',
    );
    expect(cleaned).toContain('country');
    expect(cleaned).toContain('contemporary country');
    expect(cleaned).not.toContain('toby keith');
    expect(cleaned).not.toContain('90s');
    expect(cleaned).not.toContain('male vocalists');
  });
});

describe('score-based primary (not first-tag-wins)', () => {
  it('prefers house/techno over broad electronic for Daft Punk-like tags', () => {
    const g = normaliseGenreOrUnknown([
      'electronic',
      'house',
      'dance',
      'techno',
      'electronica',
    ]);
    expect(['house', 'techno']).toContain(g);
  });

  it('prefers metal over rock for thrash metal tags', () => {
    expect(
      normaliseGenreOrUnknown(['thrash metal', 'heavy metal', 'metal', 'hard rock', 'rock']),
    ).toBe('metal');
  });

  it('prefers alternative-rock over bare rock for Radiohead-like tags', () => {
    const g = normaliseGenreOrUnknown([
      'rock',
      'alternative',
      'alternative rock',
      'indie',
      'electronic',
    ]);
    expect(['alternative-rock', 'indie-rock']).toContain(g);
  });

  it('prefers dance-pop over bare pop for eurodance tags', () => {
    expect(
      normaliseGenreOrUnknown(['pop', 'europop', 'electronic', 'eurodance']),
    ).toBe('dance-pop');
  });

  it('prefers ambient over edm when ambient present with electronic', () => {
    expect(
      normaliseGenreOrUnknown(['electronic', 'idm', 'ambient', 'experimental', 'electronica']),
    ).toBe('ambient');
  });
});

describe('resolveArtistGenres', () => {
  it('returns primary-first clean list without artist name junk', () => {
    const resolved = resolveArtistGenres(
      ['country', 'alan jackson', 'singer-songwriter', '90s', 'my country'],
      'Alan Jackson',
    );
    expect(resolved[0]).toBe('country');
    expect(resolved.join(' ')).not.toMatch(/alan jackson/i);
    expect(resolved.join(' ')).not.toMatch(/90s/);
  });

  it('does not invent pop for empty tags', () => {
    expect(resolveArtistGenres([])).toEqual([]);
    expect(normaliseGenreOrUnknown([])).toBeNull();
    expect(normaliseGenre([])).toBe('pop'); // layout fallback only
  });
});

describe('scoreGenreTag', () => {
  it('scores specific tags higher than broad', () => {
    const house = scoreGenreTag('house')!;
    const electronic = scoreGenreTag('electronic')!;
    expect(house.score).toBeGreaterThan(electronic.score);
  });
});
