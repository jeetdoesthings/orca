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
  preloadsLoaded: boolean;
  error: string | null;

  // ── Phase 2 additions ──
  frontierNodes: OrcaNode[];
  perimeterData: any[];
  frontierPanelOpen: boolean;
  previewingNode: OrcaNode | null;
  previewProgress: number;
  adventurousness: any | null;
  expansionEvent: { nodeId: string; timestamp: number } | null;
  geographicGaps: any[];

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
  setPreloadsLoaded: (loaded: boolean) => void;
  setError: (error: string | null) => void;

  // ── Phase 2 Actions ──
  setFrontierNodes: (nodes: OrcaNode[]) => void;
  setPerimeterData: (data: any[]) => void;
  setFrontierPanelOpen: (open: boolean) => void;
  setPreviewingNode: (node: OrcaNode | null) => void;
  setPreviewProgress: (progress: number) => void;
  setAdventurousness: (metric: any) => void;
  setGeographicGaps: (gaps: any[]) => void;
  transitionNodeToExplored: (artistId: string) => void;
  revertNodeTransition: (artistId: string) => void;
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
  preloadsLoaded: false,
  error: null,

  // Phase 2 additions initial state
  frontierNodes: [],
  perimeterData: [],
  frontierPanelOpen: false,
  previewingNode: null,
  previewProgress: 0,
  adventurousness: null,
  expansionEvent: null,
  geographicGaps: [],

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
  setPreloadsLoaded: (loaded) => set({ preloadsLoaded: loaded }),
  setError: (error) => set({ error }),

  // Phase 2 Actions
  setFrontierNodes: (nodes) => set({ frontierNodes: nodes }),
  setPerimeterData: (data) => set({ perimeterData: data }),
  setFrontierPanelOpen: (open) => set({ frontierPanelOpen: open }),
  setPreviewingNode: (node) => set({ previewingNode: node }),
  setPreviewProgress: (progress) => set({ previewProgress: progress }),
  setAdventurousness: (metric) => set({ adventurousness: metric }),
  setGeographicGaps: (gaps) => set({ geographicGaps: gaps }),

  transitionNodeToExplored: (artistId) => {
    set(state => {
      if (!state.graph) return state;

      const nodeIndex = state.graph.nodes.findIndex(n => n.id === artistId);
      
      if (nodeIndex !== -1) {
        // If node already in graph, transition its state
        const updatedNodes = [...state.graph.nodes];
        updatedNodes[nodeIndex] = {
          ...updatedNodes[nodeIndex],
          state: 'explored', // or 'newly-explored' for animation
        };
        return {
          graph: {
            ...state.graph,
            nodes: updatedNodes,
          },
          expansionEvent: { nodeId: artistId, timestamp: Date.now() },
        };
      }

      // If it's a frontier node, move it from frontierNodes to graph.nodes
      const frontierIndex = state.frontierNodes.findIndex(n => n.id === artistId);
      if (frontierIndex === -1) return state;

      const frontierNode = state.frontierNodes[frontierIndex];
      const newlyExploredNode: OrcaNode = {
        ...frontierNode,
        state: 'explored', // will play newly-explored animation in canvas via class/mesh update
        weight: 0.5, // default weight for manually explored nodes
      };

      // Add a primary genre edge to connect it to an existing node of the same genre
      const updatedEdges = [...state.graph.edges];
      const matchGenre = newlyExploredNode.genres[0];
      if (matchGenre) {
        const sameGenreNode = state.graph.nodes.find(n => n.genres[0] === matchGenre);
        if (sameGenreNode) {
          updatedEdges.push({
            source: newlyExploredNode.id,
            target: sameGenreNode.id,
            type: 'genre',
            weight: 0.6,
          });
        }
      }

      // Stagger new position inside layout Positions map if layout exists
      const updatedPositions = new Map(state.nodePositions);
      if (newlyExploredNode.x !== undefined && newlyExploredNode.y !== undefined && newlyExploredNode.z !== undefined) {
        updatedPositions.set(newlyExploredNode.id, [newlyExploredNode.x, newlyExploredNode.y, newlyExploredNode.z]);
      }

      return {
        graph: {
          ...state.graph,
          nodes: [...state.graph.nodes, newlyExploredNode],
          edges: updatedEdges,
        },
        nodePositions: updatedPositions,
        frontierNodes: state.frontierNodes.filter((_, i) => i !== frontierIndex),
        expansionEvent: { nodeId: artistId, timestamp: Date.now() },
      };
    });
  },

  revertNodeTransition: (artistId) => {
    set(state => {
      if (!state.graph) return state;

      const nodeIndex = state.graph.nodes.findIndex(n => n.id === artistId);
      if (nodeIndex === -1) return state;

      const nodeToRevert = state.graph.nodes[nodeIndex];
      const revertedNode: OrcaNode = {
        ...nodeToRevert,
        state: 'frontier',
        weight: 0.3,
      };

      // Remove the mock connection edge if we created one
      const updatedEdges = state.graph.edges.filter(
        e => {
          const src = typeof e.source === 'string' ? e.source : e.source.id;
          const tgt = typeof e.target === 'string' ? e.target : e.target.id;
          return !(src === artistId || tgt === artistId);
        }
      );

      return {
        graph: {
          ...state.graph,
          nodes: state.graph.nodes.filter(n => n.id !== artistId),
          edges: updatedEdges,
        },
        frontierNodes: [...state.frontierNodes, revertedNode],
        expansionEvent: null,
      };
    });
  },
}));
