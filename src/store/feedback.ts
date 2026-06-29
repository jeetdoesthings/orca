import { create } from 'zustand';
import { Observation } from '@/lib/graph/types';

interface ObservationStore {
  observations: Observation[];
  isLoading: boolean;
  error: string | null;
  fetchObservations: (searchSuffix: string) => Promise<void>;
  acknowledgeObservation: (id: string, searchSuffix: string) => Promise<void>;
  dismissObservation: (id: string) => void;
}

export const useObservationStore = create<ObservationStore>((set, get) => ({
  observations: [],
  isLoading: false,
  error: null,

  fetchObservations: async (searchSuffix: string) => {
    set({ isLoading: true });
    try {
      const res = await fetch(`/api/observations${searchSuffix}`);
      if (!res.ok) throw new Error('Failed to fetch observations');
      const data = await res.json();
      const newItems: Observation[] = data.observations || [];

      set(state => {
        // Merge and de-duplicate by id
        const merged = [...state.observations];
        newItems.forEach(item => {
          const exists = merged.some(f => f.id === item.id);
          if (!exists) {
            merged.push(item);
          }
        });
        return { observations: merged, isLoading: false, error: null };
      });
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
    }
  },

  acknowledgeObservation: async (id: string, searchSuffix: string) => {
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
  }
}));
