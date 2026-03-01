/**
 * Auto-provisioning helper for Zulip streams.
 */

import type { Config } from "./config.js";
import { getConfigPaths, loadProjectConfig, saveConfigFile } from "./config.js";
import { detectRepoName } from "./repo.js";
import type { ZulipClient } from "./zulip-client.js";

export async function autoProvisionStream(
  config: Config,
  zulipClient: ZulipClient,
  options?: { cwd?: string },
): Promise<string> {
  if (!config.autoProvision) {
    throw new Error(
      "No Zulip stream configured and auto-provisioning is disabled. Run /human-loop-config or set a stream name.",
    );
  }

  const cwd = options?.cwd ?? process.cwd();
  const streamName = detectRepoName({ cwd });

  if (!streamName) {
    throw new Error(
      "Unable to determine a repository name for stream creation.",
    );
  }

  await zulipClient.createStream(streamName, config.streamDescription);

  const paths = getConfigPaths({ cwd });
  const projectConfig = loadProjectConfig(paths);
  projectConfig.stream = streamName;

  if (config.streamDescription) {
    projectConfig.streamDescription = config.streamDescription;
  }

  saveConfigFile(paths.projectPath, projectConfig);
  return streamName;
}
