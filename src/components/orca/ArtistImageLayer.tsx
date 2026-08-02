'use client';

/**
 * ArtistImageLayer — renders circular artist profile images on the globe
 * surface when the camera is zoomed in close enough (Node/Artist level).
 *
 * Architecture:
 * - Pre-allocates a pool of 40 Mesh objects (PlaneGeometry + MeshBasicMaterial)
 * - Each frame: identifies the closest front-facing nodes, assigns meshes
 * - Textures are lazy-loaded from Spotify via /api/orca/image and cached
 * - Circular images are created via offscreen Canvas with genre-color border
 * - Smooth opacity transitions when crossing the zoom threshold
 */
import { useRef, useMemo, useCallback, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useOrcaStore } from '@/store/orca';
import { getGenreColor } from '@/lib/graph/genre-normaliser';
import { sharedDisplacedPositions } from './NodeField';
import { persistentImageCache } from '@/lib/imageCache';

const POOL_SIZE = 250;
const R = 1.65;
const ZOOM_THRESHOLD_DESKTOP = 3.0;
const ZOOM_THRESHOLD_MOBILE = 4.8;
const TRANSITION_ZONE = 0.4; // units of distance over which images fade in
const TEXTURE_SIZE = 128;    // px — canvas texture resolution

const MAX_CONCURRENT_PRELOAD = 12; // aggressive during loading screen
const MAX_CONCURRENT_IDLE    = 4;  // gentle during globe interaction

let currentMaxConcurrent = MAX_CONCURRENT_PRELOAD;

// ── Image cache (module-level, survives re-renders) ──
interface ImageCacheEntry {
  texture: THREE.Texture | null;
  status: 'idle' | 'loading' | 'loaded' | 'error';
  imageUrl: string;
}

export const artistImageCache = new Map<string, ImageCacheEntry>();
let activeLoads = 0;
const loadQueue: string[] = [];

// ── Preload tracking variables ──
const targetPreloadKeys = new Set<string>();
const completedPreloadKeys = new Set<string>();
let hasDispatchedPreloadsLoaded = false;
let globalOnImageResolved: ((artistName: string, hasImage: boolean) => void) | null = null;
const artistDisplayNameMap = new Map<string, string>();

function checkPreloadProgress(key: string, hasImage: boolean) {
  if (targetPreloadKeys.has(key) && !completedPreloadKeys.has(key)) {
    completedPreloadKeys.add(key);
    
    if (globalOnImageResolved) {
      const displayName = artistDisplayNameMap.get(key) || key;
      globalOnImageResolved(displayName, hasImage);
    }
    
    // Check if we have met the target preload count (e.g. 60 or fewer if graph is small)
    if (completedPreloadKeys.size >= targetPreloadKeys.size && !hasDispatchedPreloadsLoaded) {
      hasDispatchedPreloadsLoaded = true;
      useOrcaStore.getState().setPreloadsLoaded(true);
    }
  }
}

// ── Export for hover card to read cached data ──
export function getCachedArtistData(artistName: string): ImageCacheEntry | undefined {
  return artistImageCache.get(artistName.toLowerCase().trim());
}

/**
 * Creates a gradient placeholder texture with the artist's initials.
 * CircleGeometry will mask it into a circle automatically.
 */
function createPlaceholderTexture(
  artistName: string,
  genreColor: string,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = genreColor;
  ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

  // Initials
  const initials = artistName
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() || '')
    .join('');

  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = `bold ${TEXTURE_SIZE * 0.32}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initials, TEXTURE_SIZE / 2, TEXTURE_SIZE / 2 + 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function processLoadQueue(genreColorMap: Map<string, string>) {
  while (activeLoads < currentMaxConcurrent && loadQueue.length > 0) {
    const key = loadQueue.shift()!;
    const entry = artistImageCache.get(key);
    if (!entry || entry.status !== 'idle') continue;

    entry.status = 'loading';
    activeLoads++;

    const artistName = key;

    const handleImageData = (imageUrl: string, rateLimited: boolean = false, source?: string) => {
      const updated = artistImageCache.get(key);
      if (!updated) return;

      updated.imageUrl = imageUrl;

      if (!imageUrl) {
        // No image available — use placeholder
        const genreColor = genreColorMap.get(key) || '#888888';
        updated.texture = createPlaceholderTexture(artistName, genreColor);
        
        if (rateLimited) {
          updated.status = 'error';
          setTimeout(() => {
            artistImageCache.delete(key);
          }, 5000);
        } else {
          updated.status = 'loaded';
        }
        checkPreloadProgress(key, false);
        
        activeLoads--;
        processLoadQueue(genreColorMap);
        return;
      }

      // Load the actual image entirely off the main thread to prevent UI freezing
      const loadUrl = imageUrl.startsWith('/api/') || imageUrl.startsWith('data:')
        ? imageUrl
        : `/api/orca/image-proxy?url=${encodeURIComponent(imageUrl)}`;

      fetch(loadUrl)
        .then(r => r.blob())
        .then(blob => {
          // Store in IndexedDB — fire and forget, never awaited
          persistentImageCache.set(key, blob, (source as any) || 'spotify').catch(() => {});
          return createImageBitmap(blob, { imageOrientation: 'flipY' });
        })
        .then(bmp => {
          const tex = new THREE.Texture(bmp);
          
          // Apply aspect-ratio crop (CSS object-fit: cover mapping) to prevent stretching
          const aspect = bmp.width / bmp.height;
          if (aspect > 1) {
            tex.repeat.set(1 / aspect, 1);
            tex.offset.set((1 - 1 / aspect) / 2, 0);
          } else if (aspect < 1) {
            tex.repeat.set(1, aspect);
            tex.offset.set(0, (1 - aspect) / 2);
          }

          tex.needsUpdate = true;
          tex.colorSpace = THREE.SRGBColorSpace;
          updated.texture = tex;
          updated.status = 'loaded';
          checkPreloadProgress(key, true);
          activeLoads--;
          
          // Speed mode: bypass requestAnimationFrame delay during loading screen to fetch in parallel instantly
          if (useOrcaStore.getState().preloadsLoaded) {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                processLoadQueue(genreColorMap);
              });
            });
          } else {
            processLoadQueue(genreColorMap);
          }
        })
        .catch(() => {
          const genreColor = genreColorMap.get(key) || '#888888';
          updated.texture = createPlaceholderTexture(artistName, genreColor);
          updated.status = 'error';
          checkPreloadProgress(key, false);
          activeLoads--;
          
          if (useOrcaStore.getState().preloadsLoaded) {
            setTimeout(() => processLoadQueue(genreColorMap), 50);
          } else {
            processLoadQueue(genreColorMap);
          }
        });
    };

    // ── IndexedDB persistent cache check — returns in < 5ms if cached ──
    persistentImageCache.get(key)
      .then(cachedBlob => {
        if (cachedBlob) {
          return createImageBitmap(cachedBlob, { imageOrientation: 'flipY' })
            .then(bmp => {
              const tex = new THREE.Texture(bmp);
              
              // Apply aspect-ratio crop (CSS object-fit: cover mapping) to prevent stretching
              const aspect = bmp.width / bmp.height;
              if (aspect > 1) {
                tex.repeat.set(1 / aspect, 1);
                tex.offset.set((1 - 1 / aspect) / 2, 0);
              } else if (aspect < 1) {
                tex.repeat.set(1, aspect);
                tex.offset.set(0, (1 - aspect) / 2);
              }

              tex.needsUpdate = true;
              tex.colorSpace = THREE.SRGBColorSpace;
              entry.texture = tex;
              entry.status = 'loaded';
              checkPreloadProgress(key, true);
              activeLoads--;
              
              if (useOrcaStore.getState().preloadsLoaded) {
                requestAnimationFrame(() => {
                  requestAnimationFrame(() => {
                    processLoadQueue(genreColorMap);
                  });
                });
              } else {
                processLoadQueue(genreColorMap);
              }
            })
            .catch(() => {
              // If blob decoding fails, evict and fall back to network
              persistentImageCache.delete(key);
              if (entry.imageUrl) {
                handleImageData(entry.imageUrl);
              } else {
                fetch(`/api/orca/image?artist=${encodeURIComponent(artistName)}`)
                  .then(res => res.json())
                  .then(data => {
                    handleImageData(data.imageUrl || '', data.rateLimited, data.source);
                  })
                  .catch(() => {
                    const updated = artistImageCache.get(key);
                    if (updated) {
                      const genreColor = genreColorMap.get(key) || '#888888';
                      updated.texture = createPlaceholderTexture(artistName, genreColor);
                      updated.status = 'error';
                      checkPreloadProgress(key, false);
                    } else {
                      checkPreloadProgress(key, false);
                    }
                    activeLoads--;
                    if (useOrcaStore.getState().preloadsLoaded) {
                      setTimeout(() => processLoadQueue(genreColorMap), 50);
                    } else {
                      processLoadQueue(genreColorMap);
                    }
                  });
              }
            });
        } else {
          // Cache miss — run standard API resolution
          if (entry.imageUrl) {
            handleImageData(entry.imageUrl);
          } else {
            fetch(`/api/orca/image?artist=${encodeURIComponent(artistName)}`)
              .then(res => res.json())
              .then(data => {
                handleImageData(data.imageUrl || '', data.rateLimited, data.source);
              })
              .catch(() => {
                const updated = artistImageCache.get(key);
                if (updated) {
                  const genreColor = genreColorMap.get(key) || '#888888';
                  updated.texture = createPlaceholderTexture(artistName, genreColor);
                  updated.status = 'error';
                  checkPreloadProgress(key, false);
                } else {
                  checkPreloadProgress(key, false);
                }
                activeLoads--;
                if (useOrcaStore.getState().preloadsLoaded) {
                  setTimeout(() => processLoadQueue(genreColorMap), 50);
                } else {
                  processLoadQueue(genreColorMap);
                }
              });
          }
        }
      })
      .catch(() => {
        // Fallback to standard network on any DB failure
        if (entry.imageUrl) {
          handleImageData(entry.imageUrl);
        } else {
          fetch(`/api/orca/image?artist=${encodeURIComponent(artistName)}`)
            .then(res => res.json())
            .then(data => {
              handleImageData(data.imageUrl || '', data.rateLimited, data.source);
            })
            .catch(() => {
              const updated = artistImageCache.get(key);
              if (updated) {
                const genreColor = genreColorMap.get(key) || '#888888';
                updated.texture = createPlaceholderTexture(artistName, genreColor);
                updated.status = 'error';
                checkPreloadProgress(key, false);
              } else {
                checkPreloadProgress(key, false);
              }
              activeLoads--;
              if (useOrcaStore.getState().preloadsLoaded) {
                setTimeout(() => processLoadQueue(genreColorMap), 50);
              } else {
                processLoadQueue(genreColorMap);
              }
            });
        }
      });
  }
}

// ── Shared radius function (matches NodeField) ──
function getNodeRadius(weight: number): number {
  if (weight > 0.8) return 0.028;
  if (weight > 0.5) return 0.022;
  if (weight > 0.2) return 0.016;
  return 0.013;
}

export function ArtistImageLayer({ onImageResolved }: { onImageResolved?: (artistName: string, hasImage: boolean) => void }) {
  const graph = useOrcaStore(s => s.graph);
  const frontierNodes = useOrcaStore(s => s.frontierNodes);
  const preloadsLoaded = useOrcaStore(s => s.preloadsLoaded);
  const focusedNodeId = useOrcaStore(s => s.focusedNodeId);
  const pinnedNodeId = useOrcaStore(s => s.pinnedNodeId);
  const { camera, size } = useThree();
  const isMobile = size.width < 640;

  // Combine graph nodes and frontier nodes
  const allNodes = useMemo(() => {
    if (!graph) return [];
    return [...graph.nodes, ...frontierNodes];
  }, [graph, frontierNodes]);

  // Set the global callback
  useEffect(() => {
    globalOnImageResolved = onImageResolved || null;
  }, [onImageResolved]);

  // Handle variable concurrency limit
  useEffect(() => {
    if (preloadsLoaded) {
      currentMaxConcurrent = MAX_CONCURRENT_IDLE;
    } else {
      currentMaxConcurrent = MAX_CONCURRENT_PRELOAD;
    }
  }, [preloadsLoaded]);

  // Pre-allocate pool of meshes
  const meshRefs = useRef<(THREE.Mesh | null)[]>(new Array(POOL_SIZE).fill(null));

  // CircleGeometry masks the square texture automatically without Canvas 2D masking
  const geometry = useMemo(() => new THREE.CircleGeometry(0.5, 32), []);

  // Use a 1x1 dummy texture to initialize the shader. Without this, dynamically assigning
  // a map later causes the MeshBasicMaterial to recompile its shader program, freezing the UI.
  const dummyTexture = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 1; c.height = 1;
    return new THREE.CanvasTexture(c);
  }, []);

  const materials = useMemo(() => {
    return Array.from({ length: POOL_SIZE }, () =>
      new THREE.MeshBasicMaterial({
        map: dummyTexture,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: true,
        side: THREE.FrontSide, // FrontSide only, saves GPU
      }),
    );
  }, [dummyTexture]);

  // Track which pool slot is assigned to which node
  const slotAssignments = useRef<(string | null)[]>(new Array(POOL_SIZE).fill(null));
  // Per-slot opacity for smooth transitions
  const slotOpacities = useRef<number[]>(new Array(POOL_SIZE).fill(0));
  const slotScaleProgress = useRef<number[]>(new Array(POOL_SIZE).fill(1)); // smooth scale progress for focus transitions

  const _obj = useMemo(() => new THREE.Object3D(), []);
  const _outward = useMemo(() => new THREE.Vector3(), []);
  const _camDir = useMemo(() => new THREE.Vector3(), []);
  const _nodeDir = useMemo(() => new THREE.Vector3(), []);

  // Throttle the expensive array sorting to avoid freezing (4 times per second)
  const lastSortTime = useRef(0);
  const topNodesRef = useRef<{ idx: number; facing: number; id: string }[]>([]);

  // Build a map of artist name (lowercase) → genre color for texture creation
  const genreColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of allNodes) {
      const key = node.name.toLowerCase().trim();
      const color = getGenreColor((node.genres[0] || '').toLowerCase());
      map.set(key, color);
    }
    return map;
  }, [allNodes]);

  const requestImageLoad = useCallback(
    (artistName: string) => {
      const key = artistName.toLowerCase().trim();
      if (artistImageCache.has(key)) return;

      const node = allNodes.find(n => n.name.toLowerCase().trim() === key);
      const preCachedImageUrl = node?.imageUrl || '';

      artistImageCache.set(key, {
        texture: null,
        status: 'idle',
        imageUrl: preCachedImageUrl,
      });
      loadQueue.push(key);
      processLoadQueue(genreColorMap);
    },
    [allNodes, genreColorMap],
  );

  // Preload top 150 most popular artists on startup for instant hover response
  useEffect(() => {
    if (allNodes.length === 0) return;

    const popularNodes = [...allNodes]
      .sort((a, b) => (b.popularity || 0) - (a.popularity || 0));

    // Define top 60 as targets to wait for loading screen completion (Section 4.1)
    const targetNodes = popularNodes.slice(0, Math.min(60, popularNodes.length));
    targetPreloadKeys.clear();
    completedPreloadKeys.clear();
    hasDispatchedPreloadsLoaded = false;

    artistDisplayNameMap.clear();
    for (const node of popularNodes) {
      const key = node.name.toLowerCase().trim();
      artistDisplayNameMap.set(key, node.name);
    }

    for (const node of targetNodes) {
      targetPreloadKeys.add(node.name.toLowerCase().trim());
    }

    // If no targets (empty graph), resolve immediately
    if (targetPreloadKeys.size === 0) {
      hasDispatchedPreloadsLoaded = true;
      useOrcaStore.getState().setPreloadsLoaded(true);
    }

    // Queue all 150 popular artists
    const preloadLimit = Math.min(150, popularNodes.length);
    for (let i = 0; i < preloadLimit; i++) {
      const node = popularNodes[i];
      const key = node.name.toLowerCase().trim();
      
      const existing = artistImageCache.get(key);
      if (existing) {
        if (existing.status === 'loaded' || existing.status === 'error') {
          if (targetPreloadKeys.has(key) && !completedPreloadKeys.has(key)) {
            completedPreloadKeys.add(key);
            if (globalOnImageResolved) {
              const displayName = artistDisplayNameMap.get(key) || key;
              globalOnImageResolved(displayName, existing.status === 'loaded');
            }
          }
        }
        continue;
      }

      artistImageCache.set(key, {
        texture: null,
        status: 'idle',
        imageUrl: node.imageUrl || '',
      });
      loadQueue.push(key);
    }

    // Initial check in case they were all already loaded/cached
    if (completedPreloadKeys.size >= targetPreloadKeys.size && !hasDispatchedPreloadsLoaded) {
      hasDispatchedPreloadsLoaded = true;
      useOrcaStore.getState().setPreloadsLoaded(true);
    }

    processLoadQueue(genreColorMap);
  }, [allNodes, genreColorMap]);

  useFrame(() => {
    if (!graph) return;

    // Collect neighbors if pinned
    const directNeighbors = new Set<string>();
    const secondaryNeighbors = new Set<string>();

    if (pinnedNodeId && graph) {
      for (const edge of graph.edges) {
        const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
        const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
        if (sourceId === pinnedNodeId) {
          directNeighbors.add(targetId);
        } else if (targetId === pinnedNodeId) {
          directNeighbors.add(sourceId);
        }
      }
      for (const edge of graph.edges) {
        const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
        const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
        if (sourceId === pinnedNodeId || targetId === pinnedNodeId) continue;
        if (directNeighbors.has(sourceId) && !directNeighbors.has(targetId)) {
          secondaryNeighbors.add(targetId);
        } else if (directNeighbors.has(targetId) && !directNeighbors.has(sourceId)) {
          secondaryNeighbors.add(sourceId);
        }
      }
    }

    const distance = camera.position.length();
    const threshold = isMobile ? ZOOM_THRESHOLD_MOBILE : ZOOM_THRESHOLD_DESKTOP;
    const transitionStart = threshold;
    const transitionEnd = threshold - TRANSITION_ZONE;
    const preloadStart = transitionStart + 1.5;

    // Global image visibility factor (0 = no images, 1 = full images)
    const globalAlpha =
      distance >= transitionStart
        ? 0
        : distance <= transitionEnd
          ? 1
          : (transitionStart - distance) / TRANSITION_ZONE;

    // If completely zoomed out past preload threshold, hide all and return
    if (distance > preloadStart) {
      for (let i = 0; i < POOL_SIZE; i++) {
        const mesh = meshRefs.current[i];
        if (mesh) mesh.visible = false;
        slotOpacities.current[i] = 0;
        materials[i].opacity = 0;
      }
      return;
    }

    // Find the closest front-facing nodes
    _camDir.copy(camera.position).normalize();
    const nodes = allNodes;

    // Only recalculate the expensive sort 4 times a second
    const time = performance.now();
    if (time - lastSortTime.current > 250) {
      lastSortTime.current = time;
      
      const scored: { idx: number; facing: number; id: string }[] = [];

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const pos = sharedDisplacedPositions.get(node.id);
        if (!pos) continue;

        _nodeDir.set(pos[0], pos[1], pos[2]).normalize();
        const facing = _nodeDir.dot(_camDir);

        // Only include front-facing nodes
        if (facing > 0.05) {
          scored.push({ idx: i, facing, id: node.id });
        }
      }

      // Sort by facing and weight. As the camera zooms in closer (distance -> 1.76), we reduce the weight bias 
      // so centered tiny/small nodes directly in front of the camera get slots over far-off large nodes.
      // Additionally, prioritize the pinned node and its direct neighbors at the top to ensure they always get slots.
      const weightBiasFactor = Math.max(0.1, Math.min(3.0, (distance - 1.7) * 1.5));
      scored.sort((a, b) => {
        if (pinnedNodeId) {
          const aPriority = a.id === pinnedNodeId || directNeighbors.has(a.id);
          const bPriority = b.id === pinnedNodeId || directNeighbors.has(b.id);
          if (aPriority && !bPriority) return -1;
          if (!aPriority && bPriority) return 1;
        }

        const aScore = a.facing * (1 + nodes[a.idx].weight * weightBiasFactor);
        const bScore = b.facing * (1 + nodes[b.idx].weight * weightBiasFactor);
        return bScore - aScore;
      });
      topNodesRef.current = scored.slice(0, POOL_SIZE);
    }
    
    const topNodes = topNodesRef.current;
    const topNodeSet = new Set(topNodes.map(n => n.id));

    // Determine which slots need new assignments
    const usedSlots = new Set<number>();
    const nodeToSlot = new Map<string, number>();

    // First pass: keep existing assignments that are still valid
    for (let i = 0; i < POOL_SIZE; i++) {
      const assignedId = slotAssignments.current[i];
      if (assignedId && topNodeSet.has(assignedId)) {
        usedSlots.add(i);
        nodeToSlot.set(assignedId, i);
      }
    }

    // Second pass: assign unassigned top nodes to free slots
    const freeSlots: number[] = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      if (!usedSlots.has(i)) freeSlots.push(i);
    }

    for (const entry of topNodes) {
      if (nodeToSlot.has(entry.id)) continue;
      if (freeSlots.length === 0) break;
      const slot = freeSlots.shift()!;
      slotAssignments.current[slot] = entry.id;
      slotOpacities.current[slot] = 0; // Start faded out
      nodeToSlot.set(entry.id, slot);
      usedSlots.add(slot);
    }

    // Clear unused slots
    for (const slot of freeSlots) {
      slotAssignments.current[slot] = null;
    }

    // Update each slot
    for (let i = 0; i < POOL_SIZE; i++) {
      const mesh = meshRefs.current[i];
      if (!mesh) continue;

      const nodeId = slotAssignments.current[i];
      if (!nodeId) {
        // Reset scale progress for unused slots
        slotScaleProgress.current[i] = 1;
        
        // Fade out unused slot
        slotOpacities.current[i] *= 0.85;
        if (slotOpacities.current[i] < 0.01) {
          mesh.visible = false;
          slotOpacities.current[i] = 0;
          materials[i].opacity = 0;
          // Cleanly reset map to dummyTexture when completely faded out to avoid lingering images
          if (materials[i].map !== dummyTexture) {
            materials[i].map = dummyTexture;
            materials[i].needsUpdate = true;
          }
        } else {
          materials[i].opacity = slotOpacities.current[i];
        }
        continue;
      }

      const node = nodes.find(n => n.id === nodeId);
      if (!node || node.visible === false || node.reachable === false) {
        mesh.visible = false;
        continue;
      }

      const pos = sharedDisplacedPositions.get(nodeId);
      if (!pos) {
        mesh.visible = false;
        continue;
      }

      // Smooth focus scale transition (shrinks pooled image to 0 if focused)
      const isFocused = nodeId === focusedNodeId;
      const targetScale = isFocused ? 0 : 1;
      slotScaleProgress.current[i] += (targetScale - slotScaleProgress.current[i]) * 0.15;
      const currentScale = slotScaleProgress.current[i];

      if (currentScale < 0.01) {
        mesh.visible = false;
        continue;
      }

      // Request image load
      requestImageLoad(node.name);

      const cacheKey = node.name.toLowerCase().trim();
      const cached = artistImageCache.get(cacheKey);
      const hasTexture = cached?.texture != null;

      if (hasTexture && materials[i].map !== cached!.texture) {
        materials[i].map = cached!.texture;
        materials[i].needsUpdate = true;
      }

      if (!hasTexture) {
        // No texture yet — keep hidden and reset to dummy blank texture to avoid displaying old slot images!
        if (materials[i].map !== dummyTexture) {
          materials[i].map = dummyTexture;
          materials[i].needsUpdate = true;
        }
        mesh.visible = false;
        slotOpacities.current[i] *= 0.9;
        materials[i].opacity = slotOpacities.current[i];
        continue;
      }

      // Compute target opacity
      _nodeDir.set(pos[0], pos[1], pos[2]).normalize();
      const facing = _nodeDir.dot(_camDir);
      const visibility = Math.max(0, Math.min(1, (facing + 0.05) / 0.3));

      let isolationFactor = 1.0;
      let bypassZoom = false;
      if (pinnedNodeId) {
        if (nodeId === pinnedNodeId || directNeighbors.has(nodeId)) {
          isolationFactor = 1.0;
          bypassZoom = true; // force-show images of direct connections regardless of zoom level
        } else if (secondaryNeighbors.has(nodeId)) {
          isolationFactor = 0.5;
        } else {
          isolationFactor = 0.15;
        }
      }

      const targetOpacity = (bypassZoom ? 1.0 : globalAlpha) * visibility * isolationFactor;

      // Smooth opacity transition
      slotOpacities.current[i] += (targetOpacity - slotOpacities.current[i]) * 0.12;

      if (slotOpacities.current[i] < 0.01) {
        mesh.visible = false;
        materials[i].opacity = 0;
        // Cleanly reset map to dummyTexture when completely faded out
        if (materials[i].map !== dummyTexture) {
          materials[i].map = dummyTexture;
          materials[i].needsUpdate = true;
        }
        continue;
      }

      mesh.visible = true;
      materials[i].opacity = slotOpacities.current[i];

      // Position and orient the mesh — slightly above the circle for layering
      const nodeRadius = getNodeRadius(node.weight) * currentScale;
      // Image is 85% of the node size (border peeks through)
      const imageScale = nodeRadius * 0.85 * 2;

      _obj.position.set(pos[0], pos[1], pos[2]);
      _obj.scale.set(imageScale, imageScale, imageScale);
      _outward.set(pos[0], pos[1], pos[2]).normalize();
      // Slightly above the surface to avoid z-fighting
      _obj.position.addScaledVector(_outward, 0.001);
      _outward.add(_obj.position);
      _obj.lookAt(_outward);

      mesh.position.copy(_obj.position);
      mesh.scale.copy(_obj.scale);
      mesh.quaternion.copy(_obj.quaternion);
    }
  });

  return (
    <group>
      {Array.from({ length: POOL_SIZE }, (_, i) => (
        <mesh
          key={i}
          ref={el => { meshRefs.current[i] = el; }}
          geometry={geometry}
          material={materials[i]}
          visible={false}
          frustumCulled={false}
        />
      ))}
    </group>
  );
}
