/**
 * Product Terminology & Mapping Layer for ORCA V1.
 * Translates internal backend semantic roles into user-facing terminology, colors, and descriptions.
 */

export const PRODUCT_TERMINOLOGY = {
  CORE_IDENTITY: 'Core Identity',
  EXPAND_TASTE: 'Expand Taste',
  COMFORT_PICK: 'Comfort Pick',
  NEW_TERRITORY: 'New Territory',
  REDISCOVER: 'Rediscover',
  GROWING: 'Growing',
  EXPLORING: 'Exploring',
  INTEGRATED: 'Integrated',
  UNTOUCHED: 'Untouched',
};

export interface ProductLanguageMapping {
  label: string;
  description: string;
  badgeColor: string; // Hex color
  icon: string;
}

const MAPPINGS: Record<string, ProductLanguageMapping> = {
  IDENTITY_REINFORCEMENT: {
    label: PRODUCT_TERMINOLOGY.CORE_IDENTITY,
    description: 'Supports your existing musical signature',
    badgeColor: '#10b981', // Emerald
    icon: 'sparkles',
  },
  REACHABLE: {
    label: PRODUCT_TERMINOLOGY.COMFORT_PICK,
    description: 'Within your listening comfort zone',
    badgeColor: '#3b82f6', // Blue
    icon: 'music',
  },
  BRIDGE: {
    label: PRODUCT_TERMINOLOGY.NEW_TERRITORY,
    description: 'Bridges your taste into new styles',
    badgeColor: '#8b5cf6', // Violet
    icon: 'compass',
  },
  HIDDEN_POTENTIAL: {
    label: PRODUCT_TERMINOLOGY.NEW_TERRITORY,
    description: 'Emerging style waiting to be uncovered',
    badgeColor: '#a855f7', // Purple
    icon: 'compass',
  },
  RECOVERY: {
    label: PRODUCT_TERMINOLOGY.REDISCOVER,
    description: 'Re-ignites interest in a style you used to listen to',
    badgeColor: '#f59e0b', // Amber
    icon: 'history',
  },
  DORMANT_MEMORY: {
    label: PRODUCT_TERMINOLOGY.REDISCOVER,
    description: 'Historical favorite in your memory',
    badgeColor: '#f59e0b', // Amber
    icon: 'history',
  },
  RECOMMENDED_EXPANSION: {
    label: PRODUCT_TERMINOLOGY.EXPAND_TASTE,
    description: 'Recommended next step to broaden your musical identity',
    badgeColor: '#6366f1', // Indigo
    icon: 'trending-up',
  },
};

const DEFAULT_MAPPING: ProductLanguageMapping = {
  label: 'Explore',
  description: 'Expand your music horizon',
  badgeColor: '#22c55e', // Vibrant Green
  icon: 'compass',
};

/**
 * Translates a backend semantic role string into product terminology metadata.
 */
export function translateSemanticRole(role?: string | null): ProductLanguageMapping {
  if (!role) return DEFAULT_MAPPING;
  const upper = role.toUpperCase();
  return MAPPINGS[upper] || DEFAULT_MAPPING;
}
