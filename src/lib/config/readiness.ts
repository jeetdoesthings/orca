/**
 * Readiness Model configuration (Change B).
 * Single source of truth for session readiness tier recommendation.
 */

export const ReadinessConfig = {
  /** Rolling window for accept/reject / tier-override history. */
  historyWindowDays: 14,

  /**
   * Strong weight when user explicitly picks a tier this session.
   * Not a soft blend — override wins unless disabled.
   */
  explicitOverrideWins: true,

  /**
   * Score contributions for recommended tier (higher → more likely).
   * GRE stage aggregates + rejection pressure + accept pressure.
   */
  greStageReadinessScore: {
    UNTUCHED: 0.55, // curious about unexplored → expansion
    INTRODUCED: 0.65,
    EXPLORING: 0.7,
    GROWING: 0.55,
    INTEGRATED: 0.35,
    CORE_IDENTITY: 0.25,
    REDISCOVER: 0.5,
    DEFAULT: 0.5,
  } as Record<string, number>,

  /**
   * Map raw aggregate [0,1] readiness appetite → tier.
   * High appetite → leap; low → comfort.
   */
  tierThresholds: {
    /** below this → comfort */
    comfortMax: 0.4,
    /** below this (and >= comfortMax) → expansion; else leap */
    expansionMax: 0.7,
  },

  /** Per-rejection pressure (decays over history window). */
  rejectionPressureWeight: 0.12,
  territoryRejectExtra: 0.08,
  /** Per-accept / integrate pressure toward higher tiers. */
  acceptPressureWeight: 0.1,
  /** Prior explicit tier choices in window (weaker than live override). */
  historicalTierWeight: 0.15,

  /** Product copy (no em dashes). */
  reasoningTemplates: {
    comfort:
      'Recommended: Comfort. Based on how you have responded to farther territory recently.',
    expansion:
      'Recommended: Expansion. Based on how you have responded to new territory recently.',
    leap:
      'Recommended: Leap. Based on how you have engaged with new territory recently.',
    explicit:
      'Recommended: {tier}. You chose this for this session.',
    greHeavy:
      'Recommended: {tier}. Most of your territory is still open to explore.',
    greSettled:
      'Recommended: {tier}. You are rooted in familiar territory right now.',
  },
} as const;

export type ReadinessTier = 'comfort' | 'expansion' | 'leap';
