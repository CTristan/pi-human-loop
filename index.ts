/**
 * pi-human-loop Extension
 *
 * A Pi extension that enables an AI coding agent to start a conversation
 * with a human through Zulip whenever the agent has low confidence in a task.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadConfig } from "./src/config.js";
import { ASK_HUMAN_GUIDANCE } from "./src/prompt.js";
import { createAskHumanTool } from "./src/tool.js";
import { createZulipClient, type ZulipClient } from "./src/zulip-client.js";

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
async function cleanupAllQueues(): Promise<void> {
  const cleanupPromises = Array.from(activeQueues.entries()).map(
    async ([queueId, client]) => {
      try {
        await client.deregisterQueue(queueId);
      } catch (error) {
        // Silently ignore cleanup errors
        console.warn(`Failed to cleanup queue ${queueId}:`, error);
      } finally {
        activeQueues.delete(queueId);
      }
    },
  );

  await Promise.allSettled(cleanupPromises);
}

export default function (pi: ExtensionAPI): void {
  // Load configuration - we do this at startup to fail fast if misconfigured
  // but don't throw to allow extension to be loaded without env vars
  let config: ReturnType<typeof loadConfig> | null = null;
  let zulipClient: ZulipClient | null = null;

  try {
    config = loadConfig();
    zulipClient = createZulipClient(config);
  } catch (error) {
    // Configuration not set - extension will load but tool will return errors on first call
    // This is intentional to avoid crashing Pi when extension is loaded but not configured
    console.warn(
      `pi-human-loop: Configuration error, extension will not be functional: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // Only register tool and event handlers if we have valid config
  if (config && zulipClient) {
    // Register the ask_human tool
    pi.registerTool(createAskHumanTool(config, zulipClient));

    // Inject usage guidance into system prompt
    pi.on("before_agent_start", async (event, _ctx) => {
      return {
        systemPrompt: `${event.systemPrompt}\n\n${ASK_HUMAN_GUIDANCE}`,
      };
    });
  }

  // Clean up on session shutdown (runs even if config is invalid)
  pi.on("session_shutdown", async (_event, _ctx) => {
    await cleanupAllQueues();
  });
}
