'use client';

/**
 * Zustand store for the entire ORCA state.
 * Manages graph data, layout positions, expansion state, and view controls.
 */
import { create } from 'zustand';
import type { OrcaNode, OrcaEdge, OrcaGraph } from '@/lib/graph/types';
import type { UserProfile } from '@/lib/profile/types';
import { computeAdventurousness } from '@/lib/metrics/adventurousness';
import type { AdventurousnessMetric } from '@/lib/metrics/adventurousness';
import type { GeoGap } from '@/lib/metrics/geographicCoverage';
import type { ExplorationDepthId } from '@/lib/config/world';
import { filterFrontierByDepth } from '@/lib/frontier/depth-filter';

export interface PerimeterData {
  genre: string;
  points: Array<{ lat: number; lng: number }>;
  color: string;
}

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

  // ── Globe Filters (Phase 3.5) ──

  showHistory: boolean;
  relationshipFilter: 'ALL' | 'MY_TERRITORY' | 'UNEXPLORED';

  // ── Loading ──
  isLoading: boolean;
  preloadsLoaded: boolean;
  error: string | null;

  // ── Phase 2 additions (TODO: Migrate frontierNodes / frontierPanelOpen state names to expansion terminology in a future cleanup) ──
  /** Full unexplored universe (unfiltered). Depth filter never mutates this. */
  frontierUniverse: OrcaNode[];
  /** Visible unexplored after Shore/Shallow/Deep/Alo filter. */
  frontierNodes: OrcaNode[];
  /** Active exploration depth control. */
  explorationDepth: ExplorationDepthId;
  perimeterData: PerimeterData[];
  frontierPanelOpen: boolean;
  previewingNode: OrcaNode | null;
  previewProgress: number;
  adventurousness: AdventurousnessMetric | null;
  expansionEvent: { nodeId: string; timestamp: number } | null;
  geographicGaps: GeoGap[];
  userProfile: UserProfile | null;
  homeRegion?: { lat: number; lng: number; label?: string; spread: number } | null;
  tasteSummary?: string;

  /** Session readiness / surface from globe payload (no window globals). */
  recommendedTier: 'comfort' | 'expansion' | 'leap' | null;
  leapBucketFallback: boolean;
  shoreBucketFallback: boolean;
  distanceVarianceCollapsed: boolean;
  readinessReasoning: string;
  surfaceBucketIds: {
    comfort: string[];
    expansion: string[];
    leap: string[];
  } | null;

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

  setShowHistory: (show: boolean) => void;
  setRelationshipFilter: (filter: 'ALL' | 'MY_TERRITORY' | 'UNEXPLORED') => void;
  setLoading: (loading: boolean) => void;
  setPreloadsLoaded: (loaded: boolean) => void;
  setError: (error: string | null) => void;

  // ── Phase 2 Actions ──
  /**
   * Replace full unexplored universe and re-apply current depth filter
   * into frontierNodes (what the globe + panel render).
   */
  setFrontierUniverse: (nodes: OrcaNode[]) => void;
  /** Change depth: refilter universe → frontierNodes (out-of-band disappear). */
  setExplorationDepth: (depth: ExplorationDepthId) => void;
  /** @deprecated prefer setFrontierUniverse; kept for call sites that set display list */
  setFrontierNodes: (nodes: OrcaNode[]) => void;
  setPerimeterData: (data: PerimeterData[]) => void;
  setFrontierPanelOpen: (open: boolean) => void;
  setPreviewingNode: (node: OrcaNode | null) => void;
  setPreviewProgress: (progress: number) => void;
  setAdventurousness: (metric: AdventurousnessMetric) => void;
  setGeographicGaps: (gaps: GeoGap[]) => void;
  setUserProfile: (profile: UserProfile | null) => void;
  setHomeRegion: (region: OrcaStore['homeRegion']) => void;
  setTasteSummary: (summary: string) => void;
  setReadinessPayload: (payload: {
    recommendedTier?: 'comfort' | 'expansion' | 'leap' | null;
    leapBucketFallback?: boolean;
    shoreBucketFallback?: boolean;
    distanceVarianceCollapsed?: boolean;
    readinessReasoning?: string;
    surfaceBucketIds?: OrcaStore['surfaceBucketIds'];
  }) => void;
  transitionNodeToExplored: (artistId: string) => void;
  revertNodeTransition: (artistId: string) => void;
  updateNodeImageUrl: (id: string, imageUrl: string) => void;
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

  showHistory: false,
  relationshipFilter: 'ALL',

  isLoading: false,
  preloadsLoaded: false,
  error: null,

  // Phase 2 additions initial state
  frontierUniverse: [],
  frontierNodes: [],
  explorationDepth: 'far',
  perimeterData: [],
  frontierPanelOpen: false,
  previewingNode: null,
  previewProgress: 0,
  adventurousness: null,
  expansionEvent: null,
  geographicGaps: [],
  userProfile: null,
  homeRegion: null,
  tasteSummary: '',
  recommendedTier: null,
  leapBucketFallback: false,
  shoreBucketFallback: false,
  distanceVarianceCollapsed: false,
  readinessReasoning: '',
  surfaceBucketIds: null,

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

  setShowHistory: (show) => set({ showHistory: show }),
  setRelationshipFilter: (filter) => set({ relationshipFilter: filter }),
  setLoading: (loading) => set({ isLoading: loading }),
  setPreloadsLoaded: (loaded) => set({ preloadsLoaded: loaded }),
  setError: (error) => set({ error }),

  // Phase 2 Actions
  setFrontierUniverse: (nodes) => {
    const universe = nodes.map((n) => ({
      ...n,
      state: 'frontier' as const,
      reachable: n.reachable !== false,
    }));
    const depth = get().explorationDepth;
    // Display list = ONLY in-band nodes (out-of-band fully removed from render path)
    // Last-resort remap only — honesty flags merge into store when remap fires
    const { nodes: spreadNodes, meta } = filterFrontierByDepth(universe, depth, {
      surfaceBucketIds: get().surfaceBucketIds,
    });
    const filtered = spreadNodes.filter(
      (n) => n.visible !== false && n.reachable !== false && n.inActiveDepth !== false,
    );
    set({
      frontierUniverse: universe,
      frontierNodes: filtered,
      // Client last-resort remap can raise flags; never clear server-true flags here
      shoreBucketFallback: meta.shoreBucketFallback
        ? true
        : get().shoreBucketFallback,
      distanceVarianceCollapsed: meta.distanceVarianceCollapsed
        ? true
        : get().distanceVarianceCollapsed,
    });
  },
  setExplorationDepth: (depth) => {
    const universe = get().frontierUniverse;
    if (universe.length === 0) {
      set({ explorationDepth: depth });
      return;
    }
    const { nodes: spreadNodes, meta } = filterFrontierByDepth(universe, depth, {
      surfaceBucketIds: get().surfaceBucketIds,
    });
    const filtered = spreadNodes.filter(
      (n) => n.visible !== false && n.reachable !== false && n.inActiveDepth !== false,
    );
    set({
      explorationDepth: depth,
      frontierNodes: filtered,
      shoreBucketFallback: meta.shoreBucketFallback
        ? true
        : get().shoreBucketFallback,
      distanceVarianceCollapsed: meta.distanceVarianceCollapsed
        ? true
        : get().distanceVarianceCollapsed,
    });
  },
  setFrontierNodes: (nodes) => {
    // Treat as full universe replace + refilter (safe default)
    get().setFrontierUniverse(nodes);
  },
  setPerimeterData: (data) => set({ perimeterData: data }),
  setFrontierPanelOpen: (open) => set({ frontierPanelOpen: open }),
  setPreviewingNode: (node) => set({ previewingNode: node }),
  setPreviewProgress: (progress) => set({ previewProgress: progress }),
  setAdventurousness: (metric) => set({ adventurousness: metric }),
  setGeographicGaps: (gaps) => set({ geographicGaps: gaps }),
  setUserProfile: (profile) => set({ userProfile: profile }),
  setHomeRegion: (region) => set({ homeRegion: region }),
  setTasteSummary: (summary) => set({ tasteSummary: summary }),
  setReadinessPayload: (payload) =>
    set({
      recommendedTier:
        payload.recommendedTier !== undefined
          ? payload.recommendedTier
          : get().recommendedTier,
      leapBucketFallback:
        payload.leapBucketFallback !== undefined
          ? payload.leapBucketFallback
          : get().leapBucketFallback,
      shoreBucketFallback:
        payload.shoreBucketFallback !== undefined
          ? payload.shoreBucketFallback
          : get().shoreBucketFallback,
      distanceVarianceCollapsed:
        payload.distanceVarianceCollapsed !== undefined
          ? payload.distanceVarianceCollapsed
          : get().distanceVarianceCollapsed,
      readinessReasoning:
        payload.readinessReasoning !== undefined
          ? payload.readinessReasoning
          : get().readinessReasoning,
      surfaceBucketIds:
        payload.surfaceBucketIds !== undefined
          ? payload.surfaceBucketIds
          : get().surfaceBucketIds,
    }),

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

        // Recalculate adventurousness optimistically
        const history = state.adventurousness ? [state.adventurousness] : null;
        const updatedAdventurousness = computeAdventurousness(
          updatedNodes.filter(n => n.state === 'explored'),
          state.frontierNodes,
          history
        );

        return {
          graph: {
            ...state.graph,
            nodes: updatedNodes,
          },
          expansionEvent: { nodeId: artistId, timestamp: Date.now() },
          adventurousness: updatedAdventurousness,
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

      const updatedNodes = [...state.graph.nodes, newlyExploredNode];
      const updatedFrontierNodes = state.frontierNodes.filter((_, i) => i !== frontierIndex);

      // Recalculate adventurousness optimistically
      const history = state.adventurousness ? [state.adventurousness] : null;
      const updatedAdventurousness = computeAdventurousness(
        updatedNodes.filter(n => n.state === 'explored'),
        updatedFrontierNodes,
        history
      );

      return {
        graph: {
          ...state.graph,
          nodes: updatedNodes,
          edges: updatedEdges,
        },
        nodePositions: updatedPositions,
        frontierNodes: updatedFrontierNodes,
        expansionEvent: { nodeId: artistId, timestamp: Date.now() },
        adventurousness: updatedAdventurousness,
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

      const revertedNodes = state.graph.nodes.filter(n => n.id !== artistId);
      const revertedFrontier = [...state.frontierNodes, revertedNode];

      // Recalculate adventurousness on revert
      const history = state.adventurousness ? [state.adventurousness] : null;
      const revertedAdventurousness = computeAdventurousness(
        revertedNodes.filter(n => n.state === 'explored'),
        revertedFrontier,
        history
      );

      return {
        graph: {
          ...state.graph,
          nodes: revertedNodes,
          edges: updatedEdges,
        },
        frontierNodes: revertedFrontier,
        expansionEvent: null,
        adventurousness: revertedAdventurousness,
      };
    });
  },

  updateNodeImageUrl: (id: string, imageUrl: string) => {
    set(state => {
      if (!state.graph) return {};
      const inGraph = state.graph.nodes.some(n => n.id === id);
      if (inGraph) {
        return {
          graph: {
            ...state.graph,
            nodes: state.graph.nodes.map(n => n.id === id ? { ...n, imageUrl } : n),
          }
        };
      }
      const inFrontier = state.frontierNodes.some(n => n.id === id);
      if (inFrontier) {
        return {
          frontierNodes: state.frontierNodes.map(n => n.id === id ? { ...n, imageUrl } : n),
        };
      }
      return {};
    });
  },
}));
