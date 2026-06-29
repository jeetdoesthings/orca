/**
 * ORCA Backend Layer 5: Dynamic Receptivity Gating (Contextual Bandit) Types
 */

export type BanditAction = 0 | 1 | 2; // 0 = Exploit, 1 = Adjacent Explore, 2 = Deep Explore

export type PlaybackContext = 'active_explore' | 'passive_leanback' | 'functional_listening';

export type CircadianContext = 'morning_commute' | 'work_hours' | 'evening_leisure' | 'late_night';

export interface GatingContext {
  entropy: number;           // Long-term taste entropy (entropyScore)
  skipRate: number;          // Current session skip rate (0.0 to 1.0)
  playbackContext: number;   // Numerical value for playback setting (0.0, 0.5, 1.0)
  timeOfDay: number;         // Numerical value for circadian context (0.0 to 1.0)
}

export interface ActionParameters {
  A: number[][]; // 4x4 covariance matrix
  b: number[];   // 4x1 projection vector
}

export interface BanditParameters {
  a0: ActionParameters; // Exploit
  a1: ActionParameters; // Adjacent Explore
  a2: ActionParameters; // Deep Explore
}

export interface BanditDecisionResult {
  userId: string;
  decisionId: string;
  action: BanditAction;
  ucbValues: Record<number, number>;
  context: number[]; // [entropy, skipRate, playbackContext, timeOfDay]
  explanation: string;
  timestamp: Date;
}

export interface RewardFeedback {
  dwellTimeSeconds?: number;
  skipped?: boolean;
  saved?: boolean;
  followed?: boolean;
  repeatListen?: boolean;
  abandoned?: boolean;
}

export const ALPHA_EXPLORATION = 0.5; // LinUCB exploration parameter
