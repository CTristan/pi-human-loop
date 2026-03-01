/**
 * Auto-provisioning helper for Zulip streams.
 *
 * Ensures the configured stream exists and the bot is subscribed to it.
 */

import type { Config } from "./config.js";
import type { Logger } from "./logger.js";
import type { ZulipClient } from "./zulip-client.js";

/**
 * Ensures a stream exists and the bot is subscribed to it.
 *
 * This function is idempotent - calling it multiple times for the same stream
 * is safe and efficient.
 *
 * @param config - The current configuration
 * @param zulipClient - The Zulip client instance
 * @param options - Optional configuration
 * @throws Error if auto-provisioning is disabled or stream creation fails
 */
export async function autoProvisionStream(
  config: Config,
  zulipClient: ZulipClient,
  options?: { cwd?: string; logger?: Logger },
): Promise<void> {
  const { logger } = options ?? {};

  logger?.debug("autoProvisionStream called", {
    stream: config.stream,
    streamSource: config.streamSource,
    autoProvision: config.autoProvision,
  });

  if (!config.autoProvision) {
    throw new Error(
      "Stream auto-provisioning is disabled. Ensure the stream exists in Zulip or enable auto-provisioning.",
    );
  }

  logger?.debug("Ensuring stream exists", { stream: config.stream });
  await zulipClient.createStream(config.stream, config.streamDescription);

  // Ensure bot is subscribed to receive event queue events
  logger?.debug("Ensuring bot is subscribed", { stream: config.stream });
  await zulipClient.ensureSubscribed(config.stream);

  logger?.debug("Stream ensured successfully", { stream: config.stream });
}
