import fs from 'fs';
import path from 'path';
import { Observation } from './types';

function getFilePath(userId: string): string {
  const dir = path.join(process.cwd(), '.gemini');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, `observations_${userId}.json`);
}

export function readObservations(userId: string): Observation[] {
  const filePath = getFilePath(userId);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('[FeedbackStore] Read observations error:', err);
    return [];
  }
}

export function writeObservations(userId: string, items: Observation[]) {
  const filePath = getFilePath(userId);
  try {
    fs.writeFileSync(filePath, JSON.stringify(items, null, 2), 'utf-8');
  } catch (err) {
    console.error('[FeedbackStore] Write observations error:', err);
  }
}
