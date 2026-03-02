/**
 * pi-human-loop Extension
 *
 * A Pi extension that enables an AI coding agent to start a conversation
 * with a human through Zulip whenever the agent has low confidence in a task.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { ASK_HUMAN_GUIDANCE } from "./src/prompt.js";
import { cleanupAllQueues } from "./src/queue-registry.js";
import { createAskHumanTool } from "./src/tool.js";
import { runWizard } from "./src/wizard.js";

export default function (pi: ExtensionAPI): void {
  pi.registerTool(createAskHumanTool());

  pi.registerCommand("human-loop-config", {
    description:
      "Configure Zulip bot credentials, stream settings, and auto-provisioning",
    handler: async (_args, ctx) => {
      void _args;
      await runWizard(ctx);
    },
  });

  // Inject usage guidance into system prompt
  pi.on("before_agent_start", async (event, _ctx) => {
    void _ctx;

    return {
      systemPrompt: `${event.systemPrompt}\n\n${ASK_HUMAN_GUIDANCE}`,
    };
  });

  // Clean up on session shutdown
  pi.on("session_shutdown", async (_event, _ctx) => {
    void _event;
    void _ctx;

    await cleanupAllQueues();
  });
}
