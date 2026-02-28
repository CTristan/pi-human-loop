/**
 * Queue registry for cleanup on session shutdown.
 *
 * Manages active Zulip event queues that need cleanup when the session ends.
 * This module is shared between index.ts and src/tool.ts to avoid circular dependencies.
 */

import type { ZulipClient } from "./zulip-client.js";

/**
 * Active event queues that need cleanup on shutdown.
 * Maps queue ID to Zulip client.
 */
const activeQueues = new Map<string, ZulipClient>();

/**
 * Register an active queue for cleanup.
 */
export function registerQueue(queueId: string, client: ZulipClient): void {
  activeQueues.set(queueId, client);
}

/**
 * Unregister a queue (already cleaned up).
 */
export function unregisterQueue(queueId: string): void {
  activeQueues.delete(queueId);
}

/**
 * Clean up all active queues.
 */
export async function cleanupAllQueues(): Promise<void> {
  const cleanupPromises = Array.from(activeQueues.entries()).map(
    async ([queueId, client]) => {
      try {
        await client.deregisterQueue(queueId);
      } catch (error) {
        // Log and ignore cleanup errors
        console.warn(`Failed to cleanup queue ${queueId}:`, error);
      } finally {
        activeQueues.delete(queueId);
      }
    },
  );

  await Promise.allSettled(cleanupPromises);
}
