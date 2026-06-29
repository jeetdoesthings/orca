import { create } from 'zustand';
import type { OrcaNode } from '@/lib/graph/types';

export interface JourneyNode {
  artistId: string;
  status: 'completed' | 'current' | 'upcoming' | 'target';
  type: 'current' | 'bridge' | 'target';
  artist: any; // backend Artist DTO
}

export interface ActiveJourney {
  id: string;
  name: string;
  type: string;
  status: 'active' | 'completed';
  progress: number;
  currentTerritoryId: string;
  targetTerritoryId: string;
  explanation: string;
  expectedIdentityGrowth: number;
  nodes: JourneyNode[];
}

interface JourneyStore {
  activeJourneys: ActiveJourney[];
  currentJourneyId: string | null;
  isLoading: boolean;
  error: string | null;
  fetchJourneys: () => Promise<void>;
  setCurrentJourney: (id: string | null) => void;
}

export const useJourneyStore = create<JourneyStore>((set, get) => ({
  activeJourneys: [],
  currentJourneyId: null,
  isLoading: false,
  error: null,
  setCurrentJourney: (id) => set({ currentJourneyId: id }),
  fetchJourneys: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch('/api/orca/journeys');
      if (!res.ok) {
        throw new Error('Failed to fetch journeys');
      }
      const data = await res.json();
      set({ 
        activeJourneys: data.journeys || [],
        currentJourneyId: data.journeys && data.journeys.length > 0 ? data.journeys[0].id : null,
        isLoading: false 
      });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  }
}));
