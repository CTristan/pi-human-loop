/**
 * Zulip API client wrapper.
 *
 * Handles posting messages, registering event queues, long-polling for replies,
 * and deregistering queues. Uses raw `fetch()` for minimal dependencies.
 */

import type { ZulipClientConfig } from "./config.js";
import type { Logger } from "./logger.js";

export interface ZulipMessage {
  id: string;
  sender_email: string;
  content: string;
}

export interface ZulipUserProfile {
  email: string;
  full_name: string;
  user_id: number;
}

export interface ZulipStreamInfo {
  name: string;
  description?: string;
  stream_id?: number;
}

export interface ZulipClient {
  postMessage(stream: string, topic: string, content: string): Promise<string>;
  registerEventQueue(
    stream: string,
    topic: string,
  ): Promise<{ queueId: string; lastEventId: string }>;
  pollForReply(
    queueId: string,
    lastEventId: string,
    botEmail: string,
    signal: AbortSignal,
    options?: {
      stream?: string;
      topic?: string;
      onQueueReregister?: (newQueueId: string) => void;
      questionMessageId?: string;
    },
  ): Promise<ZulipMessage | null>;
  deregisterQueue(queueId: string): Promise<void>;
  validateCredentials(): Promise<ZulipUserProfile>;
  createStream(name: string, description?: string): Promise<void>;
  ensureSubscribed(streamName: string): Promise<void>;
  checkStreamExists(name: string): Promise<boolean>;
  getStreamSubscriptions(): Promise<ZulipStreamInfo[]>;
}

export interface CreateZulipClientOptions extends ZulipClientConfig {
  logger?: Logger;
}

/**
 * Generates the Authorization header value for Zulip API requests.
 */
function getAuthHeader(config: ZulipClientConfig): string {
  const credentials = `${config.botEmail}:${config.botApiKey}`;
  return `Basic ${Buffer.from(credentials).toString("base64")}`;
}

/**
 * Waits for a delay while reacting immediately to AbortSignal.
 *
 * @returns true when the delay elapsed, false when aborted.
 */
async function waitWithAbort(
  delayMs: number,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) {
    return false;
  }

  return await new Promise<boolean>((resolve) => {
    const timeoutId = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, delayMs);

    const onAbort = () => {
      clearTimeout(timeoutId);
      signal.removeEventListener("abort", onAbort);
      resolve(false);
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function requireOk(
  response: Response,
  context: string,
): Promise<Response> {
  if (response.ok) {
    return response;
  }

  const text = await response.text();
  throw new Error(
    `${context}: ${response.status} ${response.statusText} - ${text}`,
  );
}

/**
 * Creates a new Zulip client with the given configuration.
 */
export function createZulipClient(
  options: CreateZulipClientOptions,
): ZulipClient {
  const { serverUrl, botEmail, botApiKey, pollIntervalMs, logger } = options;
  const baseUrl = serverUrl.replace(/\/$/, "");
  const authHeader = getAuthHeader({
    serverUrl,
    botEmail,
    botApiKey,
    pollIntervalMs,
    debug: false,
  });

  const client: ZulipClient = {
    /**
     * Posts a message to a Zulip stream and topic.
     *
     * @returns The message ID of the posted message
     * @throws {Error} If the API request fails
     */
    async postMessage(
      stream: string,
      topic: string,
      content: string,
    ): Promise<string> {
      logger?.debug("ZulipClient.postMessage called", { stream, topic });
      const url = `${baseUrl}/api/v1/messages`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: authHeader,
        },
        body: new URLSearchParams({
          type: "stream",
          to: stream,
          topic,
          content,
        }).toString(),
      });

      await requireOk(response, "Failed to post message to Zulip");

      const data = (await response.json()) as { id: number };
      const messageId = data.id.toString();
      logger?.debug("ZulipClient.postMessage success", { messageId });
      return messageId;
    },

    /**
     * Registers an event queue for polling messages from a specific stream and topic.
     *
     * @returns The queue ID and last event ID for polling
     * @throws {Error} If the API request fails
     */
    async registerEventQueue(
      stream: string,
      topic: string,
    ): Promise<{ queueId: string; lastEventId: string }> {
      logger?.debug("ZulipClient.registerEventQueue called", { stream, topic });
      const url = `${baseUrl}/api/v1/register`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: authHeader,
        },
        body: new URLSearchParams({
          event_types: JSON.stringify(["message"]),
          narrow: JSON.stringify([
            ["stream", stream],
            ["topic", topic],
          ]),
          all_public_streams: "true",
        }).toString(),
      });

      await requireOk(response, "Failed to register event queue");

      const data = (await response.json()) as {
        queue_id: string;
        last_event_id: number;
      };
      const result = {
        queueId: data.queue_id,
        lastEventId: data.last_event_id.toString(),
      };
      logger?.debug("ZulipClient.registerEventQueue success", result);
      return result;
    },

    /**
     * Polls for a reply from a human in the specified event queue.
     *
     * Blocks until a non-bot message is received, signal.aborted is set,
     * or a fatal error occurs.
     *
     * @returns The human message, or null if aborted
     * @throws {Error} On fatal HTTP errors (after retries)
     */
    async pollForReply(
      queueId: string,
      lastEventId: string,
      botEmail: string,
      signal: AbortSignal,
      options?: {
        stream?: string;
        topic?: string;
        onQueueReregister?: (newQueueId: string) => void;
        questionMessageId?: string;
      },
    ): Promise<ZulipMessage | null> {
      logger?.debug("ZulipClient.pollForReply called", {
        queueId,
        lastEventId,
        botEmail,
      });
      let currentQueueId = queueId;
      let currentLastEventId = lastEventId;
      let retryCount = 0;
      const maxRetries = 10;
      const maxReregisterAttempts = 3;
      let reregisterAttempts = 0;

      while (!signal.aborted) {
        try {
          const url = new URL(`${baseUrl}/api/v1/events`);
          url.searchParams.set("queue_id", currentQueueId);
          url.searchParams.set("last_event_id", currentLastEventId);
          url.searchParams.set("dont_block", "false"); // Enable long-polling

          const response = await fetch(url.toString(), {
            method: "GET",
            headers: {
              Authorization: authHeader,
            },
            signal,
          });

          if (signal.aborted) {
            return null;
          }

          if (!response.ok) {
            // Handle BAD_EVENT_QUEUE_ID by re-registering the queue
            if (
              response.status === 400 &&
              reregisterAttempts < maxReregisterAttempts &&
              options?.stream &&
              options?.topic
            ) {
              const text = await response.text();
              if (text.includes("BAD_EVENT_QUEUE_ID")) {
                logger?.debug(
                  "BAD_EVENT_QUEUE_ID detected, re-registering queue",
                  {
                    oldQueueId: currentQueueId,
                    attempt: reregisterAttempts + 1,
                  },
                );

                try {
                  const newQueue = await client.registerEventQueue(
                    options.stream,
                    options.topic,
                  );
                  currentQueueId = newQueue.queueId;
                  currentLastEventId = newQueue.lastEventId;
                  reregisterAttempts++;
                  options.onQueueReregister?.(currentQueueId);
                  logger?.debug("Queue re-registered", {
                    newQueueId: currentQueueId,
                    newLastEventId: currentLastEventId,
                  });
                  continue;
                } catch (reregError) {
                  logger?.debug("Failed to re-register queue", {
                    error:
                      reregError instanceof Error
                        ? reregError.message
                        : String(reregError),
                  });
                }
              }
            }

            // Retry on server errors
            if (response.status >= 500 && retryCount < maxRetries) {
              const delay = Math.min(pollIntervalMs * 2 ** retryCount, 60000);
              const delayElapsed = await waitWithAbort(delay, signal);
              if (!delayElapsed) {
                return null;
              }
              retryCount++;
              continue;
            }

            const text = await response.text();
            throw new Error(
              `Failed to poll for reply: ${response.status} ${response.statusText} - ${text}`,
            );
          }

          // Reset retry count on success
          retryCount = 0;

          const data = (await response.json()) as {
            events?: Array<{
              id?: number;
              type?: string;
              message?: { id: number; sender_email: string; content: string };
            }>;
          };
          const events = data.events ?? [];

          if (events.length > 0) {
            logger?.debug("ZulipClient.pollForReply events received", {
              count: events.length,
              eventTypes: events.map((e) => e.type).filter(Boolean),
            });
          }

          if (events.length === 0) {
            // Long-poll timeout, continue polling
            continue;
          }

          // Check each event for a human message.
          // Zulip may send heartbeat events with no `message` payload.
          for (const event of events) {
            if (typeof event.id === "number") {
              currentLastEventId = event.id.toString();
            }

            if (!event.message) {
              continue;
            }

            // Validate that required message fields exist
            const { message } = event;
            if (
              typeof message.sender_email !== "string" ||
              typeof message.id !== "number" ||
              typeof message.content !== "string"
            ) {
              continue;
            }

            // Skip stale messages (from before the bot's question)
            if (options?.questionMessageId) {
              const questionId = parseInt(options.questionMessageId, 10);
              if (message.id <= questionId) {
                logger?.debug("Skipping stale message", {
                  messageId: message.id,
                  questionMessageId: options.questionMessageId,
                });
                continue;
              }
            }

            if (message.sender_email !== botEmail) {
              const reply = {
                id: message.id.toString(),
                sender_email: message.sender_email,
                content: message.content,
              };
              logger?.debug("ZulipClient.pollForReply reply received", {
                sender: reply.sender_email,
                messageId: reply.id,
              });
              return reply;
            }
          }
        } catch (error) {
          // If it's an abort error, return null
          if (signal.aborted) {
            return null;
          }

          // If it's a fetch error (network issue), retry
          if (error instanceof TypeError && retryCount < maxRetries) {
            const delay = Math.min(pollIntervalMs * 2 ** retryCount, 60000);
            const delayElapsed = await waitWithAbort(delay, signal);
            if (!delayElapsed) {
              return null;
            }
            retryCount++;
            continue;
          }

          // Re-throw other errors
          throw error;
        }
      }

      // Aborted
      logger?.debug("ZulipClient.pollForReply aborted");
      return null;
    },

    /**
     * Deregisters an event queue.
     *
     * Best-effort cleanup - errors are logged but not thrown.
     */
    async deregisterQueue(queueId: string): Promise<void> {
      logger?.debug("ZulipClient.deregisterQueue called", { queueId });
      try {
        const url = `${baseUrl}/api/v1/events`;
        const response = await fetch(url, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: authHeader,
          },
          body: new URLSearchParams({ queue_id: queueId }).toString(),
        });

        if (!response.ok) {
          // Log but don't throw - this is best-effort cleanup
          console.warn(
            `Failed to deregister queue ${queueId}: ${response.status} ${response.statusText}`,
          );
        }
      } catch (error) {
        // Log but don't throw - this is best-effort cleanup
        console.warn(`Failed to deregister queue ${queueId}:`, error);
      }
    },

    /**
     * Validates the provided credentials by fetching the bot's profile.
     */
    async validateCredentials(): Promise<ZulipUserProfile> {
      const url = `${baseUrl}/api/v1/users/me`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: authHeader,
        },
      });

      await requireOk(response, "Failed to validate credentials");

      const data = (await response.json()) as {
        email: string;
        full_name: string;
        user_id: number;
      };

      return {
        email: data.email,
        full_name: data.full_name,
        user_id: data.user_id,
      };
    },

    /**
     * Creates or subscribes to a stream. This is idempotent if the stream exists.
     */
    async createStream(name: string, description?: string): Promise<void> {
      logger?.debug("ZulipClient.createStream called", { name, description });
      const url = `${baseUrl}/api/v1/users/me/subscriptions`;
      const subscriptions = [{ name, ...(description ? { description } : {}) }];

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: authHeader,
        },
        body: new URLSearchParams({
          subscriptions: JSON.stringify(subscriptions),
        }).toString(),
      });

      await requireOk(response, "Failed to create or subscribe to stream");
    },

    /**
     * Ensures the bot is subscribed to a stream.
     * This is idempotent - safe to call if already subscribed.
     */
    async ensureSubscribed(streamName: string): Promise<void> {
      logger?.debug("ZulipClient.ensureSubscribed called", { streamName });
      const url = `${baseUrl}/api/v1/users/me/subscriptions`;
      const subscriptions = [{ name: streamName }];

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: authHeader,
        },
        body: new URLSearchParams({
          subscriptions: JSON.stringify(subscriptions),
        }).toString(),
      });

      await requireOk(response, "Failed to subscribe to stream");
    },

    /**
     * Checks if a stream exists by name.
     */
    async checkStreamExists(name: string): Promise<boolean> {
      const url = new URL(`${baseUrl}/api/v1/streams`);
      url.searchParams.set("include_subscribed", "true");

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Authorization: authHeader,
        },
      });

      await requireOk(response, "Failed to list streams");

      const data = (await response.json()) as {
        streams: Array<{ name: string }>;
      };

      return data.streams.some((stream) => stream.name === name);
    },

    /**
     * Returns streams the bot is subscribed to.
     */
    async getStreamSubscriptions(): Promise<ZulipStreamInfo[]> {
      const url = `${baseUrl}/api/v1/users/me/subscriptions`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: authHeader,
        },
      });

      await requireOk(response, "Failed to list stream subscriptions");

      const data = (await response.json()) as {
        subscriptions: Array<{
          name: string;
          description?: string;
          stream_id?: number;
        }>;
      };

      return data.subscriptions.map((subscription) => {
        const streamInfo: ZulipStreamInfo = {
          name: subscription.name,
        };

        if (subscription.description !== undefined) {
          streamInfo.description = subscription.description;
        }

        if (subscription.stream_id !== undefined) {
          streamInfo.stream_id = subscription.stream_id;
        }

        return streamInfo;
      });
    },
  };

  return client;
}
