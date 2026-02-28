/**
 * Zulip API client wrapper.
 *
 * Handles posting messages, registering event queues, long-polling for replies,
 * and deregistering queues. Uses raw `fetch()` for minimal dependencies.
 */

import type { Config } from "./config.js";

export interface ZulipMessage {
  id: string;
  sender_email: string;
  content: string;
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
  ): Promise<ZulipMessage | null>;
  deregisterQueue(queueId: string): Promise<void>;
}

/**
 * Generates the Authorization header value for Zulip API requests.
 */
function getAuthHeader(config: Config): string {
  const credentials = `${config.botEmail}:${config.botApiKey}`;
  return `Basic ${Buffer.from(credentials).toString("base64")}`;
}

/**
 * Creates a new Zulip client with the given configuration.
 */
export function createZulipClient(config: Config): ZulipClient {
  const baseUrl = config.serverUrl.replace(/\/$/, "");
  const authHeader = getAuthHeader(config);
  const pollIntervalMs = config.pollIntervalMs;

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

      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `Failed to post message to Zulip: ${response.status} ${response.statusText} - ${text}`,
        );
      }

      const data = (await response.json()) as { id: number };
      return data.id.toString();
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
        }).toString(),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `Failed to register event queue: ${response.status} ${response.statusText} - ${text}`,
        );
      }

      const data = (await response.json()) as {
        queue_id: string;
        last_event_id: number;
      };
      return {
        queueId: data.queue_id,
        lastEventId: data.last_event_id.toString(),
      };
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
    ): Promise<ZulipMessage | null> {
      let currentLastEventId = lastEventId;
      let retryCount = 0;
      const maxRetries = 10;

      while (!signal.aborted) {
        try {
          const url = new URL(`${baseUrl}/api/v1/events`);
          url.searchParams.set("queue_id", queueId);
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
            // Retry on server errors
            if (response.status >= 500 && retryCount < maxRetries) {
              const delay = Math.min(pollIntervalMs * 2 ** retryCount, 60000);
              await new Promise((resolve) => setTimeout(resolve, delay));
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
              id: number;
              message: { id: number; sender_email: string; content: string };
            }>;
          };
          const events = data.events ?? [];

          if (events.length === 0) {
            // Long-poll timeout, continue polling
            continue;
          }

          // Check each event for a human message
          for (const event of events) {
            if (event.message.sender_email !== botEmail) {
              currentLastEventId = event.id.toString();
              return {
                id: event.message.id.toString(),
                sender_email: event.message.sender_email,
                content: event.message.content,
              };
            }
            // Update last event ID even for bot messages
            currentLastEventId = event.id.toString();
          }
        } catch (error) {
          // If it's an abort error, return null
          if (signal.aborted) {
            return null;
          }

          // If it's a fetch error (network issue), retry
          if (error instanceof TypeError && retryCount < maxRetries) {
            const delay = Math.min(pollIntervalMs * 2 ** retryCount, 60000);
            await new Promise((resolve) => setTimeout(resolve, delay));
            retryCount++;
            continue;
          }

          // Re-throw other errors
          throw error;
        }
      }

      // Aborted
      return null;
    },

    /**
     * Deregisters an event queue.
     *
     * Best-effort cleanup - errors are logged but not thrown.
     */
    async deregisterQueue(queueId: string): Promise<void> {
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
  };

  return client;
}
