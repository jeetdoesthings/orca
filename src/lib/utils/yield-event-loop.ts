/**
 * Yield the event loop so other requests (API routes) get a tick.
 * The materialization pipeline is synchronous in the Node event loop —
 * async fetch calls yield, but long stretches of CPU-bound work (DB queries,
 * distance computation, node construction) block everything else.
 *
 * Call every ~20 iterations in the hottest loops so session/artists/globe
 * routes can squeeze in between pipeline batches.
 */
export async function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
