/**
 * Queue registry for cleanup on session shutdown.
 *
 * Manages active Zulip event queues that need cleanup when the session ends.
 * This module is shared between index.ts and src/tool.ts to avoid circular dependencies.
 */

import type { ZulipClient } from "./zulip-client.js";

type QueueClient = Pick<ZulipClient, "deregisterQueue">;

/**
 * Active event queues that need cleanup on shutdown.
 * Maps queue ID to Zulip client.
 */
const activeQueues = new Map<string, QueueClient>();

/**
 * Register an active queue for cleanup.
 */
export function registerQueue(queueId: string, client: QueueClient): void {
  activeQueues.set(queueId, client);
}

/**
 * Unregister a queue (already cleaned up).
 */
export function unregisterQueue(queueId: string): void {
  activeQueues.delete(queueId);
}

/**
 * Update a queue ID in the registry (e.g., after re-registration).
 * The old queue ID is unregistered and the new one is registered with the same client.
 *
 * @returns true if the old queue ID was found and updated, false otherwise
 */
export function updateQueue(oldQueueId: string, newQueueId: string): boolean {
  const existing = activeQueues.get(oldQueueId);
  if (existing !== undefined) {
    activeQueues.delete(oldQueueId);
    activeQueues.set(newQueueId, existing);
    return true;
  }
  return false;
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
