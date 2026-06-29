export { type MMEInputSignals, type MusicalMindset };
import { MMEInputSignals, MusicalMindset } from './types';

/**
 * Predicts the user's current listening intention (mindset).
 */
export function predictMindset(signals: MMEInputSignals): MusicalMindset {
  // Raw mindset scores based on heuristics
  let comfortScore = 0;
  let backgroundScore = 0;
  let focusScore = 0;
  let discoveryScore = 0;
  let expansionScore = 0;
  let explorationScore = 0;

  const reasoning: string[] = [];

  // --- Discovery Heuristics ---
  // High searches + High saves + High session length -> Discovery ↑
  if (signals.behavior.manualSearches > 2) {
    discoveryScore += 0.3 + (signals.behavior.manualSearches * 0.05);
    reasoning.push("High manual searching");
  }
  if (signals.behavior.manualSaves > 2) {
    discoveryScore += 0.2 + (signals.behavior.manualSaves * 0.05);
    reasoning.push("High manual saves");
  }
  if (signals.session.sessionDuration > 1800) { // longer than 30 mins
    discoveryScore += 0.15;
    reasoning.push("Long session duration supports discovery");
  }

  // --- Comfort Heuristics ---
  // High repeats + High memory + Low skips -> Comfort ↑
  if (signals.behavior.replays > 3) {
    comfortScore += 0.3 + (signals.behavior.replays * 0.05);
    reasoning.push("High replay count indicates comfort seeking");
  }
  if (signals.tasteMemory.strength > 0.7) {
    comfortScore += 0.2;
    reasoning.push("Strong taste memory activation");
  }
  if (signals.behavior.skips === 0 && signals.session.sessionDuration > 600) {
    comfortScore += 0.2;
    reasoning.push("Low skips with sustained listening");
  }

  // --- Background Heuristics ---
  // High autoplay -> Background ↑
  if (signals.agency.autoplay) {
    backgroundScore += 0.4;
    reasoning.push("Autoplay indicates passive/background listening");
  }
  if (signals.behavior.radioUsage > 0.7) {
    backgroundScore += 0.2;
    reasoning.push("High radio usage");
  }

  // --- Focus Heuristics ---
  // High album completion + Low skipping -> Focus ↑
  if (signals.behavior.albumCompletionRate > 0.8) {
    focusScore += 0.4;
    reasoning.push("High album completion rate implies focus");
  }
  if (signals.behavior.skips <= 1) {
    focusScore += 0.1;
  }
  if (signals.session.timeOfDay === 'morning' || signals.session.timeOfDay === 'afternoon') {
    if (!signals.session.isWeekend) {
      focusScore += 0.1; // Work hours
    }
  }

  // --- Expansion Heuristics ---
  // High hidden potential + High TEM -> Expansion ↑
  if (signals.territory.hiddenPotential > 0.7) {
    expansionScore += 0.3;
    reasoning.push("High hidden potential in current territory");
  }
  if (signals.expansion.tem > 0.6) {
    expansionScore += 0.3;
    reasoning.push("High Taste Expansion Metric (TEM)");
  }
  if (signals.lofl.recentSuccessRate > 0.7) {
    expansionScore += 0.2;
    reasoning.push("Recent successful pathways (LOFL)");
  }

  // --- Exploration Heuristics ---
  // Something surprising (e.g. high curiosity but not specifically directed like Expansion)
  if (signals.behavior.manualSearches > 5 && signals.behavior.skips > 10) {
    explorationScore += 0.8; // significantly higher to overcome Discovery baseline
    discoveryScore *= 0.5; // subtract from discovery since they are skipping a lot
    reasoning.push("High searching with high skips implies restless exploration");
  }

  // Calculate signal volume to determine confidence
  const signalCount = 
    signals.behavior.manualSearches + 
    signals.behavior.queueEdits + 
    signals.behavior.skips + 
    signals.behavior.replays + 
    signals.behavior.manualSaves +
    signals.behavior.playlistCreations +
    signals.behavior.libraryAdditions;

  let confidence = 0;
  if (signalCount === 0 && signals.session.sessionDuration < 300) {
    confidence = 0.2; // very low confidence at start of session
  } else if (signalCount < 5 && signals.session.sessionDuration < 600) {
    confidence = 0.5;
  } else if (signalCount < 10) {
    confidence = 0.75;
  } else {
    confidence = 0.9;
  }

  // LOFL supervision (reinforcement)
  // Example: If expansion was predicted and failed recently, decrease expansion weight.
  if (signals.lofl.recentFailureRate > 0.6) {
    expansionScore *= 0.5; // suppress expansion
    discoveryScore *= 0.7; // suppress discovery
    reasoning.push("Suppressing expansion due to recent high failure rate (LOFL)");
  }

  // Taste Expansion Constraint
  // "The engine must NEVER attempt aggressive expansion if Expansion probability < 0.30
  // unless Hidden Potential > 0.95 AND Readiness > 0.90"
  // We handle this by normalizing first, then checking the constraint.
  
  // Base normalization
  const baseScores = [comfortScore, backgroundScore, focusScore, discoveryScore, expansionScore, explorationScore];
  const sumBase = baseScores.reduce((acc, val) => acc + val, 0);
  
  let normComfort = comfortScore;
  let normBackground = backgroundScore;
  let normFocus = focusScore;
  let normDiscovery = discoveryScore;
  let normExpansion = expansionScore;
  let normExploration = explorationScore;

  if (sumBase > 0) {
    normComfort /= sumBase;
    normBackground /= sumBase;
    normFocus /= sumBase;
    normDiscovery /= sumBase;
    normExpansion /= sumBase;
    normExploration /= sumBase;
  } else {
    // Default fallback if no signals
    normComfort = 0.5;
    normBackground = 0.2;
    normFocus = 0.1;
    normDiscovery = 0.1;
    normExpansion = 0.05;
    normExploration = 0.05;
  }

  // Apply constraint check
  let expansionRestricted = false;
  if (normExpansion < 0.30) {
    const isReady = signals.readiness !== undefined ? signals.readiness > 0.90 : false;
    if (!(signals.territory.hiddenPotential > 0.95 && isReady)) {
      expansionRestricted = true;
      reasoning.push("Expansion restricted by Taste Expansion Constraint");
    }
  }

  // To simulate the 'soft' nature of mindsets, we use softmax-like or temperature scaling if we wanted, 
  // but linear normalization is fine for the rules-based phase.

  const mindsetMap = new Map<string, number>([
    ['Comfort', normComfort],
    ['Background', normBackground],
    ['Focus', normFocus],
    ['Discovery', normDiscovery],
    ['Expansion', normExpansion],
    ['Exploration', normExploration]
  ]);

  let dominantMindset = 'Comfort';
  let maxScore = -1;

  for (const [mindset, score] of mindsetMap.entries()) {
    if (mindset === 'Expansion' && expansionRestricted) {
      continue; // Skip making it dominant if restricted
    }
    if (score > maxScore) {
      maxScore = score;
      dominantMindset = mindset;
    }
  }

  // Sort reasoning and remove duplicates to clean it up
  const uniqueReasoning = Array.from(new Set(reasoning));

  return {
    comfort: Number(normComfort.toFixed(3)),
    background: Number(normBackground.toFixed(3)),
    focus: Number(normFocus.toFixed(3)),
    discovery: Number(normDiscovery.toFixed(3)),
    expansion: Number(normExpansion.toFixed(3)),
    exploration: Number(normExploration.toFixed(3)),
    confidence: Number(confidence.toFixed(3)),
    dominantMindset,
    reasoning: uniqueReasoning.slice(0, 5) // top 5 reasons
  };
}
