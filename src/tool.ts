/**
 * ask_human tool definition and execute logic.
 *
 * Wires config and Zulip client, formats messages, handles `thread_id`
 * for follow-ups, and supports `signal.aborted` for cancellation.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { Config } from "./config.ts";
import type { ZulipClient } from "./zulip-client.ts";

/**
 * Creates the ask_human tool definition.
 */
export function createAskHumanTool(
  config: Config,
  zulipClient: ZulipClient,
): ExtensionAPI["registerTool"]["parameters"] {
  return {
    name: "ask_human",
    label: "Ask Human",
    description: "Post a question to the team's Zulip chat and wait for a human response",
    parameters: Type.Object({
      question: Type.String({
        description: "The question to ask the human",
      }),
      context: Type.String({
        description: "Relevant context: error logs, code snippets, options considered, reasoning so far",
      }),
      confidence: Type.Number({
        description: "Your current confidence level (0-100) in resolving this without help",
      }),
      thread_id: Type.Optional(
        Type.String({
          description: "Continue an existing conversation. Use the thread_id from a previous ask_human response.",
        }),
      ),
    }),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      // TODO: Implement tool execute logic
      throw new Error("Not implemented yet");
    },
  };
}
