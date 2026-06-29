import { Observation, GenreRegion, OrcaNode, ObservationAction } from './types';
import { readObservations, writeObservations } from './feedback-store';

export function evaluateFeedbackRules(
  userId: string,
  genres: GenreRegion[],
  nodes: OrcaNode[],
  journey: any
): Observation[] {
  const currentObservations = readObservations(userId);
  const candidates: Observation[] = [];

  const makeAction = (name: string, label: string, endpoint: string, method: "POST" | "GET" = "POST", payload?: any): ObservationAction => ({
    name,
    label,
    endpoint,
    method,
    payload
  });

  const now = new Date().toISOString();

  // Evaluate Rules on Genres
  genres.forEach(genre => {
    // 1. Solidified Memory
    if (genre.growth && genre.growth.tasteMemory >= 70) {
      candidates.push({
        id: `obs_solidified_${genre.id}`,
        type: 'SolidifiedMemory',
        summary: `Your familiarity with ${genre.name} solidified`,
        detail: `You've reached ${genre.growth.tasteMemory}% familiarity with ${genre.name}. UK Garage might be within reach now.`,
        priority: 4,
        confidence: (genre.confidence?.relationship ?? 50) / 100,
        timestamp: now,
        relatedEntities: { genreId: genre.id },
        availableActions: [
          makeAction('START_JOURNEY', 'Start Pathway', '/api/journeys', 'POST', { destinationGenreId: genre.id })
        ],
        ttl: 3600,
        status: 'active'
      });
    }

    // 2. Rapid Expansion
    if (genre.growth && genre.growth.tasteExpansion >= 60 && genre.growth.expansionVelocity >= 20) {
      candidates.push({
        id: `obs_expansion_${genre.id}`,
        type: 'RapidExpansion',
        summary: `Rapid growth in ${genre.name}!`,
        detail: `Keep exploring new styles within ${genre.name} to accelerate adoption.`,
        priority: 3,
        confidence: (genre.confidence?.expansion ?? 50) / 100,
        timestamp: now,
        relatedEntities: { genreId: genre.id },
        availableActions: [],
        ttl: 1800,
        status: 'active'
      });
    }

    // 3. Bridge Discovered
    if (genre.opportunities?.journeyAvailable && genre.availableActions?.canStartJourney) {
      candidates.push({
        id: `obs_bridge_${genre.id}`,
        type: 'BridgeDiscovery',
        summary: `Found a new bridge artist for ${genre.name}`,
        detail: `ORCA identified a pathway connection. A journey sequencing is now ready.`,
        priority: 2,
        confidence: (genre.confidence?.journey ?? 85) / 100,
        timestamp: now,
        relatedEntities: { genreId: genre.id },
        availableActions: [
          makeAction('START_JOURNEY', 'Start Pathway', '/api/journeys', 'POST', { destinationGenreId: genre.id })
        ],
        ttl: 1800,
        status: 'active'
      });
    }

    // 5. Identity Shift
    if (genre.identity && genre.identity.strength >= 90) {
      candidates.push({
        id: `obs_identity_${genre.id}`,
        type: 'IdentityShift',
        summary: `${genre.name} is now part of your core identity`,
        detail: `Sustained adoption has cemented ${genre.name} as a cornerstone of your tastes.`,
        priority: 5,
        confidence: (genre.confidence?.identity ?? 50) / 100,
        timestamp: now,
        relatedEntities: { genreId: genre.id },
        availableActions: [],
        ttl: 3600,
        status: 'active'
      });
    }

    // 6. Mindset Match
    if (genre.currentSession && genre.currentSession.mindsetCompatibility >= 80) {
      candidates.push({
        id: `obs_mindset_${genre.id}`,
        type: 'MindsetMatch',
        summary: `${genre.name} matches your current listening mood`,
        detail: `Ideal compatibility for comfort and focus session mindset.`,
        priority: 2,
        confidence: (genre.confidence?.mindset ?? 50) / 100,
        timestamp: now,
        relatedEntities: { genreId: genre.id },
        availableActions: [],
        ttl: 1800,
        status: 'active'
      });
    }

    // 7. Hidden Potential
    if (genre.opportunities?.hiddenPotential) {
      candidates.push({
        id: `obs_potential_${genre.id}`,
        type: 'HiddenPotential',
        summary: `Hidden potential uncovered in ${genre.name}`,
        detail: `Unexplored high-affinity border artists exist inside this region.`,
        priority: 3,
        confidence: 0.75,
        timestamp: now,
        relatedEntities: { genreId: genre.id },
        availableActions: [],
        ttl: 1800,
        status: 'active'
      });
    }

    // 8. Recovery Opportunity
    if (genre.opportunities?.recoveryAvailable) {
      candidates.push({
        id: `obs_recovery_${genre.id}`,
        type: 'RecoveryOpportunity',
        summary: `You can resume the ${genre.name} journey`,
        detail: `Familiarity has dropped but recovery pathways are now active.`,
        priority: 4,
        confidence: 0.8,
        timestamp: now,
        relatedEntities: { genreId: genre.id },
        availableActions: [
          makeAction('RECOVER_JOURNEY', 'Resume Journey', '/api/journeys/active-id/continue', 'POST')
        ],
        ttl: 3600,
        status: 'active'
      });
    }
  });

  // Evaluate Rules on Journey
  if (journey && journey.active && journey.progressPercent >= 40) {
    candidates.push({
      id: `obs_journey_milestone_${journey.id}`,
      type: 'JourneyMilestone',
      summary: `Milestone reached in ${journey.targetTerritory} journey`,
      detail: `You've completed ${journey.currentStep} steps on your active path.`,
      priority: 3,
      confidence: 0.9,
      timestamp: now,
      relatedEntities: { journeyId: journey.id },
      availableActions: [
        makeAction('CONTINUE_JOURNEY', 'Continue', `/api/journeys/${journey.id}/continue`, 'POST')
      ],
      ttl: 3600,
      status: 'active'
    });
  }

  // Evaluate Rules on Nodes
  nodes.forEach(node => {
    if (node.alreadyIntegrated) {
      candidates.push({
        id: `obs_artist_integrated_${node.id}`,
        type: 'ArtistIntegrated',
        summary: `${node.name} added to your library`,
        detail: `Memory solidification initialized for artist.`,
        priority: 2,
        confidence: 0.95,
        timestamp: now,
        relatedEntities: { artistId: node.id },
        availableActions: [],
        ttl: 1800,
        status: 'active'
      });
    }
  });

  // Synthesizer: Merge candidate observations targeting the same genreId
  const synthesized: Observation[] = [];
  const genreCandidatesMap = new Map<string, Observation[]>();

  candidates.forEach(cand => {
    const genreId = cand.relatedEntities.genreId;
    if (genreId) {
      if (!genreCandidatesMap.has(genreId)) {
        genreCandidatesMap.set(genreId, []);
      }
      genreCandidatesMap.get(genreId)!.push(cand);
    } else {
      synthesized.push(cand);
    }
  });

  genreCandidatesMap.forEach((cands, genreId) => {
    if (cands.length <= 1) {
      synthesized.push(...cands);
    } else {
      // Synthesize
      const summaries = cands.map(c => c.summary).join(' & ');
      const details = cands.map(c => c.detail).filter(Boolean).join('\n');
      const maxPriority = Math.max(...cands.map(c => c.priority));
      const avgConfidence = cands.reduce((acc, c) => acc + c.confidence, 0) / cands.length;
      const combinedActions: ObservationAction[] = [];
      cands.forEach(c => {
        c.availableActions.forEach(a => {
          if (!combinedActions.some(ca => ca.name === a.name)) {
            combinedActions.push(a);
          }
        });
      });

      synthesized.push({
        id: `obs_synth_${genreId}_${Date.now()}`,
        type: 'CompositeObservation',
        summary: summaries,
        detail: details,
        priority: maxPriority,
        confidence: avgConfidence,
        timestamp: now,
        relatedEntities: { genreId },
        availableActions: combinedActions,
        ttl: 3600,
        status: 'active'
      });
    }
  });

  // De-duplicate and merge with current items
  const merged = [...currentObservations];

  synthesized.forEach(item => {
    // Check if duplicate item has already been emitted within 24h (regardless of active/acknowledged status)
    const duplicate = merged.some(o => 
      o.type === item.type && 
      o.relatedEntities.genreId === item.relatedEntities.genreId &&
      o.relatedEntities.artistId === item.relatedEntities.artistId &&
      o.relatedEntities.journeyId === item.relatedEntities.journeyId &&
      (Date.now() - new Date(o.timestamp).getTime()) < 24 * 60 * 60 * 1000
    );
    if (!duplicate) {
      merged.push(item);
    }
  });

  // Expire observations after TTL
  const verifiedList = merged.map(item => {
    if (item.status === 'active') {
      const elapsed = (Date.now() - new Date(item.timestamp).getTime()) / 1000;
      if (elapsed >= item.ttl) {
        return { ...item, status: 'acknowledged' } as Observation;
      }
    }
    return item;
  });

  writeObservations(userId, verifiedList);
  return verifiedList.filter(item => item.status === 'active');
}
