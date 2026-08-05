import { GenreRegion, OrcaNode, OrcaEdge } from './types';

export interface GenreIntelligenceSnapshotContext {
  userId: string;
  relationships: any[];
  affinities: any[];
  familiarities: any[];
  adoptions: any[];
  memories: any[];
  recentExploredIds: Set<string>;
  artistTerritoryMap: Map<string, any>;
  bridgeArtistIds: Set<string>;
  activeIntervention: any | null;
  genreToTerritoryMap: Map<string, string>;
}

export function buildGenreSnapshot(
  genre: string,
  artistNodes: OrcaNode[],
  ctx: GenreIntelligenceSnapshotContext
) {
  const territoryId = ctx.genreToTerritoryMap.get(genre) || '';
  
  const rel = ctx.relationships.find(r => r.territoryId === territoryId);
  const affinity = ctx.affinities.find(a => a.territoryId === territoryId);
  const familiarity = ctx.familiarities.find(f => f.territoryId === territoryId);
  const adoption = ctx.adoptions.find(a => a.territoryId === territoryId);

  const relState = rel ? rel.currentState : 'UNEXPLORED';

  // Filter artist IDs in this genre
  const genreArtistIds = artistNodes.map(n => n.id);
  const genreMemories = ctx.memories.filter(m => genreArtistIds.includes(m.artistId));
  const avgMemoryStrength = genreMemories.length > 0
    ? genreMemories.reduce((acc, m) => acc + m.memoryStrength, 0) / genreMemories.length
    : 0.0;

  const integratedArtists = genreMemories
    .filter(m => m.memoryState === 'INTERNALIZED' || m.memoryStrength >= 0.7)
    .map(m => m.artistId);

  const reachableArtists = artistNodes
    .filter(n => {
      const tId = ctx.artistTerritoryMap.get(n.id)?.territoryId;
      const tState = ctx.relationships.find(r => r.territoryId === tId)?.currentState || 'UNEXPLORED';
      return tState === 'UNEXPLORED';
    })
    .map(n => n.id);

  const bridgeArtists = artistNodes.filter(n => ctx.bridgeArtistIds.has(n.id)).map(n => n.id);
  const gatewayArtists = artistNodes
    .filter(n => {
      const role = ctx.artistTerritoryMap.get(n.id)?.role;
      return role === 'BORDER' || role === 'GATEWAY';
    })
    .map(n => n.id);

  const recentlyDiscovered = artistNodes.filter(n => ctx.recentExploredIds.has(n.id)).map(n => n.id);

  // Mappings
  const relationship = {
    current: relState,
    confidence: rel ? rel.stateConfidence : 0.5,
    direction: (adoption?.adoptionScore ?? 0) > 0.6 ? 'STABLE' : (adoption?.adoptionScore ?? 0) > 0.2 ? 'GROWING' : 'FADING' as 'STABLE' | 'GROWING' | 'FADING',
    stability: relState === 'RESIDENT' || relState === 'STABILIZED' ? 0.95 : 0.5,
    momentum: adoption ? adoption.adoptionScore * 0.5 : 0.0,
  };

  const identity = {
    strength: affinity ? Math.round(affinity.compatibilityScore * 100) : 0,
    stability: relState === 'RESIDENT' || relState === 'STABILIZED' ? 90 : 40,
    maturity: familiarity ? Math.round(familiarity.familiarityScore * 100) : 0,
    confidence: affinity ? Math.round(affinity.confidence * 100) : 50,
  };

  const growth = {
    tasteMemory: Math.round(avgMemoryStrength * 100),
    tasteExpansion: adoption ? Math.round(adoption.adoptionScore * 100) : 0,
    expansionVelocity: adoption ? Math.round(adoption.adoptionScore * 50) : 0,
    memoryDirection: avgMemoryStrength > 0.6 ? 'STABLE' : avgMemoryStrength > 0.2 ? 'GROWING' : 'FADING' as 'STABLE' | 'GROWING' | 'FADING',
    expansionDirection: (adoption?.adoptionScore ?? 0) > 0.5 ? 'GROWING' : 'STABLE' as 'STABLE' | 'GROWING' | 'FADING',
    confidence: rel ? Math.round(rel.stateConfidence * 100) : 50,
  };

  const currentSession = {
    mindsetCompatibility: affinity ? Math.round(affinity.culturalCompatibility * 100) : 50,
    currentIntentMatch: affinity && affinity.culturalCompatibility > 0.6 ? 85 : 45,
    sessionSuitability: affinity && affinity.compatibilityScore > 0.5 ? 90 : 50,
    immediateReadiness: familiarity && familiarity.familiarityScore > 0.5 ? 95 : 60,
  };

  const discovery = {
    integratedArtists,
    bridgeArtists,
    gatewayArtists,
    reachableArtists,
    recentlyDiscovered,
    potentialDiscoveries: reachableArtists.slice(0, 5),
  };

  const opportunities = {
    expansionOpportunity: familiarity ? familiarity.familiarityScore < 0.4 : true,
    hiddenPotential: affinity ? affinity.hiddenPotential > 0.5 : false,
  };

  const history = {
    firstDiscovery: rel ? rel.lastUpdatedAt.toISOString() : null,
    latestOrganicVisit: rel ? rel.lastUpdatedAt.toISOString() : null,
    previousInterventions: relState === 'RESIDENT' ? 2 : 0,
    longitudinalState: relState,
  };

  const confidence = {
    relationship: rel ? Math.round(rel.stateConfidence * 100) : 50,
    expansion: adoption ? Math.round(adoption.confidence * 100) : 50,
    identity: affinity ? Math.round(affinity.confidence * 100) : 50,
    mindset: affinity ? Math.round(affinity.confidence * 100) : 50,
    discovery: avgMemoryStrength > 0.0 ? 80 : 50,
  };

  const availableActions = {
    canExpand: opportunities.expansionOpportunity,
    canExplore: reachableArtists.length > 0,
    canSave: true,
    canIgnore: true,
  };

  return {
    id: genre.replace(/\s+/g, '-'),
    name: genre,
    color: artistNodes[0] ? getGenreColor(genre) : '#777777',
    centroid: [0, 0, 0] as [number, number, number],
    nodeCount: artistNodes.length,
    nodeIds: genreArtistIds,
    relationship,
    identity,
    growth,
    currentSession,
    discovery,
    opportunities,
    history,
    confidence,
    availableActions,
  };
}

export function buildArtistSnapshot(
  node: any,
  ctx: GenreIntelligenceSnapshotContext
) {
  const mem = ctx.memories.find(m => m.artistId === node.id);
  const territoryId = ctx.artistTerritoryMap.get(node.id)?.territoryId || '';
  const relationshipState = ctx.relationships.find(r => r.territoryId === territoryId)?.currentState || 'UNEXPLORED';

  // Handle Spotify CDN Proxying
  const rawImg = node.imageUrl || '';
  const imageUrl = rawImg
    ? (rawImg.startsWith('/api/') || rawImg.startsWith('data:') ? rawImg : `/api/orca/image-proxy?url=${encodeURIComponent(rawImg)}&demo=true`)
    : '';

  const alreadyIntegrated = mem ? (mem.memoryState === 'INTERNALIZED' || mem.memoryStrength >= 0.7) : false;

  const availableActions = {
    canExplore: relationshipState === 'UNEXPLORED' || relationshipState === 'CURIOUS',
    canSave: !alreadyIntegrated,
    canListen: true,
  };

  return {
    ...node,
    relationshipState,
    memoryStrength: mem ? Math.round(mem.memoryStrength * 100) : null,
    imageUrl,
    
    // V4 Dynamic Artist State Engine fields
    bridgeArtist: ctx.bridgeArtistIds.has(node.id),
    gatewayArtist: ctx.artistTerritoryMap.get(node.id)?.role === 'BORDER' || ctx.artistTerritoryMap.get(node.id)?.role === 'GATEWAY',
    alreadyIntegrated,
    discoveredRecently: ctx.recentExploredIds.has(node.id),
    memoryContribution: mem ? Math.round(mem.persistence * 100) : 0,
    availableActions,
  };
}

// Helpers
function getGenreColor(genreName: string): string {
  let hash = 0;
  for (let i = 0; i < genreName.length; i++) {
    hash = genreName.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    '#2563eb', '#3b82f6', '#1d4ed8', '#1e40af', '#0284c7', '#0369a1',
    '#0d9488', '#0f766e', '#10b981', '#059669', '#16a34a', '#15803d',
    '#7c3aed', '#6d28d9', '#4f46e5', '#4338ca', '#db2777', '#c2185b',
    '#ea580c', '#c2410c', '#e11d48', '#be123c', '#475569', '#334155'
  ];
  const idx = Math.abs(hash) % colors.length;
  return colors[idx];
}
