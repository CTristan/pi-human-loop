/**
 * Zulip API client wrapper.
 *
 * Handles posting messages, registering event queues, long-polling for replies,
 * and deregistering queues. Uses raw `fetch()` for minimal dependencies.
 */

import type { Config } from "./config.ts";

export interface ZulipMessage {
  id: string;
  sender_email: string;
  content: string;
}

export interface ZulipClient {
  postMessage(stream: string, topic: string, content: string): Promise<string>;
  registerEventQueue(stream: string, topic: string): Promise<{ queueId: string; lastEventId: string }>;
  pollForReply(queueId: string, lastEventId: string, botEmail: string, signal: AbortSignal): Promise<ZulipMessage | null>;
  deregisterQueue(queueId: string): Promise<void>;
}

/**
 * Creates a new Zulip client with the given configuration.
 */
export function createZulipClient(config: Config): ZulipClient {
  // TODO: Implement Zulip client
  throw new Error("Not implemented yet");
}
