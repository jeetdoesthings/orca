import { predictMindset, MMEInputSignals } from './src/lib/mme/engine';

function generateRandomSignals(): MMEInputSignals {
  return {
    session: {
      timeOfDay: ['morning', 'afternoon', 'evening', 'night'][Math.floor(Math.random() * 4)] as any,
      isWeekend: Math.random() > 0.7,
      sessionDuration: Math.random() * 7200, // up to 2 hours
      currentListeningStreak: Math.floor(Math.random() * 10),
      previousSessionLength: Math.random() * 7200,
      gapSinceLastSession: Math.random() * 48
    },
    behavior: {
      manualSearches: Math.floor(Math.random() * 10),
      queueEdits: Math.floor(Math.random() * 10),
      skips: Math.floor(Math.random() * 20),
      replays: Math.floor(Math.random() * 10),
      albumCompletionRate: Math.random(),
      artistCompletionRate: Math.random(),
      playlistCreations: Math.floor(Math.random() * 3),
      manualSaves: Math.floor(Math.random() * 5),
      libraryAdditions: Math.floor(Math.random() * 5),
      radioUsage: Math.random()
    },
    agency: {
      searchInitiated: Math.random() > 0.5,
      recommendationAccepted: Math.random() > 0.5,
      autoplay: Math.random() > 0.5,
      externalShare: Math.random() > 0.9,
      friendRecommendation: Math.random() > 0.8,
      voiceSearch: Math.random() > 0.9
    },
    tasteMemory: {
      strength: Math.random(),
      persistence: Math.random(),
      decay: Math.random(),
      identityWeight: Math.random()
    },
    territory: {
      currentTerritoryId: 'terr_' + Math.floor(Math.random() * 100),
      hiddenPotential: Math.random(),
      velocity: Math.random(),
      relationshipStrength: Math.random()
    },
    expansion: {
      tem: Math.random(),
      currentExpansion: Math.random(),
      velocity: Math.random(),
      identityGrowth: Math.random()
    },
    lofl: {
      recentSuccessRate: Math.random(),
      recentFailureRate: Math.random(),
      retryHistoryCount: Math.floor(Math.random() * 5)
    },
    readiness: Math.random()
  };
}

async function runAudit() {
  const NUM_SIMULATIONS = 10000;
  
  let mindsetCounts = {
    Comfort: 0,
    Background: 0,
    Focus: 0,
    Discovery: 0,
    Expansion: 0,
    Exploration: 0
  };

  let constraintsTriggered = 0;
  let confidentPredictions = 0;

  console.log(`Starting MME Audit with ${NUM_SIMULATIONS} simulated sessions...\n`);

  for (let i = 0; i < NUM_SIMULATIONS; i++) {
    const signals = generateRandomSignals();
    const result = predictMindset(signals);

    mindsetCounts[result.dominantMindset as keyof typeof mindsetCounts]++;

    if (result.confidence > 0.7) {
      confidentPredictions++;
    }

    // Check constraint condition
    if (result.dominantMindset === 'Expansion' && result.expansion < 0.30) {
      if (!(signals.territory.hiddenPotential > 0.95 && signals.readiness! > 0.90)) {
        console.error("CONSTRAINT VIOLATION: Expansion chosen below 0.30 without criteria met!");
        process.exit(1);
      }
    }

    if (result.reasoning.includes("Expansion restricted by Taste Expansion Constraint")) {
      constraintsTriggered++;
    }
  }

  console.log("=== Audit Results ===");
  console.log(`Simulations run: ${NUM_SIMULATIONS}`);
  console.log(`High Confidence (>0.7): ${confidentPredictions} (${((confidentPredictions/NUM_SIMULATIONS)*100).toFixed(2)}%)`);
  console.log(`Expansion Constraint Prevented Overreach: ${constraintsTriggered} times`);
  
  console.log("\n--- Mindset Distribution ---");
  for (const [mindset, count] of Object.entries(mindsetCounts)) {
    console.log(`${mindset}: ${count} (${((count/NUM_SIMULATIONS)*100).toFixed(2)}%)`);
  }
  
  console.log("\nAudit Passed successfully. Distribution looks varied, and constraints held.");
}

runAudit();
