/**
 * ask_human tool definition and execute logic.
 *
 * Wires config and Zulip client, formats messages, handles `thread_id`
 * for follow-ups, and supports `signal.aborted` for cancellation.
 */

import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { autoProvisionStream } from "./auto-provision.js";
import { type Config, loadConfig } from "./config.js";
import { registerQueue, unregisterQueue } from "./queue-registry.js";
import { createZulipClient, type ZulipClient } from "./zulip-client.js";

/**
 * Parameters for the ask_human tool.
 */
export interface AskHumanParams {
  question: string;
  context: string;
  confidence: number;
  thread_id?: string;
}

type RegisterToolArgument = Parameters<ExtensionAPI["registerTool"]>[0];

type AskHumanToolDetails = {
  thread_id?: string;
  responder?: string;
  status?: string;
};

interface AskHumanToolResult extends AgentToolResult<AskHumanToolDetails> {
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
}

type AskHumanTool = Omit<RegisterToolArgument, "execute"> & {
  execute(
    toolCallId: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback<AskHumanToolDetails> | undefined,
    ctx: ExtensionContext,
  ): Promise<AskHumanToolResult>;
};

export interface AskHumanToolDependencies {
  loadConfig: (ctx: ExtensionContext) => Config;
  createZulipClient: (config: Config) => ZulipClient;
  autoProvisionStream: (
    config: Config,
    client: ZulipClient,
    options: { cwd?: string },
  ) => Promise<string>;
}

const CRITICAL_SUFFIX = "Do NOT proceed — stop all work and report this error.";

function criticalResult(errorMessage: string): AskHumanToolResult {
  return {
    content: [
      {
        type: "text",
        text: `CRITICAL: Failed to reach human: ${errorMessage}. ${CRITICAL_SUFFIX}`,
      },
    ],
    isError: true,
    details: {},
  };
}

/**
 * Generates a topic name for a new question.
 */
function generateTopic(summary: string, questionNumber?: number): string {
  const shortSummary =
    summary.length > 50 ? `${summary.slice(0, 47)}...` : summary;
  const num = questionNumber ?? Date.now().toString(36);
  return `Agent Q #${num} — ${shortSummary}`;
}

/**
 * Extracts a short summary from the question for topic naming.
 */
function extractSummary(question: string): string {
  // Take the first sentence and let generateTopic trim it if needed.
  const firstSentence = question.split(/[.!?]/)[0]?.trim() ?? question;
  return firstSentence;
}

/**
 * Formats the message for posting to Zulip.
 */
function formatMessage(params: AskHumanParams, isFollowUp: boolean): string {
  if (isFollowUp) {
    return `🤖 **Follow-up:**

${params.question}

_Reply in this topic. The agent is waiting for your response._`;
  }

  const contextLines = params.context.split("\n").slice(0, 10).join("\n");
  return `🤖 **Agent needs help**

**Question:** ${params.question}

**Context:**
${contextLines}

**Confidence:** ${params.confidence}/100

_Reply in this topic. The agent is waiting for your response._`;
}

/**
 * Creates the ask_human tool definition.
 */
export function createAskHumanTool(
  dependencies: Partial<AskHumanToolDependencies> = {},
): AskHumanTool {
  const deps: AskHumanToolDependencies = {
    loadConfig:
      dependencies.loadConfig ?? ((ctx) => loadConfig({ cwd: ctx.cwd })),
    createZulipClient: dependencies.createZulipClient ?? createZulipClient,
    autoProvisionStream:
      dependencies.autoProvisionStream ??
      ((config, client, options) =>
        autoProvisionStream(config, client, options)),
  };

  return {
    name: "ask_human",
    label: "Ask Human",
    description:
      "Post a question to the team's Zulip chat and wait for a human response",
    parameters: Type.Object({
      question: Type.String({
        description: "The question to ask the human",
      }),
      context: Type.String({
        description:
          "Relevant context: error logs, code snippets, options considered, reasoning so far",
      }),
      confidence: Type.Number({
        description:
          "Your current confidence level (0-100) in resolving this without help",
        minimum: 0,
        maximum: 100,
      }),
      thread_id: Type.Optional(
        Type.String({
          description:
            "Continue an existing conversation. Use the thread_id from a previous ask_human response.",
        }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: unknown,
      signal: AbortSignal | undefined,
      onUpdate: AgentToolUpdateCallback<AskHumanToolDetails> | undefined,
      ctx: ExtensionContext,
    ) {
      void _toolCallId;

      try {
        // Check for abort at start
        if (signal?.aborted) {
          return {
            content: [{ type: "text", text: "Human consultation cancelled." }],
            isError: false,
            details: {},
          };
        }

        let config: Config;
        let zulipClient: ZulipClient;

        try {
          config = deps.loadConfig(ctx);
          zulipClient = deps.createZulipClient(config);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return criticalResult(message);
        }

        if (!config.stream) {
          try {
            const streamName = await deps.autoProvisionStream(
              config,
              zulipClient,
              {
                cwd: ctx.cwd,
              },
            );
            config.stream = streamName;
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            return criticalResult(message);
          }
        }

        if (!config.stream) {
          return criticalResult(
            "No stream configured. Run /human-loop-config or set ZULIP_STREAM.",
          );
        }

        const askParams = params as AskHumanParams;
        const isFollowUp = askParams.thread_id != null;

        // Determine topic
        const topic = isFollowUp
          ? askParams.thread_id!
          : generateTopic(extractSummary(askParams.question));

        // Format and post message
        const message = formatMessage(askParams, isFollowUp);

        // Stream progress
        onUpdate?.({
          content: [{ type: "text", text: "Posting question to Zulip..." }],
          details: { status: "posting" },
        });

        await zulipClient.postMessage(config.stream, topic, message);

        // Register event queue for polling
        const { queueId, lastEventId } = await zulipClient.registerEventQueue(
          config.stream,
          topic,
        );

        // Register queue for session shutdown cleanup
        registerQueue(queueId, zulipClient);

        // Clean up queue on function exit
        const cleanupQueue = async () => {
          try {
            await zulipClient.deregisterQueue(queueId);
          } catch {
            // Silently ignore cleanup errors
          } finally {
            unregisterQueue(queueId);
          }
        };

        try {
          onUpdate?.({
            content: [{ type: "text", text: "Waiting for human response..." }],
            details: { status: "waiting" },
          });

          const abortSignal = signal ?? new AbortController().signal;

          // Poll for reply (handles abort internally)
          const reply = await zulipClient.pollForReply(
            queueId,
            lastEventId,
            config.botEmail,
            abortSignal,
          );

          // Check if aborted while polling
          if (signal?.aborted || reply === null) {
            await cleanupQueue();
            return {
              content: [
                { type: "text", text: "Human consultation cancelled." },
              ],
              isError: false,
              details: {},
            };
          }

          // Reply received
          await cleanupQueue();

          onUpdate?.({
            content: [{ type: "text", text: "Human response received." }],
            details: { status: "received" },
          });

          return {
            content: [
              {
                type: "text",
                text: `Human replied: ${reply.content}`,
              },
            ],
            isError: false,
            details: {
              thread_id: topic,
              responder: reply.sender_email,
            },
          };
        } catch (pollError) {
          await cleanupQueue();

          // If aborted, return cancellation
          if (signal?.aborted) {
            return {
              content: [
                { type: "text", text: "Human consultation cancelled." },
              ],
              isError: false,
              details: {},
            };
          }

          throw pollError;
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        return criticalResult(errorMessage);
      }
    },
  };
}
