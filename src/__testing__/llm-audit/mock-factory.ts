/**
 * Mock data factory for the LLM audit pipeline.
 *
 * Generates TasteIdentity and explored OrcaNodes from persona definitions.
 * Retrieval, LLM, and grounding run real pipeline stages — NOT mocked here.
 */
import type { TasteIdentity, TasteIdentityArtist } from '@/lib/identity/orca-identity';
import type { OrcaNode, AudioSignature } from '@/lib/graph/types';

// ─── Deterministic PRNG (mulberry32) ─────────────────────────────────

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// ─── Audio signature synthesis ────────────────────────────────────────

function synthesizeSignature(id: string, genres: string[]): AudioSignature {
  const rng = mulberry32(hashStr(id));
  const genreStr = genres.join(' ').toLowerCase();
  const isPop = /pop|dance|k-pop/.test(genreStr);
  const isMetal = /metal|death|thrash|black/.test(genreStr);
  const isAmbient = /ambient|drone|lo-fi|downtempo/.test(genreStr);
  const isJazz = /jazz|bebop|free jazz/.test(genreStr);
  const isClassical = /classical|neoclassical|baroque/.test(genreStr);

  return {
    energy: isAmbient ? 0.2 + rng() * 0.2 : isMetal ? 0.7 + rng() * 0.3 : isPop ? 0.55 + rng() * 0.3 : 0.4 + rng() * 0.3,
    valence: isAmbient ? 0.3 + rng() * 0.2 : isMetal ? 0.2 + rng() * 0.2 : isPop ? 0.6 + rng() * 0.3 : 0.35 + rng() * 0.3,
    danceability: isPop ? 0.6 + rng() * 0.3 : isMetal ? 0.2 + rng() * 0.2 : isAmbient ? 0.1 + rng() * 0.15 : 0.3 + rng() * 0.3,
    acousticness: isAmbient ? 0.5 + rng() * 0.4 : isJazz ? 0.4 + rng() * 0.3 : isClassical ? 0.7 + rng() * 0.3 : 0.2 + rng() * 0.4,
    instrumentalness: isAmbient ? 0.7 + rng() * 0.3 : isClassical ? 0.8 + rng() * 0.2 : isJazz ? 0.5 + rng() * 0.3 : 0.1 + rng() * 0.4,
    tempo: isPop ? 100 + rng() * 40 : isMetal ? 120 + rng() * 60 : isAmbient ? 60 + rng() * 40 : 90 + rng() * 50,
  };
}

// ─── Persona type (duplicated here to avoid circular import with types.ts) ──

interface PersonaInput {
  id: string;
  homeTerritory: { genres: string[]; primaryGenre: string; country?: string };
  exploredArtists: Array<{
    id: string;
    name: string;
    genres: string[];
    popularity: number;
    weight: number;
  }>;
  listeningHistory: Array<{ artistId: string; eventType: string }>;
  tasteDrift: { recentGenres: string[]; longTermGenres: string[]; driftScore: number };
}

// ─── Mock identity builder ────────────────────────────────────────────

export function buildMockIdentity(persona: PersonaInput): TasteIdentity {
  const integratedArtists: TasteIdentityArtist[] = persona.exploredArtists.map((a) => ({
    id: a.id,
    name: a.name,
    genres: a.genres,
    weight: a.weight,
    source: 'globeData',
  }));

  const genreCounts = new Map<string, number>();
  for (const a of persona.exploredArtists) {
    for (const g of a.genres) {
      genreCounts.set(g, (genreCounts.get(g) ?? 0) + a.weight);
    }
  }
  const homeGenres = Array.from(genreCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([g]) => g)
    .slice(0, 12);

  return {
    userId: `audit-${persona.id}`,
    homeTerritory: {
      genres: homeGenres,
      primaryGenre: persona.homeTerritory.primaryGenre,
      country: persona.homeTerritory.country,
    },
    exploredTerritory: {
      genres: homeGenres,
      artistCount: persona.exploredArtists.length,
    },
    integratedArtists,
    rejectedArtists: [],
    ignoredArtists: [],
    expansionHistory: [],
    listeningHistory: persona.listeningHistory.map((e) => ({
      artistId: e.artistId,
      eventType: e.eventType,
      at: new Date().toISOString(),
    })),
    currentFrontier: [],
    tasteDrift: persona.tasteDrift,
    longTermPreferences: {
      genres: Array.from(genreCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([genre, weight]) => ({ genre, weight: Math.round(weight * 1000) / 1000 })),
      artists: integratedArtists.slice(0, 60),
    },
  };
}

// ─── Mock explored nodes (input data for distance calc) ───────────────

export function buildMockExploredNodes(persona: PersonaInput): OrcaNode[] {
  return persona.exploredArtists.map((a) => ({
    id: a.id,
    name: a.name,
    genres: a.genres,
    popularity: a.popularity,
    imageUrl: '',
    weight: a.weight,
    state: 'explored' as const,
    audioSignature: synthesizeSignature(a.id, a.genres),
  }));
}
