/**
 * ORCA Dynamic Trait Registry
 *
 * All taste traits are defined here as pure data objects.
 * No trait logic lives in application code — every trait is a configuration
 * entry with feature mappings, weights, transforms, and metadata.
 *
 * To add a new trait:
 *   1. Add a TraitDefinition object to TRAIT_REGISTRY
 *   2. Define its featureWeights (audio feature mappings)
 *   3. Optionally add metaSignals (behavioral signals)
 *   4. Set active: true
 *   5. Done — the inference engine picks it up automatically
 *
 * To retire a trait:
 *   1. Set active: false
 *   2. Downstream consumers ignore inactive traits
 *   3. Historical data is preserved
 */

import type { TraitDefinition, TraitFamily } from './types';

// ─── Trait Family Metadata ──────────────────────────────────────────

export interface TraitFamilyMeta {
  id: TraitFamily;
  displayName: string;
  description: string;
}

export const TRAIT_FAMILIES: TraitFamilyMeta[] = [
  { id: 'mood', displayName: 'Mood', description: 'Emotional states and psychological orientations' },
  { id: 'energy', displayName: 'Energy', description: 'Physical intensity and dynamism' },
  { id: 'texture', displayName: 'Texture', description: 'Sonic surface quality and production style' },
  { id: 'structure', displayName: 'Structure', description: 'Compositional form and arrangement' },
  { id: 'atmosphere', displayName: 'Atmosphere', description: 'Spatial and environmental qualities' },
  { id: 'emotional-tone', displayName: 'Emotional Tone', description: 'Core emotional coloring' },
  { id: 'novelty-behavior', displayName: 'Novelty Behavior', description: 'Patterns around exploration and familiarity' },
  { id: 'intensity', displayName: 'Intensity', description: 'Force, aggression, and impact' },
];

// ─── The Registry ───────────────────────────────────────────────────

/**
 * The complete trait registry. Each entry defines:
 * - What audio features contribute to the trait
 * - How those features are transformed (linear, inverse, threshold, quadratic)
 * - What behavioral meta-signals supplement the audio data
 * - How confidence is computed
 *
 * Feature transforms:
 *   linear    — raw value used directly (higher feature → higher trait)
 *   inverse   — 1 - value (lower feature → higher trait)
 *   quadratic — value² (amplifies extremes)
 *   threshold — 1 if value >= threshold, else 0 (binary gate)
 */
export const TRAIT_REGISTRY: TraitDefinition[] = [
  // ── Atmosphere Family ─────────────────────────────────────────
  {
    id: 'atmospheric',
    name: 'atmospheric',
    displayLabel: 'Atmospheric',
    family: 'atmosphere',
    description: 'Preference for spacious, immersive, environment-like soundscapes',
    featureWeights: {
      energy:            { weight: 0.30, transform: 'inverse' },
      instrumentalness:  { weight: 0.30, transform: 'linear' },
      acousticness:      { weight: 0.15, transform: 'linear' },
      tempo:             { weight: 0.25, transform: 'inverse' },
    },
    confidenceStrategy: 'combined',
    active: true,
    userVisible: true,
    version: 1,
  },
  {
    id: 'cinematic',
    name: 'cinematic',
    displayLabel: 'Cinematic',
    family: 'atmosphere',
    description: 'Drawn to dramatic, score-like, orchestral or widescreen music',
    featureWeights: {
      instrumentalness:  { weight: 0.35, transform: 'linear' },
      energy:            { weight: 0.25, transform: 'linear' },
      valence:           { weight: 0.15, transform: 'inverse' },
      acousticness:      { weight: 0.25, transform: 'linear' },
    },
    metaSignals: {
      tempoVariance: { weight: 0.15, type: 'tempo_variance' },
    },
    confidenceStrategy: 'combined',
    active: true,
    userVisible: true,
    version: 1,
  },
  {
    id: 'expansive',
    name: 'expansive',
    displayLabel: 'Expansive',
    family: 'atmosphere',
    description: 'Wide-ranging taste that spans multiple sonic worlds',
    featureWeights: {
      instrumentalness:  { weight: 0.20, transform: 'linear' },
    },
    metaSignals: {
      genreDiversity:   { weight: 0.50, type: 'genre_diversity' },
      featureVariance:  { weight: 0.30, type: 'feature_variance' },
    },
    confidenceStrategy: 'sample_size',
    active: true,
    userVisible: true,
    version: 1,
  },

  // ── Emotional Tone Family ─────────────────────────────────────
  {
    id: 'melancholic',
    name: 'melancholic',
    displayLabel: 'Melancholic',
    family: 'emotional-tone',
    description: 'Gravitates toward sadness, longing, and emotional depth',
    featureWeights: {
      valence:      { weight: 0.40, transform: 'inverse' },
      energy:       { weight: 0.30, transform: 'inverse' },
      acousticness: { weight: 0.20, transform: 'linear' },
      tempo:        { weight: 0.10, transform: 'inverse' },
    },
    confidenceStrategy: 'signal_strength',
    active: true,
    userVisible: true,
    version: 1,
  },
  {
    id: 'euphoric',
    name: 'euphoric',
    displayLabel: 'Euphoric',
    family: 'emotional-tone',
    description: 'Seeks joyful, uplifting, high-energy peaks',
    featureWeights: {
      valence:       { weight: 0.40, transform: 'linear' },
      energy:        { weight: 0.35, transform: 'linear' },
      danceability:  { weight: 0.25, transform: 'linear' },
    },
    confidenceStrategy: 'signal_strength',
    active: true,
    userVisible: true,
    version: 1,
  },
  {
    id: 'dark',
    name: 'dark',
    displayLabel: 'Dark',
    family: 'emotional-tone',
    description: 'Drawn to ominous, brooding, or menacing sonic territory',
    featureWeights: {
      valence:      { weight: 0.40, transform: 'inverse' },
      acousticness: { weight: 0.20, transform: 'inverse' },
      energy:       { weight: 0.25, transform: 'linear' },
      danceability: { weight: 0.15, transform: 'linear' },
    },
    confidenceStrategy: 'signal_strength',
    active: true,
    userVisible: true,
    version: 1,
  },

  // ── Mood Family ───────────────────────────────────────────────
  {
    id: 'introspective',
    name: 'introspective',
    displayLabel: 'Introspective',
    family: 'mood',
    description: 'Preference for inward-looking, contemplative, and personal music',
    featureWeights: {
      energy:       { weight: 0.30, transform: 'inverse' },
      acousticness: { weight: 0.30, transform: 'linear' },
      valence:      { weight: 0.20, transform: 'inverse' },
      danceability: { weight: 0.20, transform: 'inverse' },
    },
    confidenceStrategy: 'combined',
    active: true,
    userVisible: true,
    version: 1,
  },
  {
    id: 'nocturnal',
    name: 'nocturnal',
    displayLabel: 'Nocturnal',
    family: 'mood',
    description: 'After-dark energy — low-light danceability and moody grooves',
    featureWeights: {
      valence:      { weight: 0.25, transform: 'inverse' },
      energy:       { weight: 0.15, transform: 'inverse' },
      danceability: { weight: 0.35, transform: 'linear' },
      acousticness: { weight: 0.25, transform: 'inverse' },
    },
    confidenceStrategy: 'combined',
    active: true,
    userVisible: true,
    version: 1,
  },

  // ── Intensity Family ──────────────────────────────────────────
  {
    id: 'aggressive',
    name: 'aggressive',
    displayLabel: 'Aggressive',
    family: 'intensity',
    description: 'High-impact, forceful, confrontational sound',
    featureWeights: {
      energy:  { weight: 0.40, transform: 'linear' },
      valence: { weight: 0.30, transform: 'inverse' },
      tempo:   { weight: 0.30, transform: 'linear' },
    },
    confidenceStrategy: 'signal_strength',
    active: true,
    userVisible: true,
    version: 1,
  },

  // ── Texture Family ────────────────────────────────────────────
  {
    id: 'intimate',
    name: 'intimate',
    displayLabel: 'Intimate',
    family: 'texture',
    description: 'Close, personal, stripped-back sonic space',
    featureWeights: {
      acousticness:     { weight: 0.35, transform: 'linear' },
      energy:           { weight: 0.30, transform: 'inverse' },
      instrumentalness: { weight: 0.15, transform: 'inverse' },
      danceability:     { weight: 0.20, transform: 'inverse' },
    },
    confidenceStrategy: 'combined',
    active: true,
    userVisible: true,
    version: 1,
  },
  {
    id: 'warm',
    name: 'warm',
    displayLabel: 'Warm',
    family: 'texture',
    description: 'Comforting, golden-tone, organically textured sound',
    featureWeights: {
      valence:      { weight: 0.30, transform: 'linear' },
      acousticness: { weight: 0.30, transform: 'linear' },
      energy:       { weight: 0.20, transform: 'linear' },
      tempo:        { weight: 0.20, transform: 'inverse' },
    },
    confidenceStrategy: 'combined',
    active: true,
    userVisible: true,
    version: 1,
  },
  {
    id: 'raw',
    name: 'raw',
    displayLabel: 'Raw',
    family: 'texture',
    description: 'Unpolished, gritty, lo-fi or distorted aesthetics',
    featureWeights: {
      energy:           { weight: 0.35, transform: 'linear' },
      instrumentalness: { weight: 0.15, transform: 'inverse' },
      valence:          { weight: 0.25, transform: 'inverse' },
      acousticness:     { weight: 0.25, transform: 'inverse' },
    },
    metaSignals: {
      popularityAvg: { weight: 0.15, type: 'popularity_avg' },
    },
    confidenceStrategy: 'combined',
    active: true,
    userVisible: true,
    version: 1,
  },
  {
    id: 'polished',
    name: 'polished',
    displayLabel: 'Polished',
    family: 'texture',
    description: 'Clean, well-produced, mainstream-quality sound',
    featureWeights: {
      valence:      { weight: 0.25, transform: 'linear' },
      danceability: { weight: 0.25, transform: 'linear' },
      energy:       { weight: 0.20, transform: 'linear' },
    },
    metaSignals: {
      popularityAvg: { weight: 0.30, type: 'popularity_avg' },
    },
    confidenceStrategy: 'combined',
    active: true,
    userVisible: true,
    version: 1,
  },

  // ── Energy Family ─────────────────────────────────────────────
  {
    id: 'rhythmic',
    name: 'rhythmic',
    displayLabel: 'Rhythmic',
    family: 'energy',
    description: 'Strong preference for groove, beat, and rhythmic drive',
    featureWeights: {
      danceability: { weight: 0.45, transform: 'linear' },
      energy:       { weight: 0.30, transform: 'linear' },
      tempo:        { weight: 0.25, transform: 'linear' },
    },
    confidenceStrategy: 'signal_strength',
    active: true,
    userVisible: true,
    version: 1,
  },

  // ── Novelty Behavior Family ───────────────────────────────────
  {
    id: 'experimental',
    name: 'experimental',
    displayLabel: 'Experimental',
    family: 'novelty-behavior',
    description: 'Gravitates toward unconventional, boundary-pushing, or niche music',
    featureWeights: {
      instrumentalness: { weight: 0.15, transform: 'linear' },
    },
    metaSignals: {
      genreDiversity:     { weight: 0.30, type: 'genre_diversity' },
      popularityAvg:      { weight: 0.30, type: 'popularity_avg' },
      featureVariance:    { weight: 0.25, type: 'feature_variance' },
    },
    confidenceStrategy: 'sample_size',
    active: true,
    userVisible: true,
    version: 1,
  },
];

// ─── Registry Access Helpers ────────────────────────────────────────

/** Get all currently active trait definitions */
export function getActiveTraits(): TraitDefinition[] {
  return TRAIT_REGISTRY.filter(t => t.active);
}

/** Get all user-visible active traits */
export function getVisibleTraits(): TraitDefinition[] {
  return TRAIT_REGISTRY.filter(t => t.active && t.userVisible);
}

/** Look up a single trait by ID */
export function getTraitById(id: string): TraitDefinition | undefined {
  return TRAIT_REGISTRY.find(t => t.id === id);
}

/** Get traits filtered by family */
export function getTraitsByFamily(family: TraitFamily): TraitDefinition[] {
  return TRAIT_REGISTRY.filter(t => t.active && t.family === family);
}

/** Get all unique families present in active traits */
export function getActiveFamilies(): TraitFamily[] {
  const families = new Set<TraitFamily>();
  TRAIT_REGISTRY.filter(t => t.active).forEach(t => families.add(t.family));
  return Array.from(families);
}
