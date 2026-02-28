/**
 * ask_human tool definition and execute logic.
 *
 * Wires config and Zulip client, formats messages, handles `thread_id`
 * for follow-ups, and supports `signal.aborted` for cancellation.
 */

import { Type } from "@sinclair/typebox";
import { registerQueue, unregisterQueue } from "../index.js";
import type { Config } from "./config.js";
import type { ZulipClient } from "./zulip-client.js";

/**
 * Parameters for the ask_human tool.
 */
export interface AskHumanParams {
  question: string;
  context: string;
  confidence: number;
  thread_id?: string;
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
  // Take the first sentence or first ~30 chars
  const firstSentence = question.split(/[.!?]/)[0]?.trim() ?? question;
  return firstSentence.length > 30 ? firstSentence.slice(0, 30) : firstSentence;
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
  config: Config,
  zulipClient: ZulipClient,
): any {
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
      signal: AbortSignal,
      onUpdate:
        | ((update: { type: string; content: string }) => void)
        | undefined,
      _ctx: unknown,
    ) {
      try {
        // Check for abort at start
        if (signal.aborted) {
          return {
            content: [{ type: "text", text: "Human consultation cancelled." }],
            isError: false,
            details: {},
          };
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
          type: "progress",
          content: "Posting question to Zulip...",
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
            type: "progress",
            content: "Waiting for human response...",
          });

          // Poll for reply (handles abort internally)
          const reply = await zulipClient.pollForReply(
            queueId,
            lastEventId,
            config.botEmail,
            signal,
          );

          // Check if aborted while polling
          if (signal.aborted || reply === null) {
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
            type: "progress",
            content: "Human response received.",
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
          if (signal.aborted) {
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
        // Return error result - LLM proceeds with best guess
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text",
              text: `Failed to reach human: ${errorMessage}. Proceeding without human input.`,
            },
          ],
          isError: true,
          details: {},
        };
      }
    },
  };
}
