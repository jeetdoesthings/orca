'use client';

/**
 * Orca — root Three.js canvas component.
 * Composes all visualization layers and orchestrates data loading + layout.
 */
import { useEffect, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { GlobeShell } from './orca/GlobeShell';
import { NodeField } from './orca/NodeField';
import { EdgeField } from './orca/EdgeField';
import { BackgroundField } from './orca/BackgroundField';
import { NodeLabels } from './orca/NodeLabels';
import { OrcaHUD } from './OrcaHUD';
import { useOrcaStore } from '@/store/orca';
import { buildGraph } from '@/lib/graph/builder';
import { getExpansionCandidates } from '@/lib/graph/expander';
import type { ForceLayout } from '@/lib/graph/types';

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
      }, 500); // 500ms to fade out

    }, 3500); // rotate every 3.5 seconds

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
      transition: 'opacity 0.5s ease',
      textAlign: 'center',
    }}>
      {LOADING_MESSAGES[msgIndex]}
    </div>
  );
}

/** Inner scene component that uses R3F hooks */
function OrcaScene() {
  // Gentle ongoing simulation tick for living motion
  // Removed useFrame tick to avoid render loop conflicts — layout is stepped in the effect
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const focusedNodeId = useOrcaStore(s => s.focusedNodeId);
  const positions = useOrcaStore(s => s.nodePositions);
  const focusStateRef = useRef<{
    nodeId: string | null;
    start: THREE.Vector3;
    end: THREE.Vector3;
    elapsed: number;
  }>({
    nodeId: null,
    start: new THREE.Vector3(),
    end: new THREE.Vector3(),
    elapsed: 0,
  });

  useFrame(({ camera }, delta) => {
    if (!focusedNodeId) return;

    const nodePosition = positions.get(focusedNodeId);
    if (!nodePosition) return;

    const focus = focusStateRef.current;
    if (focus.nodeId !== focusedNodeId) {
      const direction = new THREE.Vector3(...nodePosition).normalize();
      const distance = Math.max(3.2, Math.min(5.2, camera.position.length()));
      focus.nodeId = focusedNodeId;
      focus.start.copy(camera.position);
      focus.end.copy(direction.multiplyScalar(distance));
      focus.elapsed = 0;
    }

    if (focus.elapsed < 1) {
      focus.elapsed = Math.min(1, focus.elapsed + delta / 0.85);
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
        minDistance={2.2}
        maxDistance={7}
        minPolarAngle={0}
        maxPolarAngle={Math.PI}
      />

      {/* Orca layers */}
      <group>
        <GlobeShell />
        <BackgroundField />
        <EdgeField />
        <NodeField />
        <NodeLabels />
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

  const layoutRef = useRef<ForceLayout | null>(null);
  const expansionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

      try {
        const response = await fetch('/api/orca');
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${response.status}`);
        }

        const { nodes, edges } = await response.json();

        if (cancelled) return;

        if (!nodes || nodes.length === 0) {
          setError('No MusicBrainz artist metadata found. Try again in a moment.');
          setLoading(false);
          return;
        }

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
        setLoading(false);

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

  // ── Loading State ──
  if (isLoading) {
    return (
      <div style={{
        width: '100vw',
        height: '100vh',
        background: 'radial-gradient(ellipse at 50% 40%, #ffffff 0%, #F7F7F5 60%, #ECEDE8 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'Inter', system-ui, sans-serif",
        gap: '24px',
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
    );
  }

  // ── Error State ──
  if (error) {
    return (
      <div style={{
        width: '100vw',
        height: '100vh',
        background: 'radial-gradient(ellipse at 50% 40%, #ffffff 0%, #F7F7F5 60%, #ECEDE8 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'Inter', system-ui, sans-serif",
        gap: '16px',
      }}>
        <div style={{ fontSize: '13px', color: '#c44' }}>{error}</div>
        <button
          onClick={() => window.location.reload()}
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
    );
  }

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      background: 'radial-gradient(ellipse at 50% 40%, #ffffff 0%, #F7F7F5 60%, #ECEDE8 100%)',
      position: 'relative',
    }}>
      <Canvas
        camera={{ position: [0, 0.2, 3.8], fov: 45, near: 0.1, far: 100 }}
        gl={{
          antialias: true,
          alpha: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.0,
        }}
        style={{ background: 'transparent' }}
      >
        <OrcaScene />
      </Canvas>
      <OrcaHUD />
    </div>
  );
}
