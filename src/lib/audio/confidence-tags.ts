/**
 * Structural confidence tags for metadata completeness (four-axis model).
 *
 * Basis is territory / scene / era / language data quality — NOT audio.
 * audio_distance was dropped; these tags no longer mean "has real audio".
 *
 * Canonical:
 *   high_confidence    — all four axes well-populated
 *   partial_confidence — some axes defaulted / thin
 *   low_confidence     — mostly missing (cold catalog entry)
 *
 * Legacy aliases still normalize for old rows / call sites:
 *   real_audio → high_confidence
 *   tag_inferred → partial_confidence
 *   cold_start_default → low_confidence
 */

/** Canonical confidence tags (metadata completeness). */
export type ConfidenceTag =
  | 'high_confidence'
  | 'partial_confidence'
  | 'low_confidence';

/**
 * @deprecated Prefer ConfidenceTag. Accepts legacy audio-era strings too.
 */
export type AudioSource =
  | ConfidenceTag
  | 'real_audio'
  | 'tag_inferred'
  | 'cold_start_default'
  | 'REAL'
  | 'SYNTHETIC'
  | 'MISSING';

/** Numeric ranking weight for OCSE Confidence term. */
export const CONFIDENCE_TAG_WEIGHT: Record<ConfidenceTag, number> = {
  high_confidence: 1.0,
  partial_confidence: 0.55,
  low_confidence: 0.25,
};

export function normalizeConfidenceTag(
  value: string | null | undefined,
): ConfidenceTag {
  switch (value) {
    case 'high_confidence':
    case 'real_audio':
    case 'REAL':
      return 'high_confidence';
    case 'partial_confidence':
    case 'tag_inferred':
    case 'SYNTHETIC':
      return 'partial_confidence';
    case 'low_confidence':
    case 'cold_start_default':
    case 'MISSING':
      return 'low_confidence';
    default:
      return 'partial_confidence';
  }
}

/**
 * @deprecated Audio distance dropped. Always false for distance math.
 * Kept so call sites that still gate on "real audio" fail closed honestly.
 */
export function isRealAudio(_value: string | null | undefined): boolean {
  return false;
}

/** Map ConfidenceTag to legacy storage strings if needed. */
export function toLegacyAudioSource(
  tag: ConfidenceTag,
): 'REAL' | 'SYNTHETIC' | 'MISSING' {
  switch (tag) {
    case 'high_confidence':
      return 'REAL';
    case 'partial_confidence':
      return 'SYNTHETIC';
    case 'low_confidence':
      return 'MISSING';
  }
}
