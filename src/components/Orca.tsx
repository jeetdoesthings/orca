'use client';

/**
 * Orca — root Three.js canvas component.
 * Composes all visualization layers and orchestrates data loading + layout.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { GlobeShell } from './orca/GlobeShell';
import { NodeField } from './orca/NodeField';
import { EdgeField } from './orca/EdgeField';
import { BackgroundField } from './orca/BackgroundField';
import { NodeLabels } from './orca/NodeLabels';
import { ArtistImageLayer } from './orca/ArtistImageLayer';
import { ArtistHoverCard } from './orca/ArtistHoverCard';
import { FocusedArtistVisual } from './orca/FocusedArtistVisual';
import { GenrePerimeter } from './orca/GenrePerimeter';
import { ExpansionLabels } from './orca/ExpansionLabels';
import { ExpansionParticles } from './orca/ExpansionParticles';
// GeographicGaps removed
import { OrcaHUD } from './OrcaHUD';
import { useOrcaStore } from '@/store/orca';
import { useObservationStore } from '@/store/feedback';
import { BackgroundGradientAnimation } from '@/components/ui/background-gradient-animation';
import { buildGraph } from '@/lib/graph/builder';
import { getExpansionCandidates } from '@/lib/graph/expander';
import type { ForceLayout } from '@/lib/graph/types';
import { persistentImageCache } from '@/lib/imageCache';
import { latLngToXYZ } from '@/lib/graph/genre-normaliser';

import { LoadingOverlay } from './orca/LoadingOverlay';

const LOADING_MESSAGES = [
  'Following hidden currents...',
  'Listening between genres...',
  'Exploring beyond the familiar...',
  'Finding unexpected connections...',
  'Reading the musical tides...',
  'Tracing musical pathways...',
  'Listening for signals...',
  'Looking beyond your horizon...',
  'Following echoes...',
  'Discovering what resonates...',
  'Diving deeper...',
  'Navigating open waters...',
  'Searching distant waters...',
  'Listening beneath the surface...',
  'Following unseen routes...',
  'Exploring deeper oceans...',
  'Looking closer...',
  'Expanding the map...',
  'Connecting the dots...',
  'Discovering more...',
  'Following patterns...',
  'Finding pathways...',
  'Going deeper...',
  'Mapping connections...',
  'Uncovering signals...',
  'Venturing into uncharted sound...',
  'Finding what comes next...',
  'Tracking hidden influences...',
  'Searching deeper frequencies...',
  'Discovering unfamiliar waters...',
  'Charting your next discovery...',
  'Connecting distant sounds...',
  'Reading the currents...',
  'Listening to the deep...',
  'Exploring new waters...',
  'Following the music...',
  'Discovering hidden pathways...',
  'Finding new horizons...',
  'Looking beyond familiar sounds...',
  'Tracing hidden connections...'
];

function RotatingLoadingMessage() {
  const [msgIndex, setMsgIndex] = useState(0);
  const [fade, setFade] = useState('in'); // 'in' | 'out'

  useEffect(() => {
    setMsgIndex(Math.floor(Math.random() * LOADING_MESSAGES.length));

    const interval = setInterval(() => {
      // Start fade out
      setFade('out');

      setTimeout(() => {
        // Change message and fade in
        setMsgIndex((prev) => {
          let next;
          do {
            next = Math.floor(Math.random() * LOADING_MESSAGES.length);
          } while (next === prev);
          return next;
        });
        setFade('in');
      }, 500); // 500ms buffer, old message fully faded out at 350ms

    }, 3800); // rotate every 3.8 seconds

    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{
      fontSize: '14px',
      fontWeight: 500,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      color: 'rgba(0, 0, 0, 0.4)',
      opacity: fade === 'in' ? 1 : 0,
      transition: 'opacity 350ms cubic-bezier(0.4, 0, 0.2, 1)',
      textAlign: 'center',
    }}>
      {LOADING_MESSAGES[msgIndex]}
    </div>
  );
}

/** Inner scene component that uses R3F hooks */
function OrcaScene({
  onImageResolved,
}: {
  onImageResolved: (artistName: string, hasImage: boolean) => void;
}) {
  // Gentle ongoing simulation tick for living motion
  // Removed useFrame tick to avoid render loop conflicts — layout is stepped in the effect
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const focusedNodeId = useOrcaStore(s => s.focusedNodeId);
  const positions = useOrcaStore(s => s.nodePositions);

  const { camera, size, gl } = useThree();
  const isMobile = size.width < 640;

  // Responsive zoom bounds to prevent infinite zoom or clipping inside the globe (surface is at R = 1.65)
  const minD = isMobile ? 2.4 : 2.3;
  const maxD = isMobile ? 10.0 : 9.0;

  useEffect(() => {
    if (isMobile) {
      camera.position.set(0, 0.2, 8.0); // Default starting position zoomed out on mobile
    } else {
      camera.position.set(0, 0.2, 7.2); // Desktop default zoomed out
    }
    camera.lookAt(0, 0, 0);
  }, [isMobile, camera]);



  const focusStateRef = useRef<{
    nodeId: string | null;
    nodePosition: THREE.Vector3 | null;
    start: THREE.Vector3;
    end: THREE.Vector3;
    elapsed: number;
    previousPosition: THREE.Vector3;
    isFocused: boolean;
  }>({
    nodeId: null,
    nodePosition: null,
    start: new THREE.Vector3(),
    end: new THREE.Vector3(),
    elapsed: 1, // Start fully elapsed so no initial animation
    previousPosition: new THREE.Vector3(),
    isFocused: false,
  });

  // ── Fly to Home Region centroid on load ──
  const [hasFlown, setHasFlown] = useState(false);
  const homeRegion = useOrcaStore(s => (s as any).homeRegion);

  useEffect(() => {
    if (homeRegion && !hasFlown && camera) {
      const { lat, lng, spread } = homeRegion;
      const baseDistance = isMobile ? 7.8 : 6.8;
      const [hx, hy, hz] = latLngToXYZ(lat, lng, baseDistance + spread * 1.0);
      
      const focus = focusStateRef.current;
      focus.nodeId = 'home-region';
      focus.start.copy(camera.position);
      focus.end.set(hx, hy, hz);
      focus.elapsed = 0;
      focus.isFocused = true;
      setHasFlown(true);
    }
  }, [homeRegion, hasFlown, camera]);

  useFrame(({ camera }, delta) => {
    const focus = focusStateRef.current;

    // Detect transitions and target focus node changes
    if (focus.nodeId !== focusedNodeId) {
      if (focusedNodeId) {
        // Entering or switching focus to a specific node
        let nodePosition = positions.get(focusedNodeId);
        if (!nodePosition) {
          const fn = useOrcaStore.getState().frontierNodes.find(n => n.id === focusedNodeId);
          if (fn && fn.x !== undefined && fn.y !== undefined && fn.z !== undefined) {
            nodePosition = [fn.x, fn.y, fn.z];
          }
        }
        if (nodePosition) {
          // Save current position as fallback before starting flight
          if (!focus.isFocused || focus.nodeId === 'home-region') {
            focus.previousPosition.copy(camera.position);
          }

          const direction = new THREE.Vector3(...nodePosition).normalize();
          // Zoom in toward the node: use the tighter of (current distance) or
          // the orbital minimum. Never push the camera OUT — always zoom IN.
          const currentDist = camera.position.length();
          const distance = Math.min(currentDist, minD);

          focus.nodeId = focusedNodeId;
          focus.nodePosition = new THREE.Vector3(...nodePosition);
          focus.start.copy(camera.position);
          focus.end.copy(direction.multiplyScalar(distance));
          focus.elapsed = 0;
          focus.isFocused = true;
        }
      } else {
        // Exiting focus completely
        // Only trigger exit animation if we are actually exiting a focused node,
        // and NOT the initial home region flight centroid
        if (focus.isFocused && focus.nodeId !== 'home-region') {
          focus.nodeId = null;
          focus.start.copy(camera.position);
          focus.end.copy(focus.previousPosition);
          focus.elapsed = 0;
          focus.isFocused = false;
        }
      }
    }

    // Animate camera flight if not completed
    if (focus.elapsed < 1) {
      const duration = 0.7; // Smooth pan
      focus.elapsed = Math.min(1, focus.elapsed + delta / duration);
      // Ease-out: start fast, decelerate into position
      const eased = 1 - Math.pow(1 - focus.elapsed, 3);

      camera.position.lerpVectors(focus.start, focus.end, eased);
      if (focus.nodePosition && focus.isFocused) {
        camera.lookAt(focus.nodePosition);
        if (controlsRef.current) {
          controlsRef.current.target.copy(focus.nodePosition);
          controlsRef.current.update();
        }
      } else {
        camera.lookAt(0, 0, 0);
        if (controlsRef.current) {
          controlsRef.current.target.set(0, 0, 0);
          controlsRef.current.update();
        }
      }
    }
  });

  return (
    <>
      {/* Lights — soft architectural */}
      <directionalLight color="#ffffff" intensity={0.8} position={[-3, 5, 4]} />
      <directionalLight color="#f0f0f5" intensity={0.4} position={[4, -2, -1.5]} />
      <ambientLight color="#ffffff" intensity={0.4} />

      {/* Controls */}
      <OrbitControls
        ref={controlsRef}
        enableZoom={true}
        enablePan={false}
        enableRotate={true}
        rotateSpeed={0.6}
        zoomSpeed={0.8}
        dampingFactor={0.07}
        enableDamping={true}
        minDistance={minD}
        maxDistance={maxD}
        minPolarAngle={0.15}
        maxPolarAngle={Math.PI - 0.15}
      />

      {/* Orca layers */}
      <group>
        <GlobeShell />
        <BackgroundField />
        <EdgeField />
        <NodeField />
        <GenrePerimeter />

        <ArtistImageLayer onImageResolved={onImageResolved} />
        <FocusedArtistVisual />
        <ArtistHoverCard />
        <NodeLabels />
        <ExpansionParticles />
        {/* Unexplored text labels removed for a cleaner look with pulsing borders */}
      </group>
    </>
  );
}

export function Orca() {
  const setGraph = useOrcaStore(s => s.setGraph);
  const updatePositions = useOrcaStore(s => s.updatePositions);
  const mergeExpansionData = useOrcaStore(s => s.mergeExpansionData);
  const markExpanded = useOrcaStore(s => s.markExpanded);
  const setExpanding = useOrcaStore(s => s.setExpanding);
  const setLoading = useOrcaStore(s => s.setLoading);
  const setError = useOrcaStore(s => s.setError);
  const isLoading = useOrcaStore(s => s.isLoading);
  const error = useOrcaStore(s => s.error);
  const graph = useOrcaStore(s => s.graph);
  const preloadsLoaded = useOrcaStore(s => s.preloadsLoaded);

  const layoutRef = useRef<ForceLayout | null>(null);
  const expansionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [loadedCount, setLoadedCount] = useState(0);
  const [currentArtistName, setCurrentArtistName] = useState('');
  const [loadingPhase, setLoadingPhase] = useState<'loading' | 'fading' | 'loaded'>('loading');

  const PRELOAD_TARGET = graph ? Math.min(60, graph.nodes.length) : 60;

  // Open IndexedDB persistent cache immediately on component mount
  useEffect(() => {
    persistentImageCache.open().then(() => {
      persistentImageCache.evictIfNeeded(); // silent housekeeping
    });
  }, []);

  // Handle smooth transition from loading overlay
  useEffect(() => {
    if ((preloadsLoaded || loadedCount >= PRELOAD_TARGET) && loadingPhase === 'loading') {
      setLoadingPhase('fading');
      
      // Update global store loading completed state
      useOrcaStore.getState().setPreloadsLoaded(true);
    }
  }, [loadedCount, preloadsLoaded, loadingPhase, PRELOAD_TARGET]);

  // Complete transition to loaded after fade animation settles (Section 5.9)
  useEffect(() => {
    if (loadingPhase === 'fading') {
      const timer = setTimeout(() => {
        setLoadingPhase('loaded');
      }, 850); // 800ms transition + 50ms buffer
      return () => clearTimeout(timer);
    }
  }, [loadingPhase]);

  const onImageResolved = useCallback((artistName: string, hasImage: boolean) => {
    setLoadedCount(prev => prev + 1);
    if (hasImage) {
      setCurrentArtistName(artistName);
    }
  }, []);

  async function assessCacheWarmth(nodes: any[]): Promise<'hot' | 'warm' | 'cold'> {
    await persistentImageCache.open();

    const topArtistIds = [...nodes]
      .sort((a, b) => (b.weight || 0) - (a.weight || 0))
      .slice(0, 60)
      .map(a => a.id);

    const cachedCount = await persistentImageCache.countCached(topArtistIds);
    const ratio = cachedCount / topArtistIds.length;

    if (ratio >= 0.9) return 'hot';   // 90%+ cached — near-instant
    if (ratio >= 0.5) return 'warm';  // 50%+ cached — fast
    return 'cold';                    // < 50% cached — normal flow
  }

  // ── Progressive expansion ──
  async function startExpansion() {
    const currentGraph = useOrcaStore.getState().graph;
    const currentExpanded = useOrcaStore.getState().expandedIds;

    if (!currentGraph) return;

    const candidates = getExpansionCandidates(currentGraph, currentExpanded, 10);
    if (candidates.length === 0) {
      setExpanding(false);
      return;
    }

    setExpanding(true);

    try {
      const search = typeof window !== 'undefined' ? window.location.search : '';
      const isDemo = search.includes('demo=true');
      const response = await fetch(`/api/orca/expand${search}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artistIds: candidates, demo: isDemo }),
      });

      if (!response.ok) return;

      const { nodes: newNodes, edges: newEdges } = await response.json();

      if (newNodes && newNodes.length > 0) {
        // Merge into store
        mergeExpansionData(newNodes, newEdges);
        markExpanded(candidates);

        // Update layout with new nodes
        if (layoutRef.current) {
          layoutRef.current.addNodes(newNodes, newEdges);

          // Run some simulation ticks for the new nodes
          for (let i = 0; i < 100; i++) {
            layoutRef.current.tick();
          }

          // Update genre centroids
          const currentGraphAfterMerge = useOrcaStore.getState().graph;
          if (currentGraphAfterMerge) {
            layoutRef.current.updateGenreCentroids(currentGraphAfterMerge);
          }

          // Merge only NEW node positions into existing map — don't disturb existing nodes
          const allPositions = layoutRef.current.getPositions();
          const existingPositions = useOrcaStore.getState().nodePositions;
          const merged = new Map(existingPositions);
          const newIds = new Set(newNodes.map((n: any) => n.id));
          for (const [id, pos] of allPositions) {
            if (newIds.has(id)) {
              merged.set(id, pos);
            }
          }
          updatePositions(merged);
        }
      }

      // Continue expanding after delay (max 3 rounds)
      const totalExpanded = useOrcaStore.getState().expandedIds.size;
      if (totalExpanded < 800) {
        expansionTimerRef.current = setTimeout(() => startExpansion(), 2500);
      } else {
        setExpanding(false);
      }
    } catch (err) {
      console.error('Expansion error:', err);
      setExpanding(false);
    }
  }

  // ── Load initial orca data ──
  useEffect(() => {
    let cancelled = false;
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    const snapshotVersionRef = { current: -1 };

    function mergeGiaSnapshot(dest: any, src: any): boolean {
      if (!dest || !src) return false;
      let changed = false;
      const keys = [
        'relationship', 'identity', 'growth', 'currentSession',
        'discovery', 'opportunities', 'history', 'confidence', 'availableActions'
      ];
      for (const key of keys) {
        if (src[key]) {
          if (!dest[key]) {
            dest[key] = {};
            changed = true;
          }
          for (const k of Object.keys(src[key])) {
            if (Array.isArray(src[key][k])) {
              const destArr = dest[key][k] || [];
              const srcArr = src[key][k];
              if (JSON.stringify(destArr) !== JSON.stringify(srcArr)) {
                dest[key][k] = [...srcArr];
                changed = true;
              }
            } else if (dest[key][k] !== src[key][k]) {
              dest[key][k] = src[key][k];
              changed = true;
            }
          }
        }
      }
      return changed;
    }

    async function loadOrca() {
      setLoading(true);
      setError(null);

      const search = typeof window !== 'undefined' ? window.location.search : '';
      // Prefer readiness tier (Change D); fall back to legacy depth for old links
      const globeSearch = (() => {
        const p = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
        if (!p.has('tier') && !p.has('depth') && !p.has('slider')) {
          // Server will default to Readiness Model recommendation
        }
        const q = p.toString();
        return q ? `?${q}` : '';
      })();

      const poll = async (): Promise<any> => {
        if (cancelled) return;
        const res = await fetch(`/api/globe${globeSearch}`);
        if (!res.ok) {
          if (res.status === 401) {
            throw new Error('Unauthorized. Please connect your Spotify account.');
          }
          throw new Error(`Failed to fetch globe data (HTTP ${res.status}).`);
        }
        const data = await res.json();

        if (data.status === 'syncing') {
          await new Promise(resolve => setTimeout(resolve, 2000));
          return poll();
        }

        if (data.status === 'no_data' || data.status === 'syncing') {
          // First login, trigger user sync
          if (data.status === 'no_data') {
            await fetch(`/api/user/sync${search}`, { method: 'POST' });
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
          return poll();
        }

        if (data.status === 'error') {
          throw new Error('Spotify sync failed. Please try again.');
        }

        if (data.status === 'ready') {
          // Ticket 4: globe never materializes — client must request write path.
          if (data.needsMaterialization) {
            await fetch(`/api/world/regenerate${search}`, { method: 'POST' }).catch(() => {});
            await new Promise(resolve => setTimeout(resolve, 2000));
            return poll();
          }
          return data;
        }

        throw new Error('Unknown response state.');
      };

      try {
        const responseData = await poll();
        if (cancelled || !responseData) return;

        const { nodes, edges, homeRegion, tasteSummary, snapshotVersion } = responseData;

        if (!nodes || nodes.length === 0 || !edges) {
          setError('No Spotify artist data found. Try connecting a different account.');
          setLoading(false);
          return;
        }

        if (snapshotVersion !== undefined) {
          snapshotVersionRef.current = snapshotVersion;
        }

        const storeState = useOrcaStore.getState();
        storeState.setHomeRegion(homeRegion ?? null);
        if (tasteSummary) storeState.setTasteSummary(tasteSummary);

        const isOcseV2 = snapshotVersion !== undefined;
        let exploredNodes = nodes;
        if (isOcseV2) {
          exploredNodes = nodes.filter((n: any) => n.state === 'explored');
          let frontierNodes = nodes.filter((n: any) => n.state === 'frontier');
          // Repair stale snapshots (all reachable=false / flat distances) then depth-filter
          const { prepareFrontierForDisplay } = await import(
            '@/lib/frontier/prepare-frontier'
          );
          const { applyProjectionVisibility } = await import(
            '@/lib/frontier/world-projection'
          );
          frontierNodes = prepareFrontierForDisplay(frontierNodes).nodes;
          const { applyTierEmphasis } = await import(
            '@/lib/frontier/world-projection'
          );
          const urlTier =
            typeof window !== 'undefined'
              ? (new URLSearchParams(window.location.search).get('tier') as
                  | 'comfort'
                  | 'expansion'
                  | 'leap'
                  | null)
              : null;
          const recommended =
            (responseData.recommendedTier as 'comfort' | 'expansion' | 'leap' | undefined) ||
            (responseData.readinessState?.recommendedTier as
              | 'comfort'
              | 'expansion'
              | 'leap'
              | undefined) ||
            'expansion';
          const tier =
            urlTier && ['comfort', 'expansion', 'leap'].includes(urlTier)
              ? urlTier
              : recommended;

          const { normalizeSurfaceIds, nodeIdsForExplorationDepth, bucketToExplorationDepth } =
            await import('@/lib/config/world');
          const surfaceBucketIds = responseData.recommendationSurface
            ? {
                comfort: normalizeSurfaceIds(
                  responseData.recommendationSurface.comfort,
                ),
                expansion: normalizeSurfaceIds(
                  responseData.recommendationSurface.expansion,
                ),
                leap: normalizeSurfaceIds(
                  responseData.recommendationSurface.leap,
                ),
              }
            : null;
          storeState.setReadinessPayload({
            recommendedTier: recommended as
              | 'comfort'
              | 'expansion'
              | 'leap'
              | null,
            readinessReasoning:
              responseData.readinessState?.reasoning ||
              responseData.recommendationSurface?.readiness?.reasoning ||
              '',
            leapBucketFallback:
              responseData.leapBucketFallback ??
              responseData.recommendationSurface?.leapBucketFallback ??
              false,
            shoreBucketFallback:
              responseData.shoreBucketFallback ??
              responseData.recommendationSurface?.shoreBucketFallback ??
              false,
            distanceVarianceCollapsed:
              responseData.distanceVarianceCollapsed ??
              responseData.recommendationSurface?.distanceVarianceCollapsed ??
              false,
            surfaceBucketIds,
          });

          // Match HUD depth (URL depth= or recommended tier)
          const depthParam =
            typeof window !== 'undefined'
              ? new URLSearchParams(window.location.search).get('depth')
              : null;
          const depthId =
            depthParam === 'close' ||
            depthParam === 'far' ||
            depthParam === 'farther' ||
            depthParam === 'all' ||
            depthParam === 'shore' ||
            depthParam === 'shallow' ||
            depthParam === 'deep' ||
            depthParam === 'alo'
              ? depthParam
              : bucketToExplorationDepth(
                  recommended as 'comfort' | 'expansion' | 'leap',
                );
          // Full universe → store filters by current explorationDepth
          storeState.setFrontierUniverse(frontierNodes);
        }

        // Build the graph (adds genre + audio-similarity edges)
        const orcaGraph = buildGraph(exploredNodes, edges);

        // Create force layout
        const { createLayout } = await import('@/lib/graph/layout');
        const layout = await createLayout(orcaGraph);
        layout.initialize();
        layoutRef.current = layout;

        // Update genre centroids after layout settles
        layout.updateGenreCentroids(orcaGraph);

        // Set graph and positions in store
        setGraph(orcaGraph);
        updatePositions(layout.getPositions());
        useObservationStore.getState().fetchObservations(search);

        // Assess cache warmth BEFORE starting the queue gates (Section 8)
        const warmth = await assessCacheWarmth(orcaGraph.nodes);
        if (warmth === 'hot') {
          setLoadingPhase('loaded');
          useOrcaStore.getState().setPreloadsLoaded(true);
        } else {
          setLoadingPhase('loading');
          useOrcaStore.getState().setPreloadsLoaded(false);
        }

        if (!cancelled) {
          setLoading(false);
        }

        // Fetch and poll frontier data in parallel (non-blocking progressive loading)


        // Start progressive expansion after a short delay
        if (!cancelled) {
          expansionTimerRef.current = setTimeout(() => {
            startExpansion();
          }, 3000);
        }

        // Background polling for Dynamic Backend Synchronization
        if (layoutRef.current) {
          pollInterval = setInterval(async () => {
            if (cancelled) return;
            try {
              const currentSearch = typeof window !== 'undefined' ? window.location.search : '';
              const versionSuffix = `&version=${snapshotVersionRef.current}`;
              const res = await fetch(`/api/globe${currentSearch ? `${currentSearch}${versionSuffix}` : `?${versionSuffix.slice(1)}`}`);
              if (!res.ok) return;
              const data = await res.json();
              
              if (data.status === 'ready') {
                if (data.upToDate) {
                  return; // Up to date, no changes!
                }

                const currentStore = useOrcaStore.getState();
                const currentGraph = currentStore.graph;
                if (!currentGraph) return;

                // Refresh readiness/honesty flags from the server payload.
                // Without this, a once-true fallback flag (e.g. persisted from an
                // old materialization) survives the whole session even after a
                // successful rebuild — the persistent "Rebuild frontier" banner.
                if (
                  data.leapBucketFallback !== undefined ||
                  data.shoreBucketFallback !== undefined ||
                  data.distanceVarianceCollapsed !== undefined ||
                  data.recommendationSurface ||
                  data.readinessState
                ) {
                  try {
                    const { normalizeSurfaceIds } = await import(
                      '@/lib/config/world'
                    );
                    const pollSurfaceBucketIds =
                      data.recommendationSurface
                        ? {
                            comfort: normalizeSurfaceIds(
                              data.recommendationSurface.comfort,
                            ),
                            expansion: normalizeSurfaceIds(
                              data.recommendationSurface.expansion,
                            ),
                            leap: normalizeSurfaceIds(
                              data.recommendationSurface.leap,
                            ),
                          }
                        : null;
                    currentStore.setReadinessPayload({
                      recommendedTier: (data.recommendedTier ??
                        data.recommendationSurface?.readiness?.recommendedTier ??
                        currentStore.recommendedTier) as
                        | 'comfort'
                        | 'expansion'
                        | 'leap'
                        | null,
                      readinessReasoning:
                        data.readinessState?.reasoning ||
                        data.recommendationSurface?.readiness?.reasoning ||
                        '',
                      leapBucketFallback:
                        data.leapBucketFallback ??
                        data.recommendationSurface?.leapBucketFallback ??
                        false,
                      shoreBucketFallback:
                        data.shoreBucketFallback ??
                        data.recommendationSurface?.shoreBucketFallback ??
                        false,
                      distanceVarianceCollapsed:
                        data.distanceVarianceCollapsed ??
                        data.recommendationSurface?.distanceVarianceCollapsed ??
                        false,
                      surfaceBucketIds: pollSurfaceBucketIds,
                    });
                  } catch {
                    /* non-fatal: poll still merges nodes below */
                  }
                }

                const newNodes = data.nodes || [];
                const newEdges = data.edges || [];
                const newGenres = data.genres || [];
                const delta = data.worldDelta || { added: [], removed: [], changed: [] };

                let graphChanged = false;
                let layoutChanged = false;
                const nodesToAdd: any[] = [];
                const edgesToAdd: any[] = [];


                  // 1. Process removed nodes
                  if (delta.removed && delta.removed.length > 0) {
                    const removedSet = new Set(delta.removed);
                    currentGraph.nodes = currentGraph.nodes.filter(n => !removedSet.has(n.id));
                    const updatedUniverse = (
                      currentStore.frontierUniverse.length
                        ? currentStore.frontierUniverse
                        : currentStore.frontierNodes
                    ).filter((n) => !removedSet.has(n.id));
                    currentStore.setFrontierUniverse(updatedUniverse);
                    graphChanged = true;
                  }

                  // 2. Process added and changed nodes
                  newNodes.forEach((newNode: any) => {
                    if (newNode.state === 'explored') {
                      const existingNode = currentGraph.nodes.find(n => n.id === newNode.id);
                      if (existingNode) {
                        let nodeChanged = false;
                        const scalarKeys = [
                          'relationshipState', 'memoryStrength',
                          'weight', 'bridgeArtist', 'gatewayArtist', 'destinationArtist', 'alreadyIntegrated',
                          'recommendedNext', 'discoveredRecently', 'memoryContribution',
                          'reachable', 'semanticRole', 'confidenceBand', 'reasoning',
                          'audioSource', 'expansionDistance', 'expansionBand',
                        ];
                        const eNodeAny = existingNode as any;
                        const nNodeAny = newNode as any;
                        for (const k of scalarKeys) {
                          if (eNodeAny[k] !== nNodeAny[k]) {
                            eNodeAny[k] = nNodeAny[k];
                            nodeChanged = true;
                          }
                        }
                        if (JSON.stringify(existingNode.availableActions) !== JSON.stringify(newNode.availableActions)) {
                          existingNode.availableActions = newNode.availableActions;
                          nodeChanged = true;
                        }
                        if (nodeChanged) graphChanged = true;
                      } else {
                        nodesToAdd.push(newNode);
                        graphChanged = true;
                        layoutChanged = true;
                      }
                    } else if (newNode.state === 'frontier') {
                      const uni =
                        currentStore.frontierUniverse.length > 0
                          ? currentStore.frontierUniverse
                          : currentStore.frontierNodes;
                      const existingFrontier = uni.find((n) => n.id === newNode.id);
                      if (existingFrontier) {
                        let nodeChanged = false;
                        const scalarKeys = [
                          'relationshipState', 'memoryStrength',
                          'weight', 'bridgeArtist', 'gatewayArtist', 'destinationArtist', 'alreadyIntegrated',
                          'recommendedNext', 'discoveredRecently', 'memoryContribution',
                          'reachable', 'semanticRole', 'confidenceBand', 'reasoning',
                          'audioSource', 'expansionDistance', 'expansionBand',
                        ];
                        const eNodeAny = existingFrontier as any;
                        const nNodeAny = newNode as any;
                        for (const k of scalarKeys) {
                          if (eNodeAny[k] !== nNodeAny[k]) {
                            eNodeAny[k] = nNodeAny[k];
                            nodeChanged = true;
                          }
                        }
                        if (JSON.stringify(existingFrontier.availableActions) !== JSON.stringify(newNode.availableActions)) {
                          existingFrontier.availableActions = newNode.availableActions;
                          nodeChanged = true;
                        }
                        if (nodeChanged) {
                          currentStore.setFrontierUniverse([...uni]);
                        }
                      } else {
                        currentStore.setFrontierUniverse([...uni, newNode]);
                      }
                    }
                  });


                // 3. Detect new edges
                newEdges.forEach((newEdge: any) => {
                  const srcId = typeof newEdge.source === 'string' ? newEdge.source : newEdge.source.id;
                  const tgtId = typeof newEdge.target === 'string' ? newEdge.target : newEdge.target.id;
                  const edgeExists = currentGraph.edges.some(e => {
                    const s = typeof e.source === 'string' ? e.source : e.source.id;
                    const t = typeof e.target === 'string' ? e.target : e.target.id;
                    return (s === srcId && t === tgtId) || (s === tgtId && t === srcId);
                  });
                  if (!edgeExists) {
                    edgesToAdd.push(newEdge);
                    graphChanged = true;
                  }
                });

                // 4. Apply updates to layout if new nodes/edges added
                if (layoutChanged && layoutRef.current && nodesToAdd.length > 0) {
                  layoutRef.current.addNodes(nodesToAdd, edgesToAdd);
                  // Warm up layout slightly for new nodes
                  for (let i = 0; i < 60; i++) {
                    layoutRef.current.tick();
                  }
                  // Merge only NEW node positions — don't disturb existing nodes
                  const allPollPositions = layoutRef.current.getPositions();
                  const existingPollPositions = currentStore.nodePositions;
                  const mergedPoll = new Map(existingPollPositions);
                  const newPollIds = new Set(nodesToAdd.map((n: any) => n.id));
                  for (const [id, pos] of allPollPositions) {
                    if (newPollIds.has(id)) {
                      mergedPoll.set(id, pos);
                    }
                  }
                  currentStore.updatePositions(mergedPoll);
                }

                // 5. Merge genre states (GIA reference stable merge)
                currentGraph.genres.forEach(region => {
                  const backendGenre = newGenres.find((g: any) => g.name.toLowerCase() === region.name.toLowerCase());
                  if (backendGenre) {
                    const changed = mergeGiaSnapshot(region, backendGenre);
                    if (changed) graphChanged = true;
                  }
                });

                // 6. Update version ref
                if (data.snapshotVersion !== undefined) {
                  snapshotVersionRef.current = data.snapshotVersion;
                }

                // 7. Trigger react updates
                if (graphChanged) {
                  currentStore.setGraph({ ...currentGraph });
                }
                useObservationStore.getState().fetchObservations(search);
              }
            } catch (err) {
              console.error('Background synchronization failed:', err);
            }
          }, 8000);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load orca:', err);
          setError(err instanceof Error ? err.message : 'Failed to load orca');
          setLoading(false);
        }
      }
    }

    loadOrca();

    return () => {
      cancelled = true;
      if (expansionTimerRef.current) clearTimeout(expansionTimerRef.current);
      if (pollInterval) clearInterval(pollInterval);
      layoutRef.current?.stop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <BackgroundGradientAnimation interactive={false} />

      {graph && (
        <Canvas
          camera={{ position: [0, 0.2, 7.2], fov: 45, near: 0.1, far: 100 }}
          gl={{
            antialias: true,
            alpha: true,
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: 1.0,
            preserveDrawingBuffer: true,
          }}
          style={{ background: 'transparent', zIndex: 0 }}
        >
          <OrcaScene onImageResolved={onImageResolved} />
        </Canvas>
      )}

      {graph && loadingPhase === 'loaded' && <OrcaHUD />}

      {/* Loading Overlay */}
      {loadingPhase !== 'loaded' && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          background: 'transparent',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: "'Inter', system-ui, sans-serif",
          gap: '24px',
          zIndex: 9999,
          opacity: loadingPhase === 'loading' ? 1 : 0,
          transition: 'opacity 800ms cubic-bezier(0.4, 0, 0.2, 1)',
          pointerEvents: loadingPhase === 'loading' ? 'auto' : 'none',
        }}>
          <RotatingLoadingMessage />
          <div style={{
            width: '100px',
            height: '1px',
            background: 'rgba(0, 0, 0, 0.06)',
            borderRadius: '1px',
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              background: 'rgba(0, 0, 0, 0.3)',
              animation: 'loadingBar 1.8s ease-in-out infinite',
            }} />
          </div>
          <style>{`
            @keyframes loadingBar {
              0% { width: 0%; margin-left: 0%; }
              50% { width: 50%; margin-left: 25%; }
              100% { width: 0%; margin-left: 100%; }
            }
          `}</style>
        </div>
      )}

      {/* Error Overlay */}
      {error && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          background: 'transparent',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: "'Inter', system-ui, sans-serif",
          gap: '16px',
          zIndex: 10000,
          boxShadow: 'inset 0 0 100px rgba(0,0,0,0.03)',
        }}>
          <div style={{ fontSize: '13px', color: '#c44' }}>{error}</div>
          <button
            onClick={async () => {
              try {
                const search = typeof window !== 'undefined' ? window.location.search : '';
                await fetch(`/api/user/sync${search}`, { method: 'POST' });
              } catch (err) {
                console.error('Failed to trigger retry sync:', err);
              }
              window.location.reload();
            }}
            style={{
               background: 'rgba(0,0,0,0.06)',
               border: 'none',
               borderRadius: '8px',
               padding: '8px 20px',
               fontSize: '12px',
               cursor: 'pointer',
               fontFamily: "'Inter', sans-serif",
            }}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
