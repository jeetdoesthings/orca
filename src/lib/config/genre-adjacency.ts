/**
 * Shared genre adjacency + system genre list.
 * Single source for ORE, CUB, GRE (P1-7 residual).
 *
 * Keys align with `InternalGenre` in genre-normaliser (layout / globe anchors)
 * so GRE metrics and globe regions share one ontology. Aliases used by older
 * ORE tags (uk-garage, grime, lo-fi-hip-hop, downtempo) map into nearest
 * InternalGenre neighbors.
 */

import type { InternalGenre } from '@/lib/graph/genre-normaliser';

/**
 * Adjacency map: each key is an InternalGenre (or a retrieval alias that
 * normaliseGenre will fold into one). Values are neighbor labels for expansion.
 */
export const GENRE_ADJACENCY: Record<string, string[]> = {
  // Hip-hop family
  'hip-hop': ['trap', 'drill', 'rnb', 'soul', 'latin'],
  trap: ['hip-hop', 'drill', 'rnb', 'dance-pop'],
  drill: ['hip-hop', 'trap', 'grime'],
  // Electronic
  edm: ['house', 'techno', 'trance', 'drum-and-bass', 'dance-pop'],
  house: ['edm', 'techno', 'dance-pop', 'ambient', 'trance'],
  techno: ['house', 'edm', 'ambient', 'trance'],
  trance: ['edm', 'house', 'techno'],
  'drum-and-bass': ['edm', 'house', 'techno'],
  // Pop
  pop: ['dance-pop', 'rnb', 'indie-rock', 'soul'],
  'dance-pop': ['pop', 'house', 'edm', 'rnb'],
  // Rock family
  rock: ['alternative-rock', 'indie-rock', 'metal', 'punk', 'folk'],
  'alternative-rock': ['rock', 'indie-rock', 'punk', 'metal'],
  'indie-rock': ['alternative-rock', 'rock', 'folk', 'pop'],
  punk: ['rock', 'alternative-rock', 'metal'],
  metal: ['rock', 'punk', 'alternative-rock'],
  // Soul / groove
  rnb: ['hip-hop', 'soul', 'pop', 'funk'],
  soul: ['rnb', 'funk', 'jazz', 'hip-hop'],
  funk: ['soul', 'rnb', 'jazz', 'hip-hop'],
  // Acoustic / global
  folk: ['country', 'indie-rock', 'classical', 'world-music'],
  country: ['folk', 'rock', 'pop'],
  ambient: ['classical', 'edm', 'techno', 'jazz'],
  classical: ['ambient', 'jazz', 'folk'],
  jazz: ['soul', 'funk', 'ambient', 'classical'],
  latin: ['pop', 'hip-hop', 'dance-pop', 'world-music'],
  'world-music': ['latin', 'folk', 'jazz', 'hip-hop'],
  // Retrieval aliases (ORE / Last.fm tags) — keep for source matching
  'uk-garage': ['house', 'drum-and-bass', 'edm', 'hip-hop'],
  grime: ['hip-hop', 'drill', 'uk-garage'],
  'lo-fi-hip-hop': ['hip-hop', 'jazz', 'ambient'],
  downtempo: ['ambient', 'house', 'jazz'],
};

/** Canonical GRE ontology: all InternalGenre layout keys (25). */
export const SYSTEM_GENRES: readonly string[] = [
  'hip-hop',
  'trap',
  'drill',
  'edm',
  'house',
  'techno',
  'trance',
  'drum-and-bass',
  'pop',
  'dance-pop',
  'rock',
  'alternative-rock',
  'indie-rock',
  'punk',
  'metal',
  'rnb',
  'soul',
  'funk',
  'folk',
  'country',
  'ambient',
  'classical',
  'jazz',
  'latin',
  'world-music',
] as const satisfies readonly InternalGenre[];
