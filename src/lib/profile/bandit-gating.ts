import { prisma } from '@/lib/prisma';
import { clamp } from '@/lib/math';
import {
  type BanditAction,
  type PlaybackContext,
  type BanditParameters,
  type BanditDecisionResult,
  type RewardFeedback,
  ALPHA_EXPLORATION,
} from './bandit-types';

// ─── 4x4 Matrix Mathematics Helpers ─────────────────────────────────

/**
 * Returns a new 4x4 Identity matrix.
 */
export function identity4x4(): number[][] {
  return [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
}

/**
 * Inverts a 4x4 matrix using Gaussian elimination with partial pivoting.
 * If the matrix is singular, adds regularization (ridge regression / identity scale) and retries.
 */
export function invert4x4(M: number[][]): number[][] {
  const n = 4;
  const A: number[][] = [];
  
  for (let i = 0; i < n; i++) {
    A[i] = [];
    for (let j = 0; j < n; j++) {
      A[i][j] = M[i][j];
    }
    for (let j = 0; j < n; j++) {
      A[i][j + n] = i === j ? 1 : 0;
    }
  }

  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let r = i + 1; r < n; r++) {
      if (Math.abs(A[r][i]) > Math.abs(A[maxRow][i])) {
        maxRow = r;
      }
    }

    if (maxRow !== i) {
      const temp = A[i];
      A[i] = A[maxRow];
      A[maxRow] = temp;
    }

    if (Math.abs(A[i][i]) < 1e-9) {
      // Regularize: add small identity diagonal and try again to avoid singularity
      const regularized = M.map((row, r) =>
        row.map((val, c) => (r === c ? val + 1e-4 : val))
      );
      return invert4x4(regularized);
    }

    const pivot = A[i][i];
    for (let j = i; j < 2 * n; j++) {
      A[i][j] /= pivot;
    }

    for (let r = 0; r < n; r++) {
      if (r !== i) {
        const factor = A[r][i];
        for (let j = i; j < 2 * n; j++) {
          A[r][j] -= factor * A[i][j];
        }
      }
    }
  }

  const inv: number[][] = [];
  for (let i = 0; i < n; i++) {
    inv[i] = A[i].slice(n);
  }
  return inv;
}

/**
 * Computes outer product of vector x (x * x^T), returning a 4x4 matrix.
 */
export function outerProduct4x4(x: number[]): number[][] {
  const M: number[][] = [];
  for (let i = 0; i < 4; i++) {
    M[i] = [];
    for (let j = 0; j < 4; j++) {
      M[i][j] = x[i] * x[j];
    }
  }
  return M;
}

/**
 * Adds two 4x4 matrices element-wise.
 */
export function add4x4(A: number[][], B: number[][]): number[][] {
  const M: number[][] = [];
  for (let i = 0; i < 4; i++) {
    M[i] = [];
    for (let j = 0; j < 4; j++) {
      M[i][j] = A[i][j] + B[i][j];
    }
  }
  return M;
}

/**
 * Adds two 4D vectors element-wise.
 */
export function addVec4(v1: number[], v2: number[]): number[] {
  return [v1[0] + v2[0], v1[1] + v2[1], v1[2] + v2[2], v1[3] + v2[3]];
}

/**
 * Multiplies a 4x4 matrix by a 4D vector.
 */
export function multiplyMatVec4(M: number[][], v: number[]): number[] {
  const res: number[] = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    res[i] = M[i][0] * v[0] + M[i][1] * v[1] + M[i][2] * v[2] + M[i][3] * v[3];
  }
  return res;
}

/**
 * Computes dot product of two 4D vectors.
 */
export function dotProduct4(v1: number[], v2: number[]): number {
  return v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2] + v1[3] * v2[3];
}

// ─── Circadian Utility ──────────────────────────────────────────────

/**
 * Maps hour of day to circadian numerical value:
 * - Morning Commute (06:00 - 08:59): 0.5
 * - Work Hours (09:00 - 16:59): 0.0
 * - Evening Leisure (17:00 - 21:59): 1.0
 * - Late Night (22:00 - 05:59): 0.2
 */
export function getCircadianValue(date: Date): number {
  const hour = date.getHours();
  if (hour >= 6 && hour < 9) return 0.5;
  if (hour >= 9 && hour < 17) return 0.0;
  if (hour >= 17 && hour < 22) return 1.0;
  return 0.2;
}

// ─── Bandit Parameter Management ───────────────────────────────────

/**
 * Loads or initializes the LinUCB bandit parameters for a user.
 */
export async function getOrCreateBanditState(userId: string): Promise<BanditParameters> {
  const record = await prisma.userBanditState.findUnique({
    where: { userId },
  });

  if (record) {
    try {
      return JSON.parse(record.parameterString) as BanditParameters;
    } catch (e) {
      const err = e as Error;
      console.error(`[Bandit Gating] Failed to parse bandit state for user ${userId}, resetting:`, err.message);
    }
  }

  const initialParams: BanditParameters = {
    a0: { A: identity4x4(), b: [0, 0, 0, 0] },
    a1: { A: identity4x4(), b: [0, 0, 0, 0] },
    a2: { A: identity4x4(), b: [0, 0, 0, 0] },
  };

  // Persist it immediately
  await prisma.userBanditState.upsert({
    where: { userId },
    create: {
      userId,
      parameterString: JSON.stringify(initialParams),
    },
    update: {
      parameterString: JSON.stringify(initialParams),
    },
  });

  return initialParams;
}

// ─── Real-Time Gating Decision ──────────────────────────────────────

/**
 * Decides on the exploration action (Exploit, Adjacent Explore, Deep Explore) 
 * for a user based on session context using the LinUCB contextual bandit algorithm.
 * 
 * @param userId - Target user Spotify ID
 * @param playbackContext - Playback session mode override
 * @param currentTime - Date object for context calculation
 */
export async function getExplorationAction(
  userId: string,
  playbackContext: PlaybackContext = 'passive_leanback',
  currentTime: Date = new Date(),
  isDemo = false
): Promise<BanditDecisionResult> {
  // 1. Resolve Taste Entropy (Layer 3)
  const profile = await prisma.userTerritoryProfile.findUnique({
    where: { userId },
  });
  const entropy = profile ? profile.entropyScore : 1.0;

  // 2. Resolve Session Skip Rate
  const recentDecisions = await prisma.banditDecision.findMany({
    where: { userId, feedbackReceived: true },
    orderBy: { timestamp: 'desc' },
    take: 10,
  });

  let skipRate = 0.0;
  if (recentDecisions.length > 0) {
    // Count decisions that received negative rewards (indicating skips/abandonment)
    const negativeCount = recentDecisions.filter((d) => d.reward < 0.0).length;
    skipRate = negativeCount / recentDecisions.length;
  }

  // 3. Playback Context Mapping
  let playbackVal = 0.5;
  if (playbackContext === 'active_explore') playbackVal = 1.0;
  else if (playbackContext === 'functional_listening') playbackVal = 0.0;

  // 4. Circadian Context Mapping
  const circadianVal = getCircadianValue(currentTime);

  // Assemble Context Vector (x in R^4)
  const x = [entropy, skipRate, playbackVal, circadianVal];

  // Load Bandit Parameters
  const params = await getOrCreateBanditState(userId);

  const ucbValues: Record<number, number> = {};
  let bestAction: BanditAction = 0;
  let highestScore = -Infinity;

  const actions: BanditAction[] = [0, 1, 2];

  for (const a of actions) {
    const actKey = `a${a}` as keyof BanditParameters;
    const { A, b } = params[actKey];

    const invA = invert4x4(A);
    const theta = multiplyMatVec4(invA, b);
    const mean = dotProduct4(theta, x);
    
    // Variance = x^T * invA * x
    const tempVec = multiplyMatVec4(invA, x);
    const variance = dotProduct4(x, tempVec);
    
    // UCB calculation
    const ucb = mean + ALPHA_EXPLORATION * Math.sqrt(Math.max(0, variance));
    ucbValues[a] = ucb;

    if (ucb > highestScore) {
      highestScore = ucb;
      bestAction = a;
    }
  }

  // Generate Unique Decision ID
  const randPart = Math.random().toString(36).substring(2, 11);
  const decisionId = `dec_${randPart}_${Date.now()}`;

  // Record Decision in Database
  if (!isDemo) {
    await prisma.banditDecision.create({
      data: {
        userId,
        decisionId,
        contextVector: JSON.stringify(x),
        chosenAction: bestAction,
        ucbValues: JSON.stringify(ucbValues),
        reward: 0.0,
        feedbackReceived: false,
      },
    });
  }

  // Construct Dynamic Explanation
  let explanation = '';
  const skipText = skipRate > 0.3 ? `elevated skip rate (${(skipRate * 100).toFixed(0)}%)` : `low skip rate`;
  const contextText = playbackContext === 'active_explore' 
    ? 'active session mode' 
    : playbackContext === 'functional_listening' 
    ? 'functional listening setting' 
    : 'lean-back mode';

  if (bestAction === 0) {
    explanation = `Gated to Exploit (low-novelty) due to ${skipText} and ${contextText}, prioritizing familiar structural matches.`;
  } else if (bestAction === 1) {
    explanation = `Gated to Adjacent Explore (moderate-novelty) driven by stable taste entropy (${entropy.toFixed(2)}) and receptive circadian window.`;
  } else {
    explanation = `Gated to Deep Explore (high-novelty) enabled by ${contextText} during high-receptivity circadian hours with ${skipText}.`;
  }

  return {
    userId,
    decisionId,
    action: bestAction,
    ucbValues,
    context: x,
    explanation,
    timestamp: currentTime,
  };
}

// ─── Feedback Reward Update ────────────────────────────────────────

/**
 * Updates the LinUCB bandit parameters for a user after receiving session reward feedback.
 * 
 * @param userId - Target user Spotify ID
 * @param decisionId - Corresponding decision ID to associate reward
 * @param feedback - Session reward metrics (dwell time, skips, saves, repeat plays)
 */
export async function updateBanditReward(
  userId: string,
  decisionId: string,
  feedback: RewardFeedback
) {
  // 1. Fetch Decision record
  const decision = await prisma.banditDecision.findUnique({
    where: { decisionId },
  });

  if (!decision) {
    throw new Error(`[Bandit Gating] Decision record not found for decisionId: ${decisionId}`);
  }

  if (decision.userId !== userId) {
    throw new Error(`[Bandit Gating] Decision ${decisionId} does not belong to user ${userId}`);
  }

  if (decision.feedbackReceived) {
    console.warn(`[Bandit Gating] Decision ${decisionId} already updated with feedback. Skipping further updates.`);
    return decision;
  }

  // 2. Calculate Continuous Reward (r in [-1.0, 1.0])
  let reward = 0.0;

  if (feedback.dwellTimeSeconds !== undefined) {
    // 3 minutes (180s) represents full track engagement
    const playFraction = Math.min(1.0, feedback.dwellTimeSeconds / 180.0);
    reward += playFraction;
  }

  if (feedback.skipped) {
    reward -= 0.4;
  }

  if (feedback.saved || feedback.followed) {
    reward += 0.5;
  }

  if (feedback.repeatListen) {
    reward += 0.3;
  }

  if (feedback.abandoned) {
    reward -= 0.6;
  }

  // Clamp reward value
  const finalReward = clamp(reward, -1.0, 1.0);

  // 3. Retrieve Context Vector x from Decision
  let x: number[];
  try {
    x = JSON.parse(decision.contextVector) as number[];
  } catch (err) {
    const error = err as Error;
    throw new Error(`[Bandit Gating] Failed to parse context vector: ${error.message}`);
  }

  if (x.length !== 4) {
    throw new Error(`[Bandit Gating] Invalid context vector size. Expected 4, got ${x.length}`);
  }

  // 4. Update Bandit State
  const params = await getOrCreateBanditState(userId);
  const actionKey = `a${decision.chosenAction}` as keyof BanditParameters;
  const currentActionParams = params[actionKey];

  // A_a <- A_a + x * x^T
  const xxT = outerProduct4x4(x);
  const updatedA = add4x4(currentActionParams.A, xxT);

  // b_a <- b_a + r * x
  const rx = x.map((val) => val * finalReward);
  const updatedB = addVec4(currentActionParams.b, rx);

  params[actionKey] = {
    A: updatedA,
    b: updatedB,
  };

  // 5. Save updated state and decision back to database
  await prisma.$transaction([
    prisma.userBanditState.update({
      where: { userId },
      data: {
        parameterString: JSON.stringify(params),
      },
    }),
    prisma.banditDecision.update({
      where: { decisionId },
      data: {
        reward: finalReward,
        feedbackReceived: true,
      },
    }),
  ]);

  console.log(
    `[Bandit Gating] Updated user ${userId} bandit parameters for action ${decision.chosenAction}. Reward: ${finalReward.toFixed(4)}.`
  );

  return await prisma.banditDecision.findUnique({
    where: { decisionId },
  });
}
