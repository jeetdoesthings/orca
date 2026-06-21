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
import { FrontierLabels } from './orca/FrontierLabels';
import { FrontierParticles } from './orca/FrontierParticles';
// GeographicGaps removed
import { OrcaHUD } from './OrcaHUD';
import { useOrcaStore } from '@/store/orca';
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
  const [msgIndex, setMsgIndex] = useState(() => Math.floor(Math.random() * LOADING_MESSAGES.length));
  const [fade, setFade] = useState('in'); // 'in' | 'out'

  useEffect(() => {
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
    start: THREE.Vector3;
    end: THREE.Vector3;
    elapsed: number;
    previousPosition: THREE.Vector3;
    isFocused: boolean;
  }>({
    nodeId: null,
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
          const minFocus = isMobile ? 4.6 : 3.2;
          const maxFocus = isMobile ? 6.6 : 5.2;
          const distance = Math.max(minFocus, Math.min(maxFocus, camera.position.length()));

          focus.nodeId = focusedNodeId;
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
      const duration = 0.8; // 800ms duration (within 600-1000ms range)
      focus.elapsed = Math.min(1, focus.elapsed + delta / duration);
      
      // Smooth cubic ease-out
      const eased = 1 - Math.pow(1 - focus.elapsed, 3);

      camera.position.lerpVectors(focus.start, focus.end, eased);
      camera.lookAt(0, 0, 0);
      if (controlsRef.current) {
        controlsRef.current.target.set(0, 0, 0);
        controlsRef.current.update();
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
        <FrontierParticles />
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
      const response = await fetch('/api/orca/expand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artistIds: candidates }),
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

          // Update positions
          const currentGraphAfterMerge = useOrcaStore.getState().graph;
          if (currentGraphAfterMerge) {
            layoutRef.current.updateGenreCentroids(currentGraphAfterMerge);
          }
          updatePositions(layoutRef.current.getPositions());
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

    async function loadOrca() {
      setLoading(true);
      setError(null);

      const search = typeof window !== 'undefined' ? window.location.search : '';

      const poll = async (): Promise<any> => {
        if (cancelled) return;
        const res = await fetch(`/api/user/globe-data${search}`);
        const data = await res.json();

        if (data.status === 'syncing') {
          await new Promise(resolve => setTimeout(resolve, 2000));
          return poll();
        }

        if (data.status === 'no_data') {
          // First login, trigger user sync
          await fetch(`/api/user/sync${search}`, { method: 'POST' });
          await new Promise(resolve => setTimeout(resolve, 2000));
          return poll();
        }

        if (data.status === 'error') {
          throw new Error('Spotify sync failed. Please try again.');
        }

        if (data.status === 'ready') {
          return data;
        }

        throw new Error('Unknown response state.');
      };

      try {
        const responseData = await poll();
        if (cancelled) return;

        const { nodes, edges, homeRegion, tasteSummary } = responseData;

        if (!nodes || nodes.length === 0) {
          setError('No Spotify artist data found. Try connecting a different account.');
          setLoading(false);
          return;
        }

        // Store homeRegion and tasteSummary dynamically in the Zustand store
        const storeState = useOrcaStore.getState() as any;
        storeState.homeRegion = homeRegion;
        storeState.tasteSummary = tasteSummary;

        // Build the graph (adds genre + audio-similarity edges)
        const orcaGraph = buildGraph(nodes, edges);

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
        const loadFrontier = async () => {
          if (cancelled) return;
          try {
            const res = await fetch(`/api/user/frontier${search}`);
            const data = await res.json();
            if (data.status === 'ready' && !cancelled) {
              const store = useOrcaStore.getState();
              store.setFrontierNodes(data.frontierNodes || []);
              store.setPerimeterData(data.perimeterData || []);
              store.setAdventurousness(data.adventurousness || null);
              store.setGeographicGaps(data.geographicGaps || []);
            } else if (data.status === 'computing' && !cancelled) {
              setTimeout(loadFrontier, 3000); // Poll again in 3 seconds
            }
          } catch (err) {
            console.error('Progressive frontier load failed:', err);
          }
        };
        loadFrontier();

        // Start progressive expansion after a short delay
        if (!cancelled) {
          expansionTimerRef.current = setTimeout(() => {
            startExpansion();
          }, 3000);
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
          style={{ background: 'transparent' }}

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
