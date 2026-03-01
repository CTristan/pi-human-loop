/**
 * Auto-provisioning helper for Zulip streams.
 */

import type { Config } from "./config.js";
import { getConfigPaths, loadProjectConfig, saveConfigFile } from "./config.js";
import type { Logger } from "./logger.js";
import { detectRepoName } from "./repo.js";
import type { ZulipClient } from "./zulip-client.js";

export async function autoProvisionStream(
  config: Config,
  zulipClient: ZulipClient,
  options?: { cwd?: string; logger?: Logger },
): Promise<string> {
  const { cwd = process.cwd(), logger } = options ?? {};

  logger?.debug("autoProvisionStream called", {
    autoProvision: config.autoProvision,
  });

  if (!config.autoProvision) {
    throw new Error(
      "No Zulip stream configured and auto-provisioning is disabled. Run /human-loop-config or set a stream name.",
    );
  }

  const streamName = detectRepoName({ cwd });

  if (!streamName) {
    throw new Error(
      "Unable to determine a repository name for stream creation.",
    );
  }

  logger?.debug("Auto-provisioning stream", { streamName, cwd });
  await zulipClient.createStream(streamName, config.streamDescription);

  const paths = getConfigPaths({ cwd });
  const projectConfig = loadProjectConfig(paths);
  projectConfig.stream = streamName;

  if (config.streamDescription) {
    projectConfig.streamDescription = config.streamDescription;
  }

  saveConfigFile(paths.projectPath, projectConfig);
  logger?.debug("Stream config saved", { streamPath: paths.projectPath });
  return streamName;
}
