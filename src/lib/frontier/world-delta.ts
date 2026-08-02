/**
 * Computes add/remove/change deltas between two frontier node snapshots.
 * Extracted from the former world-regeneration module for shared use.
 */

export function computeWorldDelta(
  oldNodes: Array<{ id: string; semanticRole?: string; reachable?: boolean; availableActions?: unknown }>,
  newNodes: Array<{ id: string; semanticRole?: string; reachable?: boolean; availableActions?: unknown }>,
): { added: string[]; removed: string[]; changed: string[] } {
  const oldMap = new Map(oldNodes.map((n) => [n.id, n]));
  const newMap = new Map(newNodes.map((n) => [n.id, n]));

  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const n of newNodes) {
    if (!oldMap.has(n.id)) {
      added.push(n.id);
    } else {
      const oldNode = oldMap.get(n.id)!;
      const roleChanged = oldNode.semanticRole !== n.semanticRole;
      const reachableChanged = oldNode.reachable !== n.reachable;
      const actionsChanged =
        JSON.stringify(oldNode.availableActions) !== JSON.stringify(n.availableActions);
      if (roleChanged || reachableChanged || actionsChanged) {
        changed.push(n.id);
      }
    }
  }

  for (const id of oldMap.keys()) {
    if (!newMap.has(id)) {
      removed.push(id);
    }
  }

  return { added, removed, changed };
}
