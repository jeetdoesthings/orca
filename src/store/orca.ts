'use client';

/**
 * Zustand store for the entire ORCA state.
 * Manages graph data, layout positions, expansion state, and view controls.
 */
import { create } from 'zustand';
import type { OrcaNode, OrcaEdge, OrcaGraph } from '@/lib/graph/types';

interface OrcaStore {
  // ── Data ──
  graph: OrcaGraph | null;
  nodePositions: Map<string, [number, number, number]>;
  displacedPositions: Map<string, [number, number, number]>;

  // ── Expansion ──
  expandedIds: Set<string>;
  isExpanding: boolean;
  expansionProgress: number; // 0-1

  // ── View ──
  zoomLevel: number; // 1-5
  focusedNodeId: string | null;
  hoveredNodeId: string | null;
  pinnedNodeId: string | null;

  // ── Loading ──
  isLoading: boolean;
  error: string | null;

  // ── Actions ──
  setGraph: (graph: OrcaGraph) => void;
  updatePositions: (positions: Map<string, [number, number, number]>) => void;
  updateDisplacedPositions: (positions: Map<string, [number, number, number]>) => void;
  mergeExpansionData: (nodes: OrcaNode[], edges: OrcaEdge[]) => void;
  markExpanded: (ids: string[]) => void;
  setExpanding: (expanding: boolean) => void;
  setExpansionProgress: (progress: number) => void;
  setZoomLevel: (level: number) => void;
  setFocusedNode: (id: string | null) => void;
  setHoveredNode: (id: string | null) => void;
  setPinnedNode: (id: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useOrcaStore = create<OrcaStore>((set, get) => ({
  // Initial state
  graph: null,
  nodePositions: new Map(),
  displacedPositions: new Map(),
  expandedIds: new Set(),
  isExpanding: false,
  expansionProgress: 0,
  zoomLevel: 1,
  focusedNodeId: null,
  hoveredNodeId: null,
  pinnedNodeId: null,
  isLoading: false,
  error: null,

  // Actions
  setGraph: (graph) => set({ graph }),

  updatePositions: (positions) => set({ nodePositions: new Map(positions) }),

  updateDisplacedPositions: (positions) => set({ displacedPositions: new Map(positions) }),

  mergeExpansionData: (nodes, edges) => {
    const { graph } = get();
    if (!graph) return;

    // Lazy import to avoid circular dependency
    import('@/lib/graph/expander').then(({ mergeExpansion }) => {
      const merged = mergeExpansion(graph, nodes, edges);
      set({ graph: merged });
    });
  },

  markExpanded: (ids) => {
    const { expandedIds } = get();
    const newSet = new Set(expandedIds);
    ids.forEach(id => newSet.add(id));
    set({ expandedIds: newSet });
  },

  setExpanding: (expanding) => set({ isExpanding: expanding }),
  setExpansionProgress: (progress) => set({ expansionProgress: progress }),
  setZoomLevel: (level) => set({ zoomLevel: Math.max(1, Math.min(5, level)) }),
  setFocusedNode: (id) => set({ focusedNodeId: id }),
  setHoveredNode: (id) => set({ hoveredNodeId: id }),
  setPinnedNode: (id) => set({ pinnedNodeId: id }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
}));
