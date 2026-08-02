import { create } from 'zustand';
import { Observation } from '@/lib/graph/types';

interface ObservationStore {
  observations: Observation[];
  isLoading: boolean;
  error: string | null;
  fetchObservations: (searchSuffix: string) => Promise<void>;
  acknowledgeObservation: (id: string, searchSuffix: string) => Promise<void>;
  dismissObservation: (id: string) => void;
  addObservation: (observation: Observation) => void;
}

export const useObservationStore = create<ObservationStore>((set, get) => ({
  observations: [],
  isLoading: false,
  error: null,

  fetchObservations: async () => {
    // No-op to disable backend notifications on load
  },

  acknowledgeObservation: async (id: string, searchSuffix: string) => {
    if (id.startsWith('obs_explored_')) {
      get().dismissObservation(id);
      return;
    }
    try {
      const res = await fetch(`/api/observations/${id}/acknowledge${searchSuffix}`, {
        method: 'POST'
      });
      if (!res.ok && res.status !== 244 && res.status !== 204) throw new Error('Failed to acknowledge observation');

      set(state => ({
        observations: state.observations.filter(f => f.id !== id)
      }));
    } catch (err) {
      console.error(err);
      // Fallback: dismiss locally anyway
      get().dismissObservation(id);
    }
  },

  dismissObservation: (id: string) => {
    set(state => ({
      observations: state.observations.filter(f => f.id !== id)
    }));
  },

  addObservation: (observation: Observation) => {
    set(state => {
      // Avoid duplicate notifications for the same artist
      const exists = state.observations.some(
        obs => obs.id === observation.id || 
        (obs.relatedEntities?.artistId === observation.relatedEntities?.artistId && obs.type === 'ArtistExplored')
      );
      if (exists) return state;
      return {
        observations: [observation, ...state.observations]
      };
    });
  }
}));
