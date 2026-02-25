/**
 * pi-human-loop Extension
 *
 * A Pi extension that enables an AI coding agent to start a conversation
 * with a human through Zulip whenever the agent has low confidence in a task.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadConfig } from "./src/config.ts";
import { createZulipClient } from "./src/zulip-client.ts";
import { createAskHumanTool } from "./src/tool.ts";
import { ASK_HUMAN_GUIDANCE } from "./src/prompt.ts";

export default function (pi: ExtensionAPI): void {
  // Load configuration
  const config = loadConfig();

  // Create Zulip client
  const zulipClient = createZulipClient(config);

  // Register the ask_human tool
  pi.registerTool(createAskHumanTool(config, zulipClient));

  // Inject usage guidance into system prompt
  pi.on("before_agent_start", async (event, _ctx) => {
    return {
      systemPrompt: event.systemPrompt + "\n\n" + ASK_HUMAN_GUIDANCE,
    };
  });

  // Clean up on session shutdown
  pi.on("session_shutdown", async (_event, _ctx) => {
    // TODO: Deregister any active Zulip event queues
  });
}
