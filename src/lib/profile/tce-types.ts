/**
 * ORCA Taste Cultivation Engine Types (Backend Layer 8)
 */

export type ListeningEventType =
  | 'PLAY'
  | 'COMPLETE'
  | 'SKIP'
  | 'SAVE'
  | 'PLAYLIST_ADD'
  | 'REPLAY';

export type AdoptionState =
  | 'UNEXPLORED'
  | 'CULTIVATING'
  | 'MORATORIUM'
  | 'ADOPTED'
  | 'DECLINED';

export interface WeeklyExposureRule {
  weekIndex: number;
  bridgeExposureCount: number;
  targetExposureCount: number;
  focus: 'BRIDGE_HEAVY' | 'MIXED' | 'TARGET_HEAVY' | 'ACCELERATED' | 'SLOW';
}

export type ExposureSchedule = WeeklyExposureRule[];

export interface UserTerritoryCultivationResult {
  userId: string;
  territoryId: string;
  familiarityScore: number;
  fluencyScore: number;
  adoptionProbability: number;
  exposureSchedule: ExposureSchedule;
  adoptionState: AdoptionState;
  confidence: number;
}
