/**
 * Interactive configuration wizard for pi-human-loop.
 */

import path from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
  CONFIG_DEFAULTS,
  type Config,
  getConfigPaths,
  loadConfig,
  loadGlobalConfig,
  loadProjectConfig,
  saveConfigFile,
} from "./config.js";
import { selectWrapped } from "./ui-helpers.js";
import { createZulipClient } from "./zulip-client.js";

export interface WizardDependencies {
  getConfigPaths: typeof getConfigPaths;
  loadGlobalConfig: typeof loadGlobalConfig;
  loadProjectConfig: typeof loadProjectConfig;
  saveConfigFile: typeof saveConfigFile;
  loadConfig: typeof loadConfig;
  createZulipClient: typeof createZulipClient;
  selectWrapped: typeof selectWrapped;
}

function notify(
  ctx: ExtensionContext,
  type: "info" | "warning" | "error",
  message: string,
): void {
  ctx.ui.notify(message, type);
}

function getCurrentValue(raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  return typeof value === "string" ? value : "";
}

interface PromptInputOptions {
  currentValue?: string;
  hideCurrentValue?: boolean;
}

const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;

async function promptInput(
  ctx: ExtensionContext,
  title: string,
  options: PromptInputOptions = {},
): Promise<string | undefined> {
  const { currentValue, hideCurrentValue = false } = options;
  const suffix = currentValue
    ? hideCurrentValue
      ? " (current: [redacted])"
      : ` (current: ${currentValue})`
    : "";

  const value = await ctx.ui.input(`${title}${suffix}`);
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 && currentValue) {
    return currentValue;
  }
  return trimmed;
}

function parsePositiveIntegerInput(value: string): number | undefined {
  if (!POSITIVE_INTEGER_PATTERN.test(value)) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

async function promptNumber(
  ctx: ExtensionContext,
  title: string,
  currentValue: number,
): Promise<number | undefined> {
  const value = await ctx.ui.input(`${title} (current: ${currentValue}ms)`);
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return currentValue;
  }

  const parsed = parsePositiveIntegerInput(trimmed);
  if (parsed === undefined) {
    notify(ctx, "error", "Poll interval must be a positive integer.");
    return undefined;
  }

  return parsed;
}

function loadMergedConfig(
  deps: WizardDependencies,
  ctx: ExtensionContext,
): Config | null {
  try {
    return deps.loadConfig({ cwd: ctx.cwd });
  } catch (error) {
    notify(ctx, "error", `Failed to load configuration: ${String(error)}`);
    return null;
  }
}

export async function runWizard(
  ctx: ExtensionContext,
  dependencies: Partial<WizardDependencies> = {},
): Promise<void> {
  if (!ctx.hasUI) {
    notify(ctx, "error", "Human-loop configuration requires interactive mode.");
    return;
  }

  const deps: WizardDependencies = {
    getConfigPaths: dependencies.getConfigPaths ?? getConfigPaths,
    loadGlobalConfig: dependencies.loadGlobalConfig ?? loadGlobalConfig,
    loadProjectConfig: dependencies.loadProjectConfig ?? loadProjectConfig,
    saveConfigFile: dependencies.saveConfigFile ?? saveConfigFile,
    loadConfig: dependencies.loadConfig ?? loadConfig,
    createZulipClient: dependencies.createZulipClient ?? createZulipClient,
    selectWrapped: dependencies.selectWrapped ?? selectWrapped,
  };

  const paths = deps.getConfigPaths({ cwd: ctx.cwd });
  const locationLabels = [
    `Global (${paths.globalPath})`,
    `Project (${paths.projectPath})`,
  ];

  let globalRaw: Record<string, unknown>;
  try {
    globalRaw = deps.loadGlobalConfig(paths);
  } catch (error) {
    notify(
      ctx,
      "warning",
      `Failed to load global configuration from ${paths.globalPath}: ${String(error)}. Continuing with empty global configuration.`,
    );
    globalRaw = {};
  }

  let projectRaw: Record<string, unknown>;
  try {
    projectRaw = deps.loadProjectConfig(paths);
  } catch (error) {
    notify(
      ctx,
      "warning",
      `Failed to load project configuration from ${paths.projectPath}: ${String(error)}. Continuing with empty project configuration.`,
    );
    projectRaw = {};
  }

  while (true) {
    const debugValue =
      typeof globalRaw.debug === "boolean" ? globalRaw.debug : false;

    const menuOptions = [
      "Configure bot credentials",
      "Configure stream",
      "Configure auto-provision",
      "Configure poll interval",
      `Configure debug logging (current: ${debugValue ? "enabled" : "disabled"})`,
      "Done",
    ];

    const action = await deps.selectWrapped(
      ctx,
      "Human loop configuration",
      menuOptions,
    );
    if (!action || action === "Done") {
      return;
    }

    if (action === "Configure bot credentials") {
      const serverUrl = await promptInput(ctx, "Zulip server URL", {
        currentValue: getCurrentValue(globalRaw, "serverUrl"),
      });
      if (!serverUrl) {
        notify(ctx, "warning", "Server URL is required.");
        continue;
      }

      const botEmail = await promptInput(ctx, "Bot email", {
        currentValue: getCurrentValue(globalRaw, "botEmail"),
      });
      if (!botEmail) {
        notify(ctx, "warning", "Bot email is required.");
        continue;
      }

      const botApiKey = await promptInput(ctx, "Bot API key", {
        currentValue: getCurrentValue(globalRaw, "botApiKey"),
        hideCurrentValue: true,
      });
      if (!botApiKey) {
        notify(ctx, "warning", "Bot API key is required.");
        continue;
      }

      const pollInterval =
        typeof globalRaw.pollIntervalMs === "number"
          ? globalRaw.pollIntervalMs
          : CONFIG_DEFAULTS.pollIntervalMs;

      const debug =
        typeof globalRaw.debug === "boolean" ? globalRaw.debug : false;

      try {
        const client = deps.createZulipClient({
          serverUrl,
          botEmail,
          botApiKey,
          pollIntervalMs: pollInterval,
          debug,
        });

        const profile = await client.validateCredentials();
        notify(
          ctx,
          "info",
          `✅ Connected as ${profile.full_name || profile.email}.`,
        );
      } catch (error) {
        notify(ctx, "error", `❌ Authentication failed: ${String(error)}`);
        continue;
      }

      globalRaw.serverUrl = serverUrl;
      globalRaw.botEmail = botEmail;
      globalRaw.botApiKey = botApiKey;

      try {
        deps.saveConfigFile(paths.globalPath, globalRaw);
        notify(ctx, "info", `Saved credentials to ${paths.globalPath}.`);
      } catch (error) {
        notify(ctx, "error", `Failed to save config: ${String(error)}`);
      }

      continue;
    }

    if (action === "Configure stream") {
      const defaultStream =
        (typeof projectRaw.stream === "string" && projectRaw.stream) ||
        (typeof globalRaw.stream === "string" && globalRaw.stream) ||
        "pi-human-loop";

      const streamName = await promptInput(ctx, "Stream name", {
        currentValue: defaultStream,
      });
      if (!streamName) {
        notify(ctx, "warning", "Stream name is required.");
        continue;
      }

      const descriptionInput = await ctx.ui.input(
        "Stream description (optional)",
      );
      const streamDescription = descriptionInput?.trim() || undefined;

      const createNow = await ctx.ui.confirm(
        "Create stream now?",
        "Create/subscribe to this stream in Zulip now?",
      );

      if (createNow) {
        const mergedConfig = loadMergedConfig(deps, ctx);
        if (!mergedConfig) {
          continue;
        }

        try {
          const client = deps.createZulipClient(mergedConfig);
          await client.createStream(streamName, streamDescription);
          notify(ctx, "info", `Stream "${streamName}" is ready.`);
        } catch (error) {
          notify(ctx, "error", `Failed to create stream: ${String(error)}`);
          continue;
        }
      }

      const saveLocation = await deps.selectWrapped(
        ctx,
        "Save stream configuration to",
        [
          `Global default (${paths.globalPath})`,
          `Project override (${paths.projectPath})`,
        ],
      );
      if (!saveLocation) {
        continue;
      }

      const saveToProject = saveLocation.startsWith("Project");
      const targetRaw = saveToProject ? projectRaw : globalRaw;
      const targetPath = saveToProject ? paths.projectPath : paths.globalPath;

      targetRaw.stream = streamName;
      if (streamDescription) {
        targetRaw.streamDescription = streamDescription;
      } else {
        delete targetRaw.streamDescription;
      }

      try {
        deps.saveConfigFile(targetPath, targetRaw);
        if (saveToProject) {
          notify(
            ctx,
            "info",
            `Saved stream override for this project to ${targetPath}. All agent questions from this repo will use this stream.`,
          );
        } else {
          notify(
            ctx,
            "info",
            `Saved global default stream to ${targetPath}. All agent questions will use this stream unless overridden at the project level.`,
          );
        }
      } catch (error) {
        notify(ctx, "error", `Failed to save stream config: ${String(error)}`);
      }

      continue;
    }

    if (action === "Configure auto-provision") {
      const currentValue =
        typeof globalRaw.autoProvision === "boolean"
          ? globalRaw.autoProvision
          : CONFIG_DEFAULTS.autoProvision;
      const choice = await deps.selectWrapped(
        ctx,
        `Auto-provision streams (current: ${currentValue ? "enabled" : "disabled"})`,
        [currentValue ? "Disable auto-provision" : "Enable auto-provision"],
      );
      if (!choice) {
        continue;
      }

      const enabled = choice.startsWith("Enable");
      globalRaw.autoProvision = enabled;

      try {
        deps.saveConfigFile(paths.globalPath, globalRaw);
        if (enabled) {
          notify(
            ctx,
            "info",
            `Auto-provision enabled. The stream will be created automatically if it doesn't exist.`,
          );
        } else {
          notify(
            ctx,
            "info",
            `Auto-provision disabled. Ensure the configured stream exists in Zulip before using the tool.`,
          );
        }
      } catch (error) {
        notify(ctx, "error", `Failed to save config: ${String(error)}`);
      }

      continue;
    }

    if (action === "Configure poll interval") {
      const currentInterval =
        (typeof projectRaw.pollIntervalMs === "number"
          ? projectRaw.pollIntervalMs
          : undefined) ??
        (typeof globalRaw.pollIntervalMs === "number"
          ? globalRaw.pollIntervalMs
          : undefined) ??
        CONFIG_DEFAULTS.pollIntervalMs;

      const pollInterval = await promptNumber(
        ctx,
        "Poll interval in milliseconds",
        currentInterval,
      );
      if (!pollInterval) {
        continue;
      }

      const saveLocation = await deps.selectWrapped(
        ctx,
        "Save poll interval to",
        locationLabels,
      );
      if (!saveLocation) {
        continue;
      }

      const saveToProject = saveLocation === locationLabels[1];
      const targetRaw = saveToProject ? projectRaw : globalRaw;
      const targetPath = saveToProject ? paths.projectPath : paths.globalPath;

      targetRaw.pollIntervalMs = pollInterval;

      try {
        deps.saveConfigFile(targetPath, targetRaw);
        notify(ctx, "info", `Poll interval saved to ${targetPath}.`);
      } catch (error) {
        notify(ctx, "error", `Failed to save poll interval: ${String(error)}`);
      }

      continue;
    }

    if (action.startsWith("Configure debug logging")) {
      const currentValue =
        typeof globalRaw.debug === "boolean" ? globalRaw.debug : false;
      const choice = await deps.selectWrapped(
        ctx,
        `Debug logging (current: ${currentValue ? "enabled" : "disabled"})`,
        [currentValue ? "Disable debug logging" : "Enable debug logging"],
      );
      if (!choice) {
        continue;
      }

      const enabled = choice.startsWith("Enable");
      globalRaw.debug = enabled;

      try {
        deps.saveConfigFile(paths.globalPath, globalRaw);
        notify(
          ctx,
          "info",
          `Debug logging ${enabled ? "enabled" : "disabled"}. Logs will be written to ${path.join(ctx.cwd, ".pi", "human-loop-debug.log")}.`,
        );
      } catch (error) {
        notify(ctx, "error", `Failed to save config: ${String(error)}`);
      }
    }
  }
}
