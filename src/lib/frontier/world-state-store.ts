import fs from 'fs';
import path from 'path';

export interface WorldState {
  candidateUniverseVersion: number;
  ocseEvaluationVersion: number;
  snapshotVersion: number;
  lastGeneratedAt: string;
  visibleNodeIds: string[];
  nodeMetrics: Record<string, {
    lastEvaluated: string;
    lastVisible: string;
    timesShown: number;
    timesIgnored: number;
    timesIntegrated: number;
    visibilityCooldown: number;
  }>;
  lastNodes: any[];
}

function getFilePath(userId: string): string {
  const dir = path.join(process.cwd(), '.gemini');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, `world_state_${userId}.json`);
}

export function readWorldState(userId: string): WorldState {
  const filePath = getFilePath(userId);
  if (!fs.existsSync(filePath)) {
    return {
      candidateUniverseVersion: 1,
      ocseEvaluationVersion: 1,
      snapshotVersion: 1,
      lastGeneratedAt: new Date(0).toISOString(),
      visibleNodeIds: [],
      nodeMetrics: {},
      lastNodes: []
    };
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('[WorldStateStore] Read error:', err);
    return {
      candidateUniverseVersion: 1,
      ocseEvaluationVersion: 1,
      snapshotVersion: 1,
      lastGeneratedAt: new Date(0).toISOString(),
      visibleNodeIds: [],
      nodeMetrics: {},
      lastNodes: []
    };
  }
}

export function writeWorldState(userId: string, state: WorldState) {
  const filePath = getFilePath(userId);
  try {
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.error('[WorldStateStore] Write error:', err);
  }
}

export function incrementUniverse(userId: string) {
  const state = readWorldState(userId);
  state.candidateUniverseVersion++;
  writeWorldState(userId, state);
}

export function incrementOCSE(userId: string) {
  const state = readWorldState(userId);
  state.ocseEvaluationVersion++;
  writeWorldState(userId, state);
}
