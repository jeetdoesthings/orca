import { prisma } from '@/lib/prisma';
import { readWorldState, writeWorldState, incrementOCSE, WorldState } from './world-state-store';
import { computeAndStoreFrontier } from './computeAndStoreFrontier';
import { WorldDelta } from '@/lib/graph/types';

export async function triggerWorldRegeneration(userId: string): Promise<void> {
  console.log(`[Regeneration] Triggered world regeneration for user: ${userId}`);
  
  // 1. Invalidate cache by incrementing OCSE evaluation version
  incrementOCSE(userId);

  // 2. Fetch user to check globeData
  const user = await prisma.user.findUnique({
    where: { spotifyId: userId },
    select: { globeData: true }
  });

  if (!user || !user.globeData) {
    console.warn(`[Regeneration] No globe data found for user ${userId}. Skipping run.`);
    return;
  }

  // 3. Find active Spotify access token
  const account = await prisma.account.findFirst({
    where: { userId, provider: 'spotify' },
    select: { access_token: true }
  });
  const token = account?.access_token || 'mock_token';

  // 4. Force recompute in the background
  try {
    const exploredNodes = JSON.parse(user.globeData).nodes || [];
    computeAndStoreFrontier(userId, exploredNodes, token).catch(err => {
      console.error(`[Regeneration] Background computeAndStoreFrontier failed:`, err);
    });
  } catch (err) {
    console.error(`[Regeneration] Failed to parse globeData for recomputation:`, err);
  }
}

export function computeWorldDelta(oldNodes: any[], newNodes: any[]): WorldDelta {
  const oldMap = new Map<string, any>(oldNodes.map(n => [n.id, n]));
  const newMap = new Map<string, any>(newNodes.map(n => [n.id, n]));

  const addedReachable: any[] = [];
  const removedReachable: string[] = [];
  const roleChanges: Array<{ id: string; role: string }> = [];

  // Find added and changed nodes
  newNodes.forEach(n => {
    const oldNode = oldMap.get(n.id);
    if (!oldNode) {
      addedReachable.push(n);
    } else {
      if (oldNode.semanticRole !== n.semanticRole) {
        roleChanges.push({ id: n.id, role: n.semanticRole || 'REACHABLE' });
      }
    }
  });

  // Find removed nodes
  oldNodes.forEach(n => {
    if (!newMap.has(n.id)) {
      removedReachable.push(n.id);
    }
  });

  return {
    addedReachable,
    removedReachable,
    roleChanges,
    journeyChanges: {},
    identityChanges: {},
    opportunityChanges: {},
    bridgeChanges: {},
    recoveryChanges: {}
  };
}
