/**
 * Musical Mindset Engine (MME) - Layer 0
 * Predicts the user's current listening intention (Mindset).
 */

export interface MusicalMindset {
  comfort: number;
  background: number;
  focus: number;
  discovery: number;
  expansion: number;
  exploration: number;
  confidence: number;
  dominantMindset: string;
  reasoning: string[];
}

export interface SessionSignals {
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  isWeekend: boolean;
  sessionDuration: number; // in seconds
  currentListeningStreak: number; // in days
  previousSessionLength: number; // in seconds
  gapSinceLastSession: number; // in hours
}

export interface UserBehaviorSignals {
  manualSearches: number;
  queueEdits: number;
  skips: number;
  replays: number;
  albumCompletionRate: number; // 0.0 - 1.0
  artistCompletionRate: number; // 0.0 - 1.0
  playlistCreations: number;
  manualSaves: number;
  libraryAdditions: number;
  radioUsage: number; // 0.0 - 1.0 proportion
}

export interface AgencySignals {
  searchInitiated: boolean;
  recommendationAccepted: boolean;
  autoplay: boolean;
  externalShare: boolean;
  friendRecommendation: boolean;
  voiceSearch: boolean;
}

export interface TasteMemorySignals {
  strength: number; // 0.0 - 1.0
  persistence: number; // 0.0 - 1.0
  decay: number; // 0.0 - 1.0
  identityWeight: number; // 0.0 - 1.0
}

export interface TerritorySignals {
  currentTerritoryId: string;
  hiddenPotential: number; // 0.0 - 1.0
  velocity: number; // rate of change
  relationshipStrength: number; // 0.0 - 1.0
}

export interface ExpansionSignals {
  tem: number; // Taste Expansion Metric (0.0 - 1.0)
  currentExpansion: number;
  velocity: number;
  identityGrowth: number;
}

export interface LOFLSignals {
  recentSuccessRate: number; // 0.0 - 1.0
  recentFailureRate: number; // 0.0 - 1.0
  retryHistoryCount: number;
}

export interface MMEInputSignals {
  session: SessionSignals;
  behavior: UserBehaviorSignals;
  agency: AgencySignals;
  tasteMemory: TasteMemorySignals;
  territory: TerritorySignals;
  expansion: ExpansionSignals;
  lofl: LOFLSignals;
  readiness?: number; // Layer 5 Readiness
}
