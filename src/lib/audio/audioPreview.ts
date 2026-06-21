import type { OrcaNode } from '@/lib/graph/types';

/**
 * Stub playFrontierPreview — performs no audio playback (Spotify preview disabled per specs)
 */
export async function playFrontierPreview(node: OrcaNode): Promise<void> {
  // Silent no-op
  return Promise.resolve();
}

/**
 * Stub stopFrontierPreview — performs no action
 */
export async function stopFrontierPreview(): Promise<void> {
  // Silent no-op
  return Promise.resolve();
}

/**
 * Stub handleFrontierNodeHover — handles mouse hovers silently without triggering previews
 */
export function handleFrontierNodeHover(node: OrcaNode | null) {
  // Silent no-op
}
