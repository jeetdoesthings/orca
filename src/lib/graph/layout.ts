/**
 * Sphere-constrained force-directed layout engine.
 * Uses d3-force-3d with a custom radial projection that pins all nodes
 * to the globe surface at radius R.
 */
import type { OrcaNode, OrcaEdge, OrcaGraph, ForceLayout } from './types';
import { GENRE_ANCHORS, latLngToXYZ, normaliseGenre } from './genre-normaliser';
import type { InternalGenre } from './genre-normaliser';

// d3-force-3d is a CommonJS module, import accordingly
// eslint-disable-next-line @typescript-eslint/no-var-requires
let d3Force: any = null;

async function getD3Force() {
  if (!d3Force) {
    d3Force = await import('d3-force-3d');
  }
  return d3Force;
}

const DEFAULT_R = 1.65;

/**
 * Seeded PRNG for deterministic scatter.
 */
function makeRng(seed: number) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

/**
 * Seed initial positions for nodes on the sphere using deterministic genre anchors.
 * Each node is placed near its genre's lat/lng anchor with power-law scatter.
 */
function seedPositions(nodes: OrcaNode[], radius: number): void {
  const rng = makeRng(42);
  const SCATTER_RADIUS = 22;

  // Phase 1: compute lat/lng for each node from genre anchors
  const latLngs: { lat: number; lng: number }[] = [];

  for (const node of nodes) {
    const primaryGenre = (node.genres[0] || 'pop').toLowerCase() as InternalGenre;
    const anchor = GENRE_ANCHORS[primaryGenre] || GENRE_ANCHORS['pop'];

    // Power scatter — tight core, sparse halo
    const r = SCATTER_RADIUS * Math.pow(rng(), 1.8);
    const theta = rng() * 2 * Math.PI;
    const weight = node.weight || 0.5;
    const tightness = 0.4 + weight * 0.6;
    const finalR = r * (1 - tightness * 0.5);

    latLngs.push({
      lat: anchor.lat + finalR * Math.cos(theta),
      lng: anchor.lng + finalR * Math.sin(theta),
    });
  }

  // Phase 2: repulsion pass (3 iterations — organic, not uniform)
  const MIN_DIST = 2.5;
  const REPULSION_STRENGTH = 0.4;
  for (let iter = 0; iter < 3; iter++) {
    for (let i = 0; i < latLngs.length; i++) {
      for (let j = i + 1; j < latLngs.length; j++) {
        const dLat = latLngs[i].lat - latLngs[j].lat;
        const dLng = latLngs[i].lng - latLngs[j].lng;
        const dist = Math.sqrt(dLat * dLat + dLng * dLng);
        if (dist < MIN_DIST && dist > 0) {
          const push = (MIN_DIST - dist) / dist * REPULSION_STRENGTH;
          latLngs[i].lat += dLat * push;
          latLngs[i].lng += dLng * push;
          latLngs[j].lat -= dLat * push;
          latLngs[j].lng -= dLng * push;
        }
      }
    }
  }

  // Phase 3: convert lat/lng to 3D and assign to nodes
  for (let i = 0; i < nodes.length; i++) {
    const [x, y, z] = latLngToXYZ(latLngs[i].lat, latLngs[i].lng, radius);
    nodes[i].x = x;
    nodes[i].y = y;
    nodes[i].z = z;
    nodes[i].vx = 0;
    nodes[i].vy = 0;
    nodes[i].vz = 0;
  }
}

/**
 * Create a sphere-constrained force-directed layout for the orca graph.
 * All node positions are projected onto the sphere surface after each tick.
 */
export async function createLayout(
  graph: OrcaGraph,
  radius: number = DEFAULT_R
): Promise<ForceLayout> {
  const d3 = await getD3Force();
  const { forceSimulation, forceManyBody, forceLink, forceCenter } = d3;

  // Collect all unique primary genres for seeding
  // (no longer needed — seedPositions reads node.genres[0] directly)

  // Seed initial positions on sphere using deterministic genre anchors
  seedPositions(graph.nodes, radius);

  // Project to sphere helper
  function projectToSphere(x: number, y: number, z: number, r: number): [number, number, number] {
    const len = Math.sqrt(x * x + y * y + z * z);
    if (len === 0) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      return [
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta),
      ];
    }
    return [(x / len) * r, (y / len) * r, (z / len) * r];
  }

  // Prepare link data with string IDs
  const links = graph.edges.map(e => ({
    source: typeof e.source === 'string' ? e.source : e.source.id,
    target: typeof e.target === 'string' ? e.target : e.target.id,
    weight: e.weight,
  }));

  // Create the simulation
  const simulation = forceSimulation()
    .numDimensions(3)
    .nodes(graph.nodes)
    .force('charge', forceManyBody().strength(-0.035).distanceMax(1.5))
    .force('link', forceLink(links)
      .id((d: any) => d.id)
      .strength((d: any) => (d.weight || 0.3) * 0.25)
      .distance(0.35)
    )
    .force('center', forceCenter(0, 0, 0).strength(0.005))
    .alphaDecay(0.015)
    .velocityDecay(0.35)
    .stop(); // Start stopped — we'll control ticking manually

  // Apply genre clustering force manually
  function applyGenreClustering() {
    // Compute genre centroids from current positions
    const genreCentroids = new Map<string, { x: number; y: number; z: number; count: number }>();

    for (const node of graph.nodes) {
      const primary = node.genres[0]?.toLowerCase();
      if (!primary) continue;

      if (!genreCentroids.has(primary)) {
        genreCentroids.set(primary, { x: 0, y: 0, z: 0, count: 0 });
      }
      const c = genreCentroids.get(primary)!;
      c.x += node.x ?? 0;
      c.y += node.y ?? 0;
      c.z += node.z ?? 0;
      c.count++;
    }

    // Normalize centroids
    for (const [, c] of genreCentroids) {
      if (c.count > 0) {
        c.x /= c.count;
        c.y /= c.count;
        c.z /= c.count;
      }
    }

    // Apply gentle force toward genre centroid
    const strength = 0.008;
    for (const node of graph.nodes) {
      const primary = node.genres[0]?.toLowerCase();
      if (!primary) continue;
      const centroid = genreCentroids.get(primary);
      if (!centroid || centroid.count < 2) continue;

      node.vx = (node.vx ?? 0) + (centroid.x - (node.x ?? 0)) * strength;
      node.vy = (node.vy ?? 0) + (centroid.y - (node.y ?? 0)) * strength;
      node.vz = (node.vz ?? 0) + (centroid.z - (node.z ?? 0)) * strength;
    }
  }

  // Project all nodes onto sphere after each tick
  function projectAllToSphere() {
    for (const node of graph.nodes) {
      const [px, py, pz] = projectToSphere(
        node.x ?? 0, node.y ?? 0, node.z ?? 0, radius
      );
      node.x = px;
      node.y = py;
      node.z = pz;
    }
  }

  return {
    initialize() {
      simulation.alpha(1);
      for (let i = 0; i < 300; i++) {
        applyGenreClustering();
        simulation.tick();
        projectAllToSphere();
      }
    },

    tick(): boolean {
      const alpha = simulation.alpha();
      if (alpha < 0.001) return false; // Layout has settled

      applyGenreClustering();
      simulation.alpha(Math.max(alpha, 0.005));
      simulation.tick();
      projectAllToSphere();
      return true;
    },

    getPositions(): Map<string, [number, number, number]> {
      const positions = new Map<string, [number, number, number]>();
      for (const node of graph.nodes) {
        positions.set(node.id, [node.x ?? 0, node.y ?? 0, node.z ?? 0]);
      }
      return positions;
    },

    addNodes(newNodes: OrcaNode[], newEdges: OrcaEdge[]) {
      // Freeze existing nodes so they don't shift when new nodes are added
      for (const node of graph.nodes) {
        if (!newNodes.includes(node) && node.x !== undefined) {
          node.fx = node.x;
          node.fy = node.y;
          node.fz = node.z;
        }
      }

      for (const node of newNodes) {
        const connectedEdge = newEdges.find(e => {
          const src = typeof e.source === 'string' ? e.source : e.source.id;
          const tgt = typeof e.target === 'string' ? e.target : e.target.id;
          return src === node.id || tgt === node.id;
        });

        if (connectedEdge) {
          const existingId = (typeof connectedEdge.source === 'string' ? connectedEdge.source : connectedEdge.source.id) === node.id
            ? (typeof connectedEdge.target === 'string' ? connectedEdge.target : connectedEdge.target.id)
            : (typeof connectedEdge.source === 'string' ? connectedEdge.source : connectedEdge.source.id);
          const existing = graph.nodes.find(n => n.id === existingId);
          if (existing && existing.x !== undefined) {
            const scatter = 0.12;
            node.x = existing.x + (Math.random() - 0.5) * scatter;
            node.y = existing.y! + (Math.random() - 0.5) * scatter;
            node.z = existing.z! + (Math.random() - 0.5) * scatter;
            const [px, py, pz] = projectToSphere(node.x, node.y, node.z, radius);
            node.x = px; node.y = py; node.z = pz;
          }
        }

        graph.nodes.push(node);
      }

      // Add edges
      const newLinks = newEdges.map(e => ({
        source: typeof e.source === 'string' ? e.source : e.source.id,
        target: typeof e.target === 'string' ? e.target : e.target.id,
        weight: e.weight,
      }));
      graph.edges.push(...newEdges);

      // Update simulation
      simulation.nodes(graph.nodes);
      simulation.force('link', forceLink([...links, ...newLinks])
        .id((d: any) => d.id)
        .strength((d: any) => (d.weight || 0.3) * 0.25)
        .distance(0.35)
      );
      links.push(...newLinks);

      // Reheat
      simulation.alpha(0.4);
    },

    stop() {
      simulation.stop();
    },

    updateGenreCentroids(g: OrcaGraph) {
      // Compute centroids from actual node positions and update genre regions
      for (const region of g.genres) {
        let cx = 0, cy = 0, cz = 0, count = 0;
        for (const nodeId of region.nodeIds) {
          const node = g.nodes.find(n => n.id === nodeId);
          if (node && node.x !== undefined) {
            cx += node.x;
            cy += node.y!;
            cz += node.z!;
            count++;
          }
        }
        if (count > 0) {
          region.centroid = [cx / count, cy / count, cz / count];
        }
      }
    },
  };
}
