import { PrismaClient, UserListeningEvent, UserTrackMemory, UserArtistMemory, UserTerritoryMemory } from '@prisma/client';

const prisma = new PrismaClient();

// Decay settings
const HALF_LIFE_DAYS = 60; // Familiarity halves every 60 days of inactivity
const CORE_HALF_LIFE_MULTIPLIER = 3; // INTERNALIZED memories decay 3x slower

export const AGENCY_WEIGHTS: Record<string, number> = {
  SEARCH: 1.0,
  ARTIST_PAGE: 0.9,
  PLAYLIST_CREATED: 0.9,
  LIBRARY_SAVE: 0.8,
  VOLUNTARY_REVISIT: 0.7,
  RECOMMENDATION: 0.3,
  AUTOPLAY: 0.1,
  BACKGROUND: 0.05,
};

export const EVENT_AGENCY_FALLBACK: Record<string, number> = {
  SAVE: 0.8,
  PLAYLIST_ADD: 0.9,
  REPLAY: 0.6,
  COMPLETE: 0.5,
  PLAY: 0.4,
  SKIP: 0.0,
};

export function classifyMemoryState(strength: number): string {
  if (strength >= 0.8) return 'INTERNALIZED';
  if (strength >= 0.5) return 'FAMILIAR';
  if (strength >= 0.2) return 'KNOWN';
  return 'UNKNOWN';
}

/**
 * Calculates exponential decay on a memory score.
 */
export function applyDecayScore(score: number, lastReinforced: Date, currentDate: Date, isInternalized: boolean): number {
  if (score <= 0.01) return score; // Floor
  const elapsedDays = (currentDate.getTime() - lastReinforced.getTime()) / (1000 * 60 * 60 * 24);
  if (elapsedDays <= 0) return score;

  const halfLife = isInternalized ? HALF_LIFE_DAYS * CORE_HALF_LIFE_MULTIPLIER : HALF_LIFE_DAYS;
  const decayFactor = Math.pow(0.5, elapsedDays / halfLife);
  
  return Math.max(0.01, score * decayFactor); // Never decay to absolute zero
}

export function decayMemoryRecord<T extends { familiarity: number, agency: number, explorationDepth: number, persistence: number, memoryStrength: number, memoryState: string, lastReinforced: Date }>(record: T, currentDate: Date): T {
  const isInternalized = record.memoryState === 'INTERNALIZED';
  const decayedFamiliarity = applyDecayScore(record.familiarity, record.lastReinforced, currentDate, isInternalized);
  const decayedExploration = applyDecayScore(record.explorationDepth, record.lastReinforced, currentDate, isInternalized);
  const decayedPersistence = applyDecayScore(record.persistence, record.lastReinforced, currentDate, isInternalized);
  
  // Agency is a historical average, so we don't decay it as aggressively, maybe slightly pull it towards 0.5?
  // We'll keep agency static for simplicity as it reflects *how* they formed it.
  
  const decayedStrength = calculateMemoryStrength(decayedFamiliarity, record.agency, decayedExploration, decayedPersistence);
  
  return {
    ...record,
    familiarity: decayedFamiliarity,
    explorationDepth: decayedExploration,
    persistence: decayedPersistence,
    memoryStrength: decayedStrength,
    memoryState: classifyMemoryState(decayedStrength),
  };
}

export function calculateMemoryStrength(familiarity: number, agency: number, depth: number, persistence: number): number {
  // Depth matters more than repetition (familiarity). Persistence is critical for long-term.
  // Agency (voluntary) makes memory significantly stronger.
  return Math.min(1.0, familiarity * 0.1 + depth * 0.3 + persistence * 0.35 + agency * 0.25);
}

export async function processListeningEvent(event: UserListeningEvent) {
  if (!event.trackId || !event.territoryId) {
    return; // Cannot build memory without valid track & territory
  }

  const eventDate = event.timestamp;
  const agencyScore = event.initiationType ? (AGENCY_WEIGHTS[event.initiationType] ?? 0.5) : (EVENT_AGENCY_FALLBACK[event.eventType] ?? 0.5);
  
  // 1. UPDATE TRACK MEMORY
  const trackMem = await prisma.userTrackMemory.findUnique({
    where: { userId_trackId: { userId: event.userId, trackId: event.trackId } }
  });

  let newTrackMem;
  if (!trackMem) {
    const depth = event.eventType === 'COMPLETE' ? 0.2 : 0.1;
    newTrackMem = {
      familiarity: 0.1,
      agency: agencyScore,
      explorationDepth: depth,
      persistence: 0.1,
      lastReinforced: eventDate,
    };
  } else {
    const decayed = decayMemoryRecord(trackMem, eventDate);
    
    // Persistence: increase if it's been more than a day since last reinforced
    const daysSince = (eventDate.getTime() - trackMem.lastReinforced.getTime()) / (1000 * 60 * 60 * 24);
    let persistenceGain = 0;
    if (daysSince > 1) {
      persistenceGain = Math.min(0.2, daysSince * 0.01); // Rewards returning over time
    }

    newTrackMem = {
      familiarity: Math.min(1.0, decayed.familiarity + 0.1),
      agency: decayed.agency * 0.8 + agencyScore * 0.2, // Moving average
      explorationDepth: Math.min(1.0, decayed.explorationDepth + (event.eventType === 'COMPLETE' ? 0.05 : 0.01)),
      persistence: Math.min(1.0, decayed.persistence + persistenceGain),
      lastReinforced: eventDate,
    };
  }
  
  const trackStrength = calculateMemoryStrength(newTrackMem.familiarity, newTrackMem.agency, newTrackMem.explorationDepth, newTrackMem.persistence);
  
  await prisma.userTrackMemory.upsert({
    where: { userId_trackId: { userId: event.userId, trackId: event.trackId } },
    update: {
      ...newTrackMem,
      memoryStrength: trackStrength,
      memoryState: classifyMemoryState(trackStrength),
    },
    create: {
      userId: event.userId,
      trackId: event.trackId,
      ...newTrackMem,
      memoryStrength: trackStrength,
      memoryState: classifyMemoryState(trackStrength),
    }
  });

  // 2. UPDATE ARTIST MEMORY
  const artistMem = await prisma.userArtistMemory.findUnique({
    where: { userId_artistId: { userId: event.userId, artistId: event.artistId } }
  });

  let newArtistMem;
  if (!artistMem) {
    newArtistMem = {
      familiarity: 0.05,
      agency: agencyScore,
      explorationDepth: 0.05,
      persistence: 0.05,
      lastReinforced: eventDate,
    };
  } else {
    const decayed = decayMemoryRecord(artistMem, eventDate);
    
    const daysSince = (eventDate.getTime() - artistMem.lastReinforced.getTime()) / (1000 * 60 * 60 * 24);
    let persistenceGain = daysSince > 1 ? Math.min(0.15, daysSince * 0.01) : 0;
    
    // Check if this is a new track for this artist
    const otherTracksByArtist = await prisma.userTrackMemory.count({
      where: { userId: event.userId, trackId: { not: event.trackId } } // In real system, we'd need a track->artist map. For now, assume a proxy.
    });
    // In TME, depth increases significantly when discovering multiple items. We'll simulate this by adding more depth.
    
    newArtistMem = {
      familiarity: Math.min(1.0, decayed.familiarity + 0.05),
      agency: decayed.agency * 0.85 + agencyScore * 0.15,
      explorationDepth: Math.min(1.0, decayed.explorationDepth + 0.05), // +0.05 per track
      persistence: Math.min(1.0, decayed.persistence + persistenceGain),
      lastReinforced: eventDate,
    };
  }

  const artistStrength = calculateMemoryStrength(newArtistMem.familiarity, newArtistMem.agency, newArtistMem.explorationDepth, newArtistMem.persistence);
  
  await prisma.userArtistMemory.upsert({
    where: { userId_artistId: { userId: event.userId, artistId: event.artistId } },
    update: {
      ...newArtistMem,
      memoryStrength: artistStrength,
      memoryState: classifyMemoryState(artistStrength),
    },
    create: {
      userId: event.userId,
      artistId: event.artistId,
      ...newArtistMem,
      memoryStrength: artistStrength,
      memoryState: classifyMemoryState(artistStrength),
    }
  });

  // 3. UPDATE TERRITORY MEMORY
  const terrMem = await prisma.userTerritoryMemory.findUnique({
    where: { userId_territoryId: { userId: event.userId, territoryId: event.territoryId } }
  });

  let newTerrMem;
  if (!terrMem) {
    newTerrMem = {
      familiarity: 0.02,
      agency: agencyScore,
      explorationDepth: 0.02,
      persistence: 0.02,
      lastReinforced: eventDate,
    };
  } else {
    const decayed = decayMemoryRecord(terrMem, eventDate);
    
    const daysSince = (eventDate.getTime() - terrMem.lastReinforced.getTime()) / (1000 * 60 * 60 * 24);
    let persistenceGain = daysSince > 1 ? Math.min(0.1, daysSince * 0.01) : 0;
    
    // Depth should primarily increase when discovering *new* artists/tracks in the territory.
    // For a simple proxy: if the event is a deep dive (ARTIST_PAGE), we increase depth more.
    const isExploration = event.initiationType === 'ARTIST_PAGE' || event.initiationType === 'SEARCH';
    const depthGain = isExploration ? 0.03 : 0.005;

    newTerrMem = {
      familiarity: Math.min(1.0, decayed.familiarity + 0.02),
      agency: decayed.agency * 0.9 + agencyScore * 0.1,
      explorationDepth: Math.min(1.0, decayed.explorationDepth + depthGain), // Increment depth for the territory
      persistence: Math.min(1.0, decayed.persistence + persistenceGain),
      lastReinforced: eventDate,
    };
  }

  const terrStrength = calculateMemoryStrength(newTerrMem.familiarity, newTerrMem.agency, newTerrMem.explorationDepth, newTerrMem.persistence);

  await prisma.userTerritoryMemory.upsert({
    where: { userId_territoryId: { userId: event.userId, territoryId: event.territoryId } },
    update: {
      ...newTerrMem,
      memoryStrength: terrStrength,
      memoryState: classifyMemoryState(terrStrength),
    },
    create: {
      userId: event.userId,
      territoryId: event.territoryId,
      ...newTerrMem,
      memoryStrength: terrStrength,
      memoryState: classifyMemoryState(terrStrength),
    }
  });
}

/**
 * Retrieves territory memory for a user, lazily applying decay to the current date.
 */
export async function getTerritoryMemory(userId: string, territoryId: string, currentDate: Date = new Date()) {
  const mem = await prisma.userTerritoryMemory.findUnique({
    where: { userId_territoryId: { userId, territoryId } }
  });
  
  if (!mem) return null;
  return decayMemoryRecord(mem, currentDate);
}
