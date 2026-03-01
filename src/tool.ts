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
import { detectBranchName, detectRepoName } from "./repo.js";
import { createZulipClient, type ZulipClient } from "./zulip-client.js";

/**
 * Parameters for the ask_human tool.
 */
export interface AskHumanParams {
  message: string;
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
  ) => Promise<void>;
  detectBranchName: (options?: { cwd?: string }) => string;
  detectRepoName: (options?: { cwd?: string }) => string;
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
 * Zulip's maximum topic length in Unicode code points.
 * Topics longer than this will be silently truncated by Zulip.
 */
const ZULIP_MAX_TOPIC_LENGTH = 60;

/**
 * Builds a Zulip topic from a repo name and branch name.
 *
 * Format: "repo-name:branch-name"
 *
 * If the combined string exceeds 60 code points, truncation happens:
 * - A 60-code-point budget is allocated between repo and branch.
 * - Space is always reserved for the ":" separator and the "..." ellipsis.
 * - The branch side is truncated first and gets at least a small minimum
 *   budget; to preserve this, the repo name may be truncated even when it is
 *   shorter than 57 code points.
 * - When space is very limited, the branch may be dropped entirely if
 *   reserving even the minimum branch slice would leave insufficient space
 *   for a meaningful repo name.
 *
 * @param repoName - The repository name
 * @param branchName - The branch name
 * @returns A Zulip topic string (max 60 code points)
 */
export function buildTopic(repoName: string, branchName: string): string {
  const separator = ":";
  const ellipsis = "...";
  const separatorCodePoints = [...separator].length;
  const ellipsisCodePoints = [...ellipsis].length;

  const repoCodePoints = [...repoName];
  const branchCodePoints = [...branchName];

  // Total length without any truncation
  const totalLength =
    repoCodePoints.length + separatorCodePoints + branchCodePoints.length;

  if (totalLength <= ZULIP_MAX_TOPIC_LENGTH) {
    return `${repoName}${separator}${branchName}`;
  }

  // Calculate budget for the non-ellipsis portion
  const totalBudget = ZULIP_MAX_TOPIC_LENGTH - ellipsisCodePoints;

  // Reserve room for separator (if possible)
  const budgetForParts =
    totalBudget >= separatorCodePoints
      ? totalBudget - separatorCodePoints
      : totalBudget;

  // Reserve minimum budget for branch (at least 3 chars if space allows)
  // When space is very tight (6 or fewer code points available for repo:branch),
  // the branch may be dropped entirely
  const MIN_BRANCH_BUDGET = 3;
  const effectiveTotalBudget = budgetForParts - MIN_BRANCH_BUDGET;

  // Allocate repo budget, ensuring minimum branch budget if possible
  let repoBudget: number;
  if (
    effectiveTotalBudget > 0 &&
    repoCodePoints.length > effectiveTotalBudget
  ) {
    // Repo exceeds even with minimum branch reserved, cap it
    repoBudget = effectiveTotalBudget;
  } else {
    // Repo fits even with minimum branch reserved, or space is too tight
    repoBudget = Math.min(repoCodePoints.length, budgetForParts);
  }

  const branchBudget = budgetForParts - repoBudget;

  if (branchBudget > 0) {
    // Partial repo + partial branch
    const truncatedRepo = repoCodePoints.slice(0, repoBudget).join("");
    const truncatedBranch = branchCodePoints.slice(0, branchBudget).join("");
    return `${truncatedRepo}${separator}${truncatedBranch}${ellipsis}`;
  } else if (repoBudget >= separatorCodePoints) {
    // Repo fits with separator but no room for branch
    const truncatedRepo = repoCodePoints.slice(0, budgetForParts).join("");
    return `${truncatedRepo}${separator}${ellipsis}`;
  } else {
    // Even the repo name (plus separator) doesn't fit, truncate repo only
    const truncatedRepo = repoCodePoints.slice(0, budgetForParts).join("");
    return `${truncatedRepo}${ellipsis}`;
  }
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
    detectBranchName:
      dependencies.detectBranchName ??
      ((options) =>
        detectBranchName(options?.cwd ? { cwd: options.cwd } : undefined)),
    detectRepoName:
      dependencies.detectRepoName ??
      ((options) =>
        detectRepoName(options?.cwd ? { cwd: options.cwd } : undefined)),
  };

  return {
    name: "ask_human",
    label: "Ask Human",
    description:
      "Post a message to the team's Zulip chat and wait for a human response. Compose your message naturally — include context, code snippets, options considered, and your reasoning. End with your confidence score (out of 100) and why.",
    parameters: Type.Object({
      message: Type.String({
        description:
          "Your complete message to the human. Write naturally — include context, code snippets, options considered, and your reasoning. End with your confidence score and why.",
      }),
      confidence: Type.Number({
        description:
          "Your current confidence level (0-100) in resolving this without help. For internal tracking and debug logging.",
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

      // Track if stream existence has been ensured for this tool execution
      let streamEnsured = false;

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
            streamSource: config.streamSource,
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

        loggerRef.debug("Stream resolved", {
          stream: config.stream,
          source: config.streamSource,
        });

        // Ensure stream exists and bot is subscribed (idempotent)
        if (config.autoProvision && !streamEnsured) {
          try {
            await deps.autoProvisionStream(config, zulipClient, {
              cwd: ctx.cwd,
              logger: actualLogger,
            });
            streamEnsured = true;
            loggerRef.debug("Stream ensured", { stream: config.stream });
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            loggerRef.debug("Stream ensure failed", { error: message });
            return criticalResult(message);
          }
        }

        const askParams = params as AskHumanParams;

        loggerRef.debug("Tool execute called", {
          confidence: askParams.confidence,
          messageLength: askParams.message.length,
          isFollowUp: askParams.thread_id != null,
        });

        // Determine topic from follow-up thread_id or repo:branch
        let repo: string | undefined;
        let branch: string | undefined;
        const topic =
          askParams.thread_id != null
            ? askParams.thread_id!
            : (() => {
                repo = deps.detectRepoName({ cwd: ctx.cwd });
                branch = deps.detectBranchName({ cwd: ctx.cwd });
                loggerRef.debug("Repo name detected", {
                  repoName: repo,
                  cwd: ctx.cwd,
                });
                return buildTopic(repo, branch);
              })();

        loggerRef.debug("Topic constructed", {
          repo,
          branch,
          topic,
          truncated:
            askParams.thread_id == null && topic !== `${repo}:${branch}`,
        });

        // Ensure bot is subscribed to the stream (required for event queue events)
        // Skip if auto-provisioning already handled subscription
        if (!config.autoProvision) {
          await zulipClient.ensureSubscribed(config.stream);
          loggerRef.debug("Ensured bot subscription", {
            stream: config.stream,
          });
        } else {
          loggerRef.debug("Subscription already handled by auto-provisioning", {
            stream: config.stream,
          });
        }

        // Format and post message
        const message = askParams.message;

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
          const pollOptions = {
            stream: config.stream,
            topic,
            questionMessageId,
            onQueueReregister: (newQueueId: string) => {
              // Update the mutable reference and queue registry
              updateQueue(currentQueueId.id, newQueueId);
              currentQueueId.id = newQueueId;
              loggerRef.debug("Queue re-registered", { newQueueId });
            },
          };

          const reply = await zulipClient.pollForReply(
            currentQueueId.id,
            lastEventId,
            config.botEmail,
            abortSignal,
            pollOptions,
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
