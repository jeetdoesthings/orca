import { prisma } from '@/lib/prisma';
import { getCanonicalArtistName } from '@/lib/identity';
import type { AudioSignature } from '@/lib/graph/types';
import { getActiveTraits } from '@/lib/profile/trait-registry';
import { computeTraitScore } from '@/lib/profile/trait-inference';

// ─── Fusion Config ───────────────────────────────────────────────────
export const FUSION_CONFIG = {
  weights: {
    audio: 0.4,
    text: 0.2,
    trait: 0.3,
    structural: 0.1,
  },
  version: 1,
  normalizationVersion: 1,
};

// ─── Normalization Helper ────────────────────────────────────────────
/**
 * L2 normalize a numerical vector.
 */
export function l2Normalize(vector: number[]): number[] {
  const squaredSum = vector.reduce((sum, val) => sum + val * val, 0);
  const magnitude = Math.sqrt(squaredSum);
  if (magnitude === 0) return vector.map(() => 0);
  return vector.map(val => val / magnitude);
}

// ─── Keyword Semantic Embedder ──────────────────────────────────────
export interface TextEmbeddingModel {
  embed(text: string): Promise<number[]>;
}

/**
 * A self-contained, deterministic keyword-based text embedding generator (8D).
 * It classifies text based on thematic keyword frequencies and L2 normalizes.
 */
export class KeywordHashingEmbeddingModel implements TextEmbeddingModel {
  private dimensionKeywords = [
    // Dim 0: Electronic / Synth / Club / Dance / Beats
    ['electronic', 'synth', 'dance', 'house', 'techno', 'edm', 'club', 'beat', 'groove', 'synthesizer', 'synthesized'],
    // Dim 1: Acoustic / Folk / Organic / Singer-songwriter
    ['acoustic', 'folk', 'guitar', 'piano', 'organic', 'singer-songwriter', 'country', 'vocal', 'vocals', 'instrumental', 'unplugged'],
    // Dim 2: Heavy / Distortion / Aggressive / Rock / Metal
    ['rock', 'metal', 'distorted', 'aggression', 'heavy', 'guitar solo', 'drums', 'punk', 'hardcore', 'screaming', 'loud'],
    // Dim 3: Introspective / Contemplative / Atmospheric / Ambient / Spacious
    ['ambient', 'contemplative', 'introspective', 'contemplation', 'moody', 'atmospheric', 'spacious', 'space', 'cinematic', 'reverb', 'quiet', 'calm'],
    // Dim 4: Pop / Melodic / Catchy / Bright
    ['pop', 'melodic', 'catchy', 'bright', 'sweet', 'uplifting', 'hook', 'mainstream', 'sing-along', 'infectious', 'cheerful'],
    // Dim 5: Dark / Melancholic / Gloomy / Somber
    ['dark', 'melancholic', 'gloomy', 'somber', 'sad', 'heartbroken', 'minor key', 'brooding', 'lonely', 'mournful', 'melancholy'],
    // Dim 6: Experimental / Boundary-pushing / Avant-garde / Noise
    ['experimental', 'avant-garde', 'boundary', 'noise', 'unconventional', 'weird', 'improvisation', 'niche', 'glitch', 'noisy'],
    // Dim 7: Hip-hop / Rap / Urban / Rhythmic / Spoken word
    ['hip-hop', 'hip hop', 'rap', 'rhythm', 'rhythmic', 'vocals', 'flow', 'spoken', 'street', 'lyrical', 'mc', 'urban']
  ];

  async embed(text: string): Promise<number[]> {
    const cleanText = text.toLowerCase();
    const counts = this.dimensionKeywords.map(words => {
      let count = 0;
      words.forEach(word => {
        // Escaping helper for safe RegExp creation
        const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${escapedWord}\\b`, 'gi');
        const matches = cleanText.match(regex);
        if (matches) {
          count += matches.length;
        }
      });
      return count;
    });

    const total = counts.reduce((s, c) => s + c, 0);
    if (total === 0) {
      // Return flat baseline if no keywords matched
      return l2Normalize(new Array(8).fill(1));
    }
    return l2Normalize(counts);
  }
}

export const textEmbedder = new KeywordHashingEmbeddingModel();

// ─── Trait Registry Seeding ──────────────────────────────────────────
/**
 * Seeds the TraitDefinition table in SQLite from the codebase TRAIT_REGISTRY.
 */
export async function seedTraitDefinitions() {
  const activeTraits = getActiveTraits();
  for (const trait of activeTraits) {
    await prisma.traitDefinition.upsert({
      where: { id: trait.id },
      update: {
        family: trait.family,
        formula: JSON.stringify({
          featureWeights: trait.featureWeights,
          metaSignals: trait.metaSignals,
          confidenceStrategy: trait.confidenceStrategy,
        }),
        activeFlag: trait.active,
        version: trait.version,
      },
      create: {
        id: trait.id,
        family: trait.family,
        formula: JSON.stringify({
          featureWeights: trait.featureWeights,
          metaSignals: trait.metaSignals,
          confidenceStrategy: trait.confidenceStrategy,
        }),
        activeFlag: trait.active,
        version: trait.version,
      },
    });
  }
}

// ─── Core Pipeline Function ──────────────────────────────────────────
/**
 * Processes raw artist metadata and audio features, computes their multi-component 
 * embeddings, L2 normalizes, fuses them, computes confidence, and persists to DB.
 */
export async function processArtistLatentRepresentation(params: {
  spotifyId?: string;
  name: string;
  genres: string[];
  popularity: number;
  followers: number;
  imageUrl?: string;
  audioSignature: AudioSignature;
  bio?: string;
}) {
  const { spotifyId, name, genres, popularity, followers, imageUrl, audioSignature, bio } = params;

  // Step 1: Canonicalize Artist Identity + collision-safe upsert.
  // Never use getCanonicalArtistId (lastfm-*) as create PK when a Spotify id
  // exists — that caused P2002 when lastfm-kanyewest already occupied `id`.
  const canonicalName = getCanonicalArtistName(name);
  const { upsertArtistIdentity } = await import('@/lib/artists/enrich-identity');
  const resolved = await upsertArtistIdentity({
    name: canonicalName,
    spotifyId: spotifyId || null,
    genres,
    popularity,
    followers,
    imageUrl: imageUrl || null,
  });
  const artist = await prisma.artist.findUniqueOrThrow({
    where: { id: resolved.id },
  });

  // Step 2: Compute Audio Feature Subvector (6D)
  // [energy, danceability, valence, acousticness, instrumentalness, normalizedTempo]
  const tempoMin = 40;
  const tempoRange = 160;
  const normalizedTempo = Math.max(0, Math.min(1, (audioSignature.tempo - tempoMin) / tempoRange));
  const audioSubvector = l2Normalize([
    audioSignature.energy,
    audioSignature.danceability,
    audioSignature.valence,
    audioSignature.acousticness,
    audioSignature.instrumentalness,
    normalizedTempo
  ]);

  // Step 3: Compute Semantic/Text Embedding Subvector (8D)
  const textContent = `${bio || ''} ${genres.join(' ')} ${canonicalName}`.trim();
  const textSubvector = await textEmbedder.embed(textContent);

  // Step 4: Compute Trait Subvector (15D)
  // Run single-artist trait inference using active traits formulas
  const activeTraits = getActiveTraits();
  const mockMetaSignals = {
    genreDiversity: genres.length > 1 ? 0.5 : 0.0,
    popularityAvg: popularity / 100, // normalized to [0,1]
    popularityVariance: 0.0,
    tempoVariance: 0.0,
    featureVariance: 0.0,
    artistCount: 1,
    weightConcentration: 1.0
  };

  const traitScores = activeTraits.map(trait => {
    return computeTraitScore(trait, audioSignature, mockMetaSignals);
  });
  const traitSubvector = l2Normalize(traitScores);

  // Step 5: Compute Structural Similarity Subvector (4D)
  // Represent structure without raw popularity.
  // [normalizedFollowers, genreDiversityRate, primaryGenreHash, similarArtistDensity]
  const normFollowers = Math.min(followers / 10000000, 1.0); // capped at 10M followers
  const genreDiversityRate = Math.min(genres.length / 10, 1.0);
  const primaryGenreHash = genres.length > 0 ? (genres[0].charCodeAt(0) % 10) / 10 : 0.5;
  const similarArtistDensity = 0.5; // default baseline similarity link value

  const structuralSubvector = l2Normalize([
    normFollowers,
    genreDiversityRate,
    primaryGenreHash,
    similarArtistDensity,
  ]);

  // Step 6: Fuse Subvectors using weights
  const w = FUSION_CONFIG.weights;
  const weightedAudio = audioSubvector.map(v => v * w.audio);
  const weightedText = textSubvector.map(v => v * w.text);
  const weightedTrait = traitSubvector.map(v => v * w.trait);
  const weightedStructural = structuralSubvector.map(v => v * w.structural);

  const fusedVector = l2Normalize([
    ...weightedAudio,
    ...weightedText,
    ...weightedTrait,
    ...weightedStructural,
  ]);

  // Step 7: Calculate Confidence Score (0.0 to 1.0)
  let confidence = 1.0;
  if (!audioSignature || Object.values(audioSignature).every(v => v === 0)) {
    confidence -= 0.4;
  }
  if (!bio) {
    confidence -= 0.2;
  }
  if (genres.length === 0) {
    confidence -= 0.1;
  }
  if (popularity === 0) {
    confidence -= 0.1;
  }
  confidence = Math.max(0.1, confidence);

  // Step 8: Persist Embedding record in SQLite
  const sourceHash = `${JSON.stringify(audioSignature)}-${popularity}-${genres.join(',')}-${bio ? bio.substring(0, 100) : ''}`;

  const embedding = await prisma.artistEmbedding.upsert({
    where: {
      artistId_embeddingVersion: {
        artistId: artist.id,
        embeddingVersion: FUSION_CONFIG.version,
      },
    },
    update: {
      audioVector: JSON.stringify(audioSubvector),
      textVector: JSON.stringify(textSubvector),
      traitVector: JSON.stringify(traitSubvector),
      structuralVector: JSON.stringify(structuralSubvector),
      fusedVector: JSON.stringify(fusedVector),
      confidence,
      computedAt: new Date(),
      sourceDataHash: sourceHash,
      normalizationVersion: FUSION_CONFIG.normalizationVersion,
    },
    create: {
      artistId: artist.id,
      embeddingVersion: FUSION_CONFIG.version,
      audioVector: JSON.stringify(audioSubvector),
      textVector: JSON.stringify(textSubvector),
      traitVector: JSON.stringify(traitSubvector),
      structuralVector: JSON.stringify(structuralSubvector),
      fusedVector: JSON.stringify(fusedVector),
      confidence,
      sourceDataHash: sourceHash,
      normalizationVersion: FUSION_CONFIG.normalizationVersion,
    },
  });

  // Step 9: Build explanation and provenance payload
  const primaryTraits = activeTraits
    .map((t, idx) => ({ id: t.id, displayLabel: t.displayLabel, score: traitScores[idx] }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const explanationPayload = {
    displayName: artist.displayName,
    confidence,
    primaryTraits,
    audioProfile: {
      tempo: audioSignature.tempo,
      energy: audioSignature.energy,
      acousticness: audioSignature.acousticness,
      instrumentalness: audioSignature.instrumentalness,
    },
  };

  const provenance = {
    source: spotifyId ? 'spotify' : 'lastfm',
    hasBio: !!bio,
    genreCount: genres.length,
    computedAt: embedding.computedAt,
  };

  return {
    artistRecord: artist,
    embeddingRecord: embedding,
    audioSubvector,
    textSubvector,
    traitSubvector,
    structuralSubvector,
    fusedVector,
    confidence,
    explanationPayload,
    provenance,
  };
}
