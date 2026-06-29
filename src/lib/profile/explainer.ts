/**
 * ORCA Profile Explainer
 *
 * Generates human-readable explanations from computed profile data.
 * Every explanation is template-driven — assembled from structured profile
 * objects and the trait registry. No hard-coded artist names, genre names,
 * or per-musician branching logic.
 *
 * Flow:
 *   ProfileLayers → generateExplanations() → ExplanationPayload
 *
 * The output ExplanationPayload is embedded in the UserProfile and consumed
 * by UI components, analytics dashboards, and the taste-expansion engine.
 */

import type {
  ExplanationPayload,
  SonicProfile,
  TraitProfile,
  DiscoveryProfile,
  TrajectoryProfile,
  ConfidenceProfile,
} from './types';
import { getTraitById } from './trait-registry';

// ─── Internal Helpers ───────────────────────────────────────────────

/**
 * Resolve a trait ID to its human-readable display label.
 * Returns the raw ID as a fallback if the trait is missing from the registry
 * (defensive — should not happen with a healthy registry).
 *
 * @param traitId - Trait identifier to look up
 * @returns The display label string
 */
function labelFor(traitId: string): string {
  return getTraitById(traitId)?.displayLabel ?? traitId;
}

/**
 * Resolve a trait ID to the display name of its family grouping.
 * Falls back to 'general' if the trait or family metadata is unavailable.
 *
 * @param traitId - Trait identifier to look up
 * @returns A human-friendly family name (lowercased for inline use)
 */
function familyLabelFor(traitId: string): string {
  const trait = getTraitById(traitId);
  if (!trait) return 'general';
  // Family IDs are kebab-case ('emotional-tone') — convert for prose
  return trait.family.replace(/-/g, ' ');
}

/**
 * Join an array of strings with commas and a final conjunction.
 *
 * @example
 * naturalJoin(['a', 'b', 'c']) // → 'a, b, and c'
 * naturalJoin(['a', 'b'])      // → 'a and b'
 * naturalJoin(['a'])           // → 'a'
 *
 * @param items - Strings to join
 * @param conjunction - Word before the final item (default 'and')
 * @returns Formatted string
 */
function naturalJoin(items: string[], conjunction = 'and'): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, ${conjunction} ${items[items.length - 1]}`;
}

// ─── Section Generators ─────────────────────────────────────────────

/**
 * Build a single-sentence taste summary from dominant traits.
 *
 * Rules:
 *  - 0 dominant traits → low-confidence fallback message
 *  - 1 dominant trait  → "Your taste is distinctly [trait]."
 *  - 2-3 traits        → "Your taste leans [t1], [t2], and [t3]."
 *  - >3 traits         → take the top 3 only
 *
 * @param dominantTraits - Ordered trait IDs (highest score first)
 * @returns One-sentence summary string
 */
function buildShortSummary(dominantTraits: string[]): string {
  if (dominantTraits.length === 0) {
    return 'Your taste profile is still forming — keep listening.';
  }

  const labels = dominantTraits.slice(0, 3).map(labelFor);

  if (labels.length === 1) {
    return `Your taste is distinctly ${labels[0]}.`;
  }

  return `Your taste leans ${naturalJoin(labels)}.`;
}

/**
 * Build a multi-sentence detailed summary combining insights from
 * trait, discovery, trajectory, and emerging-trait layers.
 *
 * Sentence structure:
 *  1. Dominant traits + families
 *  2. Discovery readiness
 *  3. Trajectory / long-term trend
 *  4. (Optional) Emerging traits
 *
 * @param dominantTraits - Ordered trait IDs (highest score first)
 * @param emergingTraits - Trait IDs showing upward trend
 * @param discoveryProfile - Discovery readiness layer
 * @param trajectoryProfile - Trajectory / trend layer
 * @returns Multi-sentence detailed summary
 */
function buildDetailedSummary(
  dominantTraits: string[],
  emergingTraits: string[],
  discoveryProfile: DiscoveryProfile,
  trajectoryProfile: TrajectoryProfile,
): string {
  const sentences: string[] = [];

  // Sentence 1 — dominant traits with family context
  if (dominantTraits.length === 0) {
    sentences.push('Your taste profile is still forming as more listening data comes in.');
  } else {
    const top = dominantTraits.slice(0, 3);
    const labels = top.map(labelFor);
    // Collect unique families for the dominant traits
    const families = [...new Set(top.map(familyLabelFor))];
    const familyFragment =
      families.length > 0
        ? `, rooted in the ${naturalJoin(families)} ${families.length === 1 ? 'dimension' : 'dimensions'}`
        : '';

    sentences.push(
      `Your strongest sonic traits are ${naturalJoin(labels)}${familyFragment}.`,
    );
  }

  // Sentence 2 — discovery readiness
  sentences.push(
    `You show ${discoveryProfile.readinessLabel} openness to new sounds.`,
  );

  // Sentence 3 — trajectory / long-term trend
  if (trajectoryProfile.longTermTrend) {
    sentences.push(trajectoryProfile.longTermTrend);
  }

  // Sentence 4 (optional) — emerging traits
  if (emergingTraits.length > 0) {
    const emergingLabel = labelFor(emergingTraits[0]);
    sentences.push(
      `A ${emergingLabel} quality is emerging in your recent listening.`,
    );
  }

  return sentences.join(' ');
}

/**
 * Generate per-trait human-readable explanations.
 *
 * Only traits with confidence ≥ 0.3 are explained — anything below is
 * too speculative to surface. Each explanation uses the trait's registry
 * metadata (displayLabel, description) and is bucketed by score:
 *
 *  - score > 0.65  → "Strong [label] tendency — [description]."
 *  - 0.4 ≤ score ≤ 0.65 → "Moderate [label] presence in your listening."
 *  - score < 0.4   → "Low [label] signal — this is a potential area for discovery."
 *
 * @param traitProfile - Computed trait scores
 * @returns Record mapping trait IDs to explanation strings
 */
function buildTraitExplanations(
  traitProfile: TraitProfile,
): Record<string, string> {
  const explanations: Record<string, string> = {};

  for (const traitScore of traitProfile.scores) {
    if (traitScore.confidence < 0.3) continue;

    const def = getTraitById(traitScore.traitId);
    const label = def?.displayLabel ?? traitScore.traitId;
    const description = def?.description ?? '';

    if (traitScore.score > 0.65) {
      explanations[traitScore.traitId] =
        `Strong ${label} tendency — ${description}.`;
    } else if (traitScore.score >= 0.4) {
      explanations[traitScore.traitId] =
        `Moderate ${label} presence in your listening.`;
    } else {
      explanations[traitScore.traitId] =
        `Low ${label} signal — this is a potential area for discovery.`;
    }
  }

  return explanations;
}

/** Readiness-label → prose mapping for discovery explanation */
const DISCOVERY_COPY: Record<DiscoveryProfile['readinessLabel'], string> = {
  'very high':
    'You are highly open to new sounds — ORCA can push you into unfamiliar territory.',
  high:
    'You show strong curiosity — there is room to explore adjacent genres.',
  moderate:
    'You have a balanced approach — open to discovery within comfortable range.',
  low:
    'You prefer familiar ground — ORCA will suggest gentle, nearby expansions.',
};

/**
 * Generate the discovery-readiness explanation from the readiness label.
 *
 * @param discoveryProfile - Discovery layer
 * @returns Prose explanation string
 */
function buildDiscoveryExplanation(
  discoveryProfile: DiscoveryProfile,
): string {
  return DISCOVERY_COPY[discoveryProfile.readinessLabel];
}

/**
 * Generate the trajectory explanation from recent shifts and trend data.
 *
 * - If recentShifts is non-empty → "Recent changes detected: [longTermTrend]"
 * - If no shifts → "Your profile is holding steady. [longTermTrend]"
 *
 * @param trajectoryProfile - Trajectory layer
 * @returns Prose explanation string
 */
function buildTrajectoryExplanation(
  trajectoryProfile: TrajectoryProfile,
): string {
  if (trajectoryProfile.recentShifts.length > 0) {
    return `Recent changes detected: ${trajectoryProfile.longTermTrend}`;
  }
  return `Your profile is holding steady. ${trajectoryProfile.longTermTrend}`;
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Generate a complete {@link ExplanationPayload} from the five computed
 * profile layers.
 *
 * This is the single entry point for the explainer module. All output
 * text is assembled from the structured profile data and trait registry
 * metadata — no hard-coded artist names, genre names, or per-musician
 * branching logic.
 *
 * @param sonicProfile - Layer 2: sonic centroid, variance, and extremes
 * @param traitProfile - Layer 3: registry-driven trait scores
 * @param discoveryProfile - Layer 4: exploration readiness
 * @param trajectoryProfile - Layer 5: taste trajectory over time
 * @param confidenceProfile - Layer 6: inference reliability
 * @returns A fully populated ExplanationPayload
 *
 * @example
 * ```ts
 * const explanations = generateExplanations(
 *   sonic, traits, discovery, trajectory, confidence,
 * );
 * console.log(explanations.shortSummary);
 * // → "Your taste leans Melancholic, Atmospheric, and Intimate."
 * ```
 */
export function generateExplanations(
  sonicProfile: SonicProfile,
  traitProfile: TraitProfile,
  discoveryProfile: DiscoveryProfile,
  trajectoryProfile: TrajectoryProfile,
  confidenceProfile: ConfidenceProfile,
): ExplanationPayload {
  // sonicProfile and confidenceProfile are accepted for future enrichment
  // (e.g. mentioning extreme dimensions, or caveating low-confidence areas).
  void sonicProfile;
  void confidenceProfile;

  return {
    shortSummary: buildShortSummary(traitProfile.dominantTraits),
    detailedSummary: buildDetailedSummary(
      traitProfile.dominantTraits,
      traitProfile.emergingTraits,
      discoveryProfile,
      trajectoryProfile,
    ),
    traitExplanations: buildTraitExplanations(traitProfile),
    discoveryExplanation: buildDiscoveryExplanation(discoveryProfile),
    trajectoryExplanation: buildTrajectoryExplanation(trajectoryProfile),
  };
}
