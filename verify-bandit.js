const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== STARTING LAYER 5 CONTEXTUAL BANDIT VERIFICATION ===\n');

  // 1. Find a demo user
  const user = await prisma.user.findFirst({
    where: { syncStatus: 'COMPLETE', profileData: { not: null } },
    select: { spotifyId: true, displayName: true }
  });

  if (!user) {
    console.error('ERROR: No user with complete syncStatus and profileData found in database. Run sync/simulations first.');
    process.exit(1);
  }

  const userId = user.spotifyId;
  console.log(`Testing with user: "${user.displayName}" (Spotify ID: ${userId})`);

  // Ensure user has a territory profile (for entropyScore)
  let territoryProfile = await prisma.userTerritoryProfile.findUnique({
    where: { userId }
  });

  if (!territoryProfile) {
    console.log('User has no UserTerritoryProfile. Creating a mock one for testing...');
    territoryProfile = await prisma.userTerritoryProfile.create({
      data: {
        userId,
        occupancyVector: JSON.stringify({ shortTerm: {}, mediumTerm: {}, longTerm: {} }),
        diversityScore: 0.7,
        concentrationScore: 0.3,
        entropyScore: 1.45,
      }
    });
  }

  const userEntropy = territoryProfile.entropyScore;
  console.log(`Taste Entropy (Layer 3): ${userEntropy.toFixed(4)}`);

  // 2. Import bandit modules using tsx resolver
  console.log('Importing bandit readiness gating modules...');
  const readinessModule = await import('./src/lib/profile/readiness.ts');
  const getExplorationAction = readinessModule.getExplorationAction || readinessModule.default?.getExplorationAction;
  const updateBanditReward = readinessModule.updateBanditReward || readinessModule.default?.updateBanditReward;

  if (!getExplorationAction || !updateBanditReward) {
    console.error('ERROR: Failed to import getExplorationAction or updateBanditReward from readiness.ts');
    process.exit(1);
  }

  // 3. Clear old bandit states for a clean run
  console.log('Cleaning old bandit tables for fresh verification...');
  await prisma.banditDecision.deleteMany({ where: { userId } });
  await prisma.userBanditState.deleteMany({ where: { userId } });

  // ─── Test Case 1: Initial Gating in Work Hours / Passive Mode ───
  console.log('\n--- TEST CASE 1: INITIAL DECISION IN WORK-HOURS PASSIVE CONTEXT ---');
  const workTime = new Date('2026-06-24T10:00:00'); // 10:00 AM (Work hours: circadian value should be 0.0)
  
  const d1 = await getExplorationAction(userId, 'passive_leanback', workTime);
  console.log('Decision 1 Results:');
  console.log(`- Decision ID: ${d1.decisionId}`);
  console.log(`- Context Vector x: ${JSON.stringify(d1.context)}`);
  console.log(`  [Entropy: ${d1.context[0]}, SkipRate: ${d1.context[1]}, Playback: ${d1.context[2]}, Circadian: ${d1.context[3]}]`);
  console.log(`- Chosen Action: ${d1.action} (0=Exploit, 1=Adjacent, 2=Deep)`);
  console.log(`- UCB values: ${JSON.stringify(d1.ucbValues)}`);
  console.log(`- Explanation: ${d1.explanation}`);

  // Assertions for initial state
  if (d1.context[1] !== 0.0) console.error('FAIL: Initial skip rate should be 0.0');
  if (d1.context[2] !== 0.5) console.error('FAIL: Passive playback context value should be 0.5');
  if (d1.context[3] !== 0.0) console.error('FAIL: Circadian value for 10am work hours should be 0.0');

  // ─── Test Case 2: Feedback Submission & Parameter Update ───
  console.log('\n--- TEST CASE 2: FEEDBACK SUBMISSION & PARAMETER UPDATE ---');
  console.log('Submitting high reward: full play (180s) and track save...');
  
  const feedbackResult1 = await updateBanditReward(userId, d1.decisionId, {
    dwellTimeSeconds: 180,
    saved: true
  });
  console.log(`Feedback Result 1: Reward = ${feedbackResult1.reward}`);
  if (Math.abs(feedbackResult1.reward - 1.0) > 1e-5) {
    console.error(`FAIL: Expected reward to be 1.0 (clamped). Got ${feedbackResult1.reward}`);
  } else {
    console.log('SUCCESS: Reward calculated and clamped to 1.0 successfully.');
  }

  // Load state and verify mathematical updates
  const stateRecord1 = await prisma.userBanditState.findUnique({ where: { userId } });
  const params1 = JSON.parse(stateRecord1.parameterString);
  const chosenActionKey = `a${d1.action}`;
  console.log(`Inspecting updated parameters for action ${chosenActionKey}:`);
  console.log(`- Matrix A: ${JSON.stringify(params1[chosenActionKey].A)}`);
  console.log(`- Vector b: ${JSON.stringify(params1[chosenActionKey].b)}`);

  // Verify updates mathematically
  // A_new = A_old + x*x^T. A_old is Identity.
  // x = [entropy, 0, 0.5, 0]
  // x*x^T = [
  //   [entropy^2, 0, entropy*0.5, 0],
  //   [0, 0, 0, 0],
  //   [entropy*0.5, 0, 0.25, 0],
  //   [0, 0, 0, 0]
  // ]
  const expectedA00 = 1.0 + userEntropy * userEntropy;
  const actualA00 = params1[chosenActionKey].A[0][0];
  if (Math.abs(actualA00 - expectedA00) > 1e-4) {
    console.error(`FAIL: Covariance update incorrect. Expected A[0][0] = ${expectedA00}, got ${actualA00}`);
  } else {
    console.log('SUCCESS: Matrix A covariance update verified successfully.');
  }

  // b_new = b_old + r*x = [r*entropy, 0, r*0.5, 0]
  const expectedB0 = 1.0 * userEntropy;
  const actualB0 = params1[chosenActionKey].b[0];
  if (Math.abs(actualB0 - expectedB0) > 1e-4) {
    console.error(`FAIL: Projection vector update incorrect. Expected b[0] = ${expectedB0}, got ${actualB0}`);
  } else {
    console.log('SUCCESS: Vector b projection update verified successfully.');
  }

  // ─── Test Case 3: Action Adaptation ───
  console.log('\n--- TEST CASE 3: ACTION ADAPTATION ---');
  console.log('Requesting new decision in the same work-hours context...');
  const d2 = await getExplorationAction(userId, 'passive_leanback', workTime);
  console.log(`New Chosen Action: ${d2.action}`);
  console.log(`New UCB values: ${JSON.stringify(d2.ucbValues)}`);
  
  // Since action d1.action received a positive reward, its UCB mean should have increased.
  // Let's verify that the UCB value for d1.action is now higher than the other actions.
  const prevActionUCB = d2.ucbValues[d1.action];
  const otherActionUCB = d2.ucbValues[(d1.action + 1) % 3];
  console.log(`- Reward Action UCB: ${prevActionUCB.toFixed(4)}`);
  console.log(`- Other Action UCB: ${otherActionUCB.toFixed(4)}`);

  if (prevActionUCB > otherActionUCB) {
    console.log('SUCCESS: Bandit shifted preference towards previously rewarded action.');
  } else {
    console.warn('WARN: Bandit did not favor rewarded action. (This can happen if covariance variance exploration bonus is large, but check calculations).');
  }

  // ─── Test Case 4: Negative Feedback Adaptation ───
  console.log('\n--- TEST CASE 4: NEGATIVE FEEDBACK & PENALTY ADAPTATION ---');
  // Simulate active session in evening leisure context
  const eveningTime = new Date('2026-06-24T19:00:00'); // 7:00 PM (Evening leisure: circadian value should be 1.0)
  const d3 = await getExplorationAction(userId, 'active_explore', eveningTime);
  console.log(`Decision 3 Chosen Action: ${d3.action}`);
  console.log(`Context Vector: ${JSON.stringify(d3.context)}`);

  console.log('Submitting negative feedback (skipped and abandoned)...');
  const feedbackResult2 = await updateBanditReward(userId, d3.decisionId, {
    skipped: true,
    abandoned: true
  });
  console.log(`Feedback Result 2: Reward = ${feedbackResult2.reward}`);
  if (feedbackResult2.reward !== -1.0) {
    console.error(`FAIL: Expected reward to be -1.0 (clamped). Got ${feedbackResult2.reward}`);
  } else {
    console.log('SUCCESS: Negative reward calculated and clamped to -1.0 successfully.');
  }

  // Run a fourth decision to see if skipRate context value updates
  const d4 = await getExplorationAction(userId, 'active_explore', eveningTime);
  console.log(`Decision 4 Context Vector (Skip Rate): ${JSON.stringify(d4.context)}`);
  console.log(`New Skip Rate in Context: ${d4.context[1]}`);
  if (d4.context[1] > 0.0) {
    console.log('SUCCESS: Skip rate context variable successfully updated from historical feedback.');
  } else {
    console.error('FAIL: Skip rate context variable should be greater than 0.0.');
  }

  console.log('\n=== LAYER 5 CONTEXTUAL BANDIT VERIFICATION COMPLETE ===');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
