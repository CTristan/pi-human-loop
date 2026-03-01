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
import { createLogger } from "./logger.js";
import {
  registerQueue,
  unregisterQueue,
  updateQueue,
} from "./queue-registry.js";
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
  createZulipClient: (
    config: import("./zulip-client.js").CreateZulipClientOptions,
  ) => ZulipClient;
  autoProvisionStream: (
    config: Config,
    client: ZulipClient,
    options?: { cwd?: string; logger?: import("./logger.js").Logger },
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

      // Create logger reference (will be set after config loads)
      const loggerRef: {
        debug: (message: string, data?: Record<string, unknown>) => void;
      } = {
        debug: () => {}, // No-op initially
      };

      // Create initial logger
      const initialLogger = createLogger({
        debug: false,
        logPath: ".pi/human-loop-debug.log",
        cwd: ctx.cwd,
      });
      loggerRef.debug = initialLogger.debug;

      try {
        // Check for abort at start
        if (signal?.aborted) {
          loggerRef.debug("Tool execution cancelled at start");
          return {
            content: [{ type: "text", text: "Human consultation cancelled." }],
            isError: false,
            details: {},
          };
        }

        let config: Config;
        let zulipClient: ZulipClient;
        let actualLogger = initialLogger;

        try {
          config = deps.loadConfig(ctx);
          // Re-create logger with actual debug setting from config
          actualLogger = createLogger({
            debug: config.debug,
            logPath: ".pi/human-loop-debug.log",
            cwd: ctx.cwd,
          });
          // Copy the actual logger methods to the existing logger reference
          loggerRef.debug = actualLogger.debug;

          loggerRef.debug("Config loaded", {
            serverUrl: config.serverUrl,
            botEmail: config.botEmail,
            stream: config.stream,
            debug: config.debug,
          });

          const zulipConfig = {
            serverUrl: config.serverUrl,
            botEmail: config.botEmail,
            botApiKey: config.botApiKey,
            pollIntervalMs: config.pollIntervalMs,
            debug: config.debug,
            logger: actualLogger,
          };
          zulipClient = deps.createZulipClient(zulipConfig);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          loggerRef.debug("Failed to load config", { error: message });
          return criticalResult(message);
        }

        if (!config.stream) {
          try {
            loggerRef.debug("Auto-provisioning stream");
            const streamName = await deps.autoProvisionStream(
              config,
              zulipClient,
              {
                cwd: ctx.cwd,
                logger: actualLogger,
              },
            );
            config.stream = streamName;
            loggerRef.debug("Stream auto-provisioned", { streamName });
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            loggerRef.debug("Auto-provision failed", { error: message });
            return criticalResult(message);
          }
        }

        if (!config.stream) {
          loggerRef.debug("No stream configured");
          return criticalResult(
            "No stream configured. Run /human-loop-config or set ZULIP_STREAM.",
          );
        }

        const askParams = params as AskHumanParams;
        const isFollowUp = askParams.thread_id != null;

        loggerRef.debug("Tool execute called", {
          isFollowUp,
          confidence: askParams.confidence,
          questionLength: askParams.question.length,
          contextLength: askParams.context.length,
        });

        // Determine topic
        const topic = isFollowUp
          ? askParams.thread_id!
          : generateTopic(extractSummary(askParams.question));

        loggerRef.debug("Topic chosen", { topic, isFollowUp });

        // Format and post message
        const message = formatMessage(askParams, isFollowUp);

        // Stream progress
        onUpdate?.({
          content: [{ type: "text", text: "Posting question to Zulip..." }],
          details: { status: "posting" },
        });

        const questionMessageId = await zulipClient.postMessage(
          config.stream,
          topic,
          message,
        );
        loggerRef.debug("Message posted", {
          stream: config.stream,
          topic,
          messageId: questionMessageId,
        });

        // Ensure bot is subscribed to the stream (required for event queue events)
        await zulipClient.ensureSubscribed(config.stream);
        loggerRef.debug("Ensured bot subscription", { stream: config.stream });

        // Register event queue for polling
        const { queueId, lastEventId } = await zulipClient.registerEventQueue(
          config.stream,
          topic,
        );
        loggerRef.debug("Event queue registered", { queueId, lastEventId });

        // Mutable reference to track current queue ID (for re-registration support)
        const currentQueueId = { id: queueId };

        // Register queue for session shutdown cleanup
        registerQueue(currentQueueId.id, zulipClient);

        // Clean up queue on function exit
        const cleanupQueue = async () => {
          try {
            await zulipClient.deregisterQueue(currentQueueId.id);
          } catch {
            // Silently ignore cleanup errors
          } finally {
            unregisterQueue(currentQueueId.id);
          }
        };

        try {
          onUpdate?.({
            content: [{ type: "text", text: "Waiting for human response..." }],
            details: { status: "waiting" },
          });

          loggerRef.debug("Polling for reply started", {
            queueId,
            lastEventId,
            botEmail: config.botEmail,
            stream: config.stream,
            topic,
          });

          const abortSignal = signal ?? new AbortController().signal;

          // Poll for reply (handles abort internally)
          const reply = await zulipClient.pollForReply(
            currentQueueId.id,
            lastEventId,
            config.botEmail,
            abortSignal,
            {
              stream: config.stream,
              topic,
              questionMessageId,
              onQueueReregister: (newQueueId) => {
                // Update the mutable reference and queue registry
                updateQueue(currentQueueId.id, newQueueId, zulipClient);
                currentQueueId.id = newQueueId;
                loggerRef.debug("Queue re-registered", { newQueueId });
              },
            },
          );

          // Check if aborted while polling
          if (signal?.aborted || reply === null) {
            loggerRef.debug("Polling cancelled");
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
          loggerRef.debug("Reply received", {
            sender: reply.sender_email,
            contentLength: reply.content.length,
          });
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
          loggerRef.debug("Polling error", {
            error:
              pollError instanceof Error
                ? pollError.message
                : String(pollError),
          });
          await cleanupQueue();

          // If aborted, return cancellation
          if (signal?.aborted) {
            loggerRef.debug("Polling cancelled after error");
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
        loggerRef.debug("Tool execution error", { error: errorMessage });
        return criticalResult(errorMessage);
      }
    },
  };
}
