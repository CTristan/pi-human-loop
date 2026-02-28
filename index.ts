/**
 * pi-human-loop Extension
 *
 * A Pi extension that enables an AI coding agent to start a conversation
 * with a human through Zulip whenever the agent has low confidence in a task.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadConfig } from "./src/config.js";
import { ASK_HUMAN_GUIDANCE } from "./src/prompt.js";
import { cleanupAllQueues } from "./src/queue-registry.js";
import { createAskHumanTool } from "./src/tool.js";
import { createZulipClient, type ZulipClient } from "./src/zulip-client.js";

export default function (pi: ExtensionAPI): void {
  // Load configuration - we do this at startup but allow extension to load
  // even if misconfigured. The tool will return errors on first call if needed.
  let config: ReturnType<typeof loadConfig> | null = null;
  let zulipClient: ZulipClient | null = null;
  let configError: Error | null = null;

  try {
    config = loadConfig();
    zulipClient = createZulipClient(config);
  } catch (error) {
    // Configuration not set - extension will load but tool will return errors on first call
    // This is intentional to avoid crashing Pi when extension is loaded but not configured
    configError = error instanceof Error ? error : new Error(String(error));
    console.warn(
      `pi-human-loop: Configuration error, extension will not be functional: ${configError.message}`,
    );
  }

  // Always register the ask_human tool - it will handle config errors lazily
  pi.registerTool(createAskHumanTool(config, zulipClient, configError));

  // Inject usage guidance into system prompt
  pi.on("before_agent_start", async (event, _ctx) => {
    return {
      systemPrompt: `${event.systemPrompt}\n\n${ASK_HUMAN_GUIDANCE}`,
    };
  });

  // Clean up on session shutdown (runs even if config is invalid)
  pi.on("session_shutdown", async (_event, _ctx) => {
    await cleanupAllQueues();
  });
}
