import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface TEMConfig {
  evaluationWindowDays: number; // e.g., 90
  baselineWindowDays: number; // e.g., 180
  adoptionThresholdMinutes: number; // e.g., 60
  adoptionThresholdSessions: number; // e.g., 3
  durabilityWindows: number; // e.g., 9
  agencyWeights: Record<string, number>;
}

export const DEFAULT_TEM_CONFIG: TEMConfig = {
  evaluationWindowDays: 90,
  baselineWindowDays: 180,
  adoptionThresholdMinutes: 60,
  adoptionThresholdSessions: 3,
  durabilityWindows: 9, // 10 days each if 90 days total
  agencyWeights: {
    SEARCH: 1.0,
    ARTIST_PAGE: 0.9,
    PLAYLIST_CREATED: 0.85,
    LIBRARY_SAVE: 0.8,
    VOLUNTARY_REVISIT: 0.6,
    RECOMMENDATION: 0.3,
    AUTOPLAY: 0.1,
    BACKGROUND: 0.05,
    // Fallbacks for older event types if initiationType is missing
    PLAY: 0.5,
    COMPLETE: 0.5,
    SAVE: 0.8,
    PLAYLIST_ADD: 0.85,
    REPLAY: 0.6,
    SKIP: 0.0,
  }
};

export interface TEMResult {
  score: number;
  adoptedTerritories: number;
  foreignness: number;
  durability: number;
  agency: number;
  meaningfulness: number;
  contributingTerritories: any[];
  evaluationWindow: number;
  confidence: number;
  version: string;
}

/**
 * Normalizes a sum exponentially into a [0, 1] range.
 */
function exponentialNormalize(value: number, scale: number = 0.5): number {
  return 1.0 - Math.exp(-value * scale);
}

export async function calculateTEM(
  userId: string,
  evaluationEndDate: Date,
  config: TEMConfig = DEFAULT_TEM_CONFIG
): Promise<TEMResult> {
  const evalEnd = evaluationEndDate.getTime();
  const evalStart = evalEnd - config.evaluationWindowDays * 24 * 60 * 60 * 1000;
  const baselineStart = evalStart - config.baselineWindowDays * 24 * 60 * 60 * 1000;

  // 1. Fetch all listening events in baseline and evaluation windows
  const events = await prisma.userListeningEvent.findMany({
    where: {
      userId,
      timestamp: {
        gte: new Date(baselineStart),
        lte: new Date(evalEnd),
      },
    },
    orderBy: {
      timestamp: 'asc',
    },
  });

  if (events.length === 0) {
    return {
      score: 0.0,
      adoptedTerritories: 0,
      foreignness: 0,
      durability: 0,
      agency: 0,
      meaningfulness: 0,
      contributingTerritories: [],
      evaluationWindow: config.evaluationWindowDays,
      confidence: 0,
      version: '2.0',
    };
  }

  // Group events by territory
  // Note: events without a territoryId are ignored, as TEM evaluates expansion into territories.
  const territoryEvents = new Map<string, any[]>();
  for (const event of events) {
    if (!event.territoryId) continue;
    if (!territoryEvents.has(event.territoryId)) {
      territoryEvents.set(event.territoryId, []);
    }
    territoryEvents.get(event.territoryId)!.push(event);
  }

  const contributingTerritories = [];
  let sumForeignness = 0;
  let sumDurability = 0;
  let sumAgency = 0;
  let sumMeaningfulness = 0;
  let adoptedCount = 0;

  let totalScoreSum = 0;

  for (const [territoryId, tEvents] of territoryEvents.entries()) {
    const baselineEvents = tEvents.filter(e => e.timestamp.getTime() < evalStart);
    const evalEvents = tEvents.filter(e => e.timestamp.getTime() >= evalStart);

    // --- ADOPTION THRESHOLD ---
    let evalDurationMinutes = 0;
    const sessionIds = new Set<string>();
    for (const e of evalEvents) {
      if (e.durationMs) {
        evalDurationMinutes += e.durationMs / 60000;
      } else {
        // Fallback: estimate 3 minutes per PLAY/COMPLETE
        if (e.eventType === 'COMPLETE') evalDurationMinutes += 3;
        else if (e.eventType === 'PLAY') evalDurationMinutes += 1.5;
      }
      
      // If no explicit sessionId, group by hour for session estimation
      const sessionId = e.sessionId || `sim-sess-${Math.floor(e.timestamp.getTime() / (60 * 60 * 1000))}`;
      sessionIds.add(sessionId);
    }

    if (
      evalDurationMinutes < config.adoptionThresholdMinutes ||
      sessionIds.size < config.adoptionThresholdSessions
    ) {
      // Did not adopt
      continue;
    }

    // --- STEP 2: FOREIGNNESS ---
    let foreignness = 1.0;
    if (baselineEvents.length > 0) {
      // Calculate based on exposure count in baseline
      const exposureCount = baselineEvents.length;
      // High baseline exposure reduces foreignness
      const exposurePenalty = Math.min(1.0, exposureCount / 50.0);
      
      // Calculate based on days since last exposure before evalStart
      const lastBaselineEvent = baselineEvents[baselineEvents.length - 1];
      const daysSinceLastExposure = (evalStart - lastBaselineEvent.timestamp.getTime()) / (24 * 60 * 60 * 1000);
      // If it's been a long time, it becomes somewhat foreign again, but capped
      const recencyPenalty = Math.max(0.0, 1.0 - (daysSinceLastExposure / 180));
      
      foreignness = Math.max(0.0, 1.0 - (exposurePenalty * 0.7 + recencyPenalty * 0.3));
    }

    // --- STEP 3: DURABILITY ---
    // Divide evaluation window into N segments
    const windowDurationMs = (config.evaluationWindowDays * 24 * 60 * 60 * 1000) / config.durabilityWindows;
    const windowCounts = new Array(config.durabilityWindows).fill(0);
    
    for (const e of evalEvents) {
      const msIntoEval = e.timestamp.getTime() - evalStart;
      const windowIndex = Math.min(
        config.durabilityWindows - 1,
        Math.floor(msIntoEval / windowDurationMs)
      );
      // We only care if they voluntarily listened. We will use a rough check for now
      // Skip events with AUTOPLAY type don't count towards durability.
      if (e.initiationType !== 'AUTOPLAY' && e.eventType !== 'SKIP') {
        windowCounts[windowIndex]++;
      }
    }

    // Apply larger weights to later windows
    let durabilityScore = 0;
    let maxPossibleDurability = 0;
    for (let i = 0; i < config.durabilityWindows; i++) {
      // Exponentially increasing weights: later weeks matter more
      const weight = Math.pow(1.2, i); 
      maxPossibleDurability += weight;
      
      // If they had at least some voluntary interaction in this window
      if (windowCounts[i] > 0) {
        // Logarithmic scaling for count to prevent one-day binge dominating the window
        const windowIntensity = Math.min(1.0, Math.log10(1 + windowCounts[i]) / Math.log10(10));
        durabilityScore += weight * windowIntensity;
      }
    }
    const durability = durabilityScore / maxPossibleDurability;

    // --- STEP 4: AGENCY ---
    let agencyScoreTotal = 0;
    let validEvents = 0;
    for (const e of evalEvents) {
      if (e.eventType === 'SKIP') continue; // Don't count skips towards agency
      const weight = config.agencyWeights[e.initiationType || ''] ?? config.agencyWeights[e.eventType] ?? 0.5;
      agencyScoreTotal += weight;
      validEvents++;
    }
    const agency = validEvents > 0 ? agencyScoreTotal / validEvents : 0;

    // --- STEP 5: MEANINGFULNESS ---
    // Look for strong signals: SAVE, PLAYLIST_ADD, multiple distinct artists
    let meaningfulnessScore = 0;
    const exploredArtists = new Set<string>();
    
    for (const e of evalEvents) {
      exploredArtists.add(e.artistId);
      if (e.eventType === 'SAVE' || e.initiationType === 'LIBRARY_SAVE') {
        meaningfulnessScore += 0.2;
      }
      if (e.eventType === 'PLAYLIST_ADD' || e.initiationType === 'PLAYLIST_CREATED') {
        meaningfulnessScore += 0.3;
      }
      if (e.initiationType === 'ARTIST_PAGE') {
        meaningfulnessScore += 0.15; // Deep dive proxy
      }
    }
    
    // Multiple artist exploration is highly meaningful
    if (exploredArtists.size >= 3) {
      meaningfulnessScore += 0.3;
    } else if (exploredArtists.size === 2) {
      meaningfulnessScore += 0.15;
    }
    
    // Check for organic revisits after weeks (i.e., events spanning more than 3 weeks)
    if (evalEvents.length > 1) {
      const firstEvalMs = evalEvents[0].timestamp.getTime();
      const lastEvalMs = evalEvents[evalEvents.length - 1].timestamp.getTime();
      const spanWeeks = (lastEvalMs - firstEvalMs) / (7 * 24 * 60 * 60 * 1000);
      if (spanWeeks > 3) {
        meaningfulnessScore += 0.2;
      }
    }

    const meaningfulness = Math.min(1.0, meaningfulnessScore);

    // --- FINAL TERRITORY SCORE ---
    // A territory must be foreign, voluntarily explored, repeatedly revisited, meaningfully integrated.
    const territoryExpansionScore = foreignness * durability * agency * meaningfulness;
    
    if (territoryExpansionScore > 0) {
      adoptedCount++;
      sumForeignness += foreignness;
      sumDurability += durability;
      sumAgency += agency;
      sumMeaningfulness += meaningfulness;
      totalScoreSum += territoryExpansionScore;

      contributingTerritories.push({
        territoryId,
        foreignness,
        durability,
        agency,
        meaningfulness,
        contribution: territoryExpansionScore,
      });
    }
  }

  // Normalize final TEM Score
  const rawTEM = totalScoreSum;
  // Use exponential normalization with an empirical scale factor.
  // E.g., if a user strongly adopts 1 territory (score ~0.8), TEM ~ 0.33
  // If a user strongly adopts 3 territories (score ~2.4), TEM ~ 0.69
  // If a user strongly adopts 5 territories (score ~4.0), TEM ~ 0.86
  const finalTEM = exponentialNormalize(rawTEM, 0.5);

  return {
    score: finalTEM,
    adoptedTerritories: adoptedCount,
    foreignness: adoptedCount > 0 ? sumForeignness / adoptedCount : 0,
    durability: adoptedCount > 0 ? sumDurability / adoptedCount : 0,
    agency: adoptedCount > 0 ? sumAgency / adoptedCount : 0,
    meaningfulness: adoptedCount > 0 ? sumMeaningfulness / adoptedCount : 0,
    contributingTerritories,
    evaluationWindow: config.evaluationWindowDays,
    confidence: Math.min(1.0, events.length / 500), // Basic confidence proxy
    version: '2.0',
  };
}
