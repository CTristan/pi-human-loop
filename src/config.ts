/**
 * Configuration for the pi-human-loop extension.
 *
 * Supports three sources with merge priority:
 * project config > environment variables > global config.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface ZulipClientConfig {
  serverUrl: string;
  botEmail: string;
  botApiKey: string;
  pollIntervalMs: number;
  debug: boolean;
}

export interface Config extends ZulipClientConfig {
  stream: string;
  streamDescription?: string;
  streamSource: "default" | "global-config" | "project-config" | "env-var";
  autoProvision: boolean;
}

export interface ConfigError {
  type: "missing" | "invalid" | "invalid_url";
  var: string;
  message: string;
}

export interface ConfigPaths {
  globalPath: string;
  projectPath: string;
}

export type GlobalConfigRaw = Record<string, unknown>;
export type ProjectConfigRaw = Record<string, unknown>;

interface GlobalConfigValues {
  serverUrl?: string;
  botEmail?: string;
  botApiKey?: string;
  stream?: string;
  streamDescription?: string;
  autoProvision?: boolean;
  pollIntervalMs?: number;
  debug?: boolean;
}

interface ProjectConfigValues {
  stream?: string;
  streamDescription?: string;
  pollIntervalMs?: number;
  autoProvision?: boolean;
  debug?: boolean;
}

interface EnvConfigValues {
  serverUrl?: string;
  botEmail?: string;
  botApiKey?: string;
  stream?: string;
  pollIntervalMs?: number;
  debug?: boolean;
}

const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_AUTO_PROVISION = true;
const DEFAULT_STREAM = "pi-human-loop";

/**
 * Validates that a URL starts with http:// or https://
 */
function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function getConfigPaths(options?: {
  cwd?: string;
  homeDir?: string;
}): ConfigPaths {
  const cwd = options?.cwd ?? process.cwd();
  const homeDir = options?.homeDir ?? os.homedir();

  return {
    globalPath: path.join(homeDir, ".pi", "human-loop.json"),
    projectPath: path.join(cwd, ".pi", "human-loop.json"),
  };
}

function readConfigFile(filePath: string): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw new Error("Config file must contain a JSON object.");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return {};
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read config file ${filePath}: ${message}`);
  }
}

export function loadGlobalConfig(
  paths: ConfigPaths = getConfigPaths(),
): GlobalConfigRaw {
  return readConfigFile(paths.globalPath);
}

export function loadProjectConfig(
  paths: ConfigPaths = getConfigPaths(),
): ProjectConfigRaw {
  return readConfigFile(paths.projectPath);
}

export function saveConfigFile(
  filePath: string,
  data: Record<string, unknown>,
): void {
  const directoryPath = path.dirname(filePath);
  fs.mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(directoryPath, 0o700);
    } catch (error) {
      // Log non-permission errors for visibility; ignore EPERM/EACCES.
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "EPERM" && err.code !== "EACCES") {
        console.error(`Failed to set directory permissions: ${err.message}`);
      }
    }
  }

  const payload = `${JSON.stringify(data, null, 2)}\n`;
  fs.writeFileSync(filePath, payload, { encoding: "utf8", mode: 0o600 });
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(filePath, 0o600);
    } catch (error) {
      // Log non-permission errors for visibility; ignore EPERM/EACCES.
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "EPERM" && err.code !== "EACCES") {
        console.error(`Failed to set file permissions: ${err.message}`);
      }
    }
  }
}

function parseStringField(
  raw: Record<string, unknown>,
  key: string,
  errors: ConfigError[],
  label: string,
): string | undefined {
  const value = raw[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  errors.push({
    type: "invalid",
    var: label,
    message: `${key} must be a non-empty string`,
  });
  return undefined;
}

function parseBooleanField(
  raw: Record<string, unknown>,
  key: string,
  errors: ConfigError[],
  label: string,
): boolean | undefined {
  const value = raw[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  errors.push({
    type: "invalid",
    var: label,
    message: `${key} must be a boolean`,
  });
  return undefined;
}

const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;

function parsePositiveInteger(value: unknown): number | undefined {
  if (typeof value === "number") {
    if (Number.isSafeInteger(value) && value > 0) {
      return value;
    }
    return undefined;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!POSITIVE_INTEGER_PATTERN.test(trimmed)) {
      return undefined;
    }

    const parsed = Number(trimmed);
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return undefined;
}

function parseNumberField(
  raw: Record<string, unknown>,
  key: string,
  errors: ConfigError[],
  label: string,
): number | undefined {
  const value = raw[key];
  if (value === undefined) {
    return undefined;
  }

  const parsed = parsePositiveInteger(value);
  if (parsed === undefined) {
    errors.push({
      type: "invalid",
      var: label,
      message: `${key} must be a positive integer`,
    });
    return undefined;
  }

  return parsed;
}

function parseGlobalConfig(
  raw: GlobalConfigRaw,
  errors: ConfigError[],
): GlobalConfigValues {
  const parsed: GlobalConfigValues = {};

  const serverUrl = parseStringField(
    raw,
    "serverUrl",
    errors,
    "globalConfig.serverUrl",
  );
  if (serverUrl !== undefined) {
    parsed.serverUrl = serverUrl;
  }

  const botEmail = parseStringField(
    raw,
    "botEmail",
    errors,
    "globalConfig.botEmail",
  );
  if (botEmail !== undefined) {
    parsed.botEmail = botEmail;
  }

  const botApiKey = parseStringField(
    raw,
    "botApiKey",
    errors,
    "globalConfig.botApiKey",
  );
  if (botApiKey !== undefined) {
    parsed.botApiKey = botApiKey;
  }

  const stream = parseStringField(raw, "stream", errors, "globalConfig.stream");
  if (stream !== undefined) {
    parsed.stream = stream;
  }

  const streamDescription = parseStringField(
    raw,
    "streamDescription",
    errors,
    "globalConfig.streamDescription",
  );
  if (streamDescription !== undefined) {
    parsed.streamDescription = streamDescription;
  }

  const autoProvision = parseBooleanField(
    raw,
    "autoProvision",
    errors,
    "globalConfig.autoProvision",
  );
  if (autoProvision !== undefined) {
    parsed.autoProvision = autoProvision;
  }

  const pollIntervalMs = parseNumberField(
    raw,
    "pollIntervalMs",
    errors,
    "globalConfig.pollIntervalMs",
  );
  if (pollIntervalMs !== undefined) {
    parsed.pollIntervalMs = pollIntervalMs;
  }

  const debug = parseBooleanField(raw, "debug", errors, "globalConfig.debug");
  if (debug !== undefined) {
    parsed.debug = debug;
  }

  return parsed;
}

function parseProjectConfig(
  raw: ProjectConfigRaw,
  errors: ConfigError[],
): ProjectConfigValues {
  const parsed: ProjectConfigValues = {};

  const stream = parseStringField(
    raw,
    "stream",
    errors,
    "projectConfig.stream",
  );
  if (stream !== undefined) {
    parsed.stream = stream;
  }

  const streamDescription = parseStringField(
    raw,
    "streamDescription",
    errors,
    "projectConfig.streamDescription",
  );
  if (streamDescription !== undefined) {
    parsed.streamDescription = streamDescription;
  }

  const pollIntervalMs = parseNumberField(
    raw,
    "pollIntervalMs",
    errors,
    "projectConfig.pollIntervalMs",
  );
  if (pollIntervalMs !== undefined) {
    parsed.pollIntervalMs = pollIntervalMs;
  }

  const autoProvision = parseBooleanField(
    raw,
    "autoProvision",
    errors,
    "projectConfig.autoProvision",
  );
  if (autoProvision !== undefined) {
    parsed.autoProvision = autoProvision;
  }

  const debug = parseBooleanField(raw, "debug", errors, "projectConfig.debug");
  if (debug !== undefined) {
    parsed.debug = debug;
  }

  return parsed;
}

function loadEnvConfig(errors: ConfigError[]): EnvConfigValues {
  const env: EnvConfigValues = {};

  if (process.env.ZULIP_SERVER_URL) {
    const value = process.env.ZULIP_SERVER_URL.trim();
    if (value.length > 0) {
      env.serverUrl = value;
    }
  }

  if (process.env.ZULIP_BOT_EMAIL) {
    const value = process.env.ZULIP_BOT_EMAIL.trim();
    if (value.length > 0) {
      env.botEmail = value;
    }
  }

  if (process.env.ZULIP_BOT_API_KEY) {
    const value = process.env.ZULIP_BOT_API_KEY.trim();
    if (value.length > 0) {
      env.botApiKey = value;
    }
  }

  if (process.env.ZULIP_STREAM) {
    const value = process.env.ZULIP_STREAM.trim();
    if (value.length > 0) {
      env.stream = value;
    }
  }

  if (process.env.ZULIP_POLL_INTERVAL_MS) {
    const parsed = parsePositiveInteger(process.env.ZULIP_POLL_INTERVAL_MS);
    if (parsed === undefined) {
      errors.push({
        type: "invalid",
        var: "ZULIP_POLL_INTERVAL_MS",
        message: "ZULIP_POLL_INTERVAL_MS must be a positive integer",
      });
    } else {
      env.pollIntervalMs = parsed;
    }
  }

  const rawDebug = process.env.ZULIP_DEBUG;
  if (rawDebug !== undefined) {
    const trimmed = rawDebug.trim();
    if (trimmed.length > 0) {
      // Truthy string check: "true", "1", "yes" are true; anything else is false
      const value = trimmed.toLowerCase();
      env.debug = value === "true" || value === "1" || value === "yes";
    }
  }

  return env;
}

function hasInvalidFieldError(errors: ConfigError[], key: string): boolean {
  const fieldSuffix = `.${key}`;
  return errors.some(
    (error) =>
      error.type === "invalid" &&
      (error.var === key || error.var.endsWith(fieldSuffix)),
  );
}

/**
 * Loads and validates configuration from global config, env vars, and project config.
 *
 * @throws {Error} If validation fails, with a descriptive message
 */
export function loadConfig(options?: {
  cwd?: string;
  homeDir?: string;
}): Config {
  const errors: ConfigError[] = [];
  const paths = getConfigPaths(options);

  const globalRaw = loadGlobalConfig(paths);
  const projectRaw = loadProjectConfig(paths);
  const globalConfig = parseGlobalConfig(globalRaw, errors);
  const projectConfig = parseProjectConfig(projectRaw, errors);
  const envConfig = loadEnvConfig(errors);

  const merged = {
    ...globalConfig,
    ...envConfig,
    ...projectConfig,
  };

  const serverUrl = merged.serverUrl;
  const botEmail = merged.botEmail;
  const botApiKey = merged.botApiKey;
  const stream = merged.stream ?? DEFAULT_STREAM;
  const autoProvision = merged.autoProvision ?? DEFAULT_AUTO_PROVISION;
  const pollIntervalMs = merged.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const debug = merged.debug ?? false;

  // Select streamDescription from the same source that provided stream
  let streamDescription: string | undefined;
  if (projectConfig.stream !== undefined) {
    streamDescription = projectConfig.streamDescription;
  } else if (envConfig.stream !== undefined) {
    streamDescription = undefined; // Env vars don't support streamDescription
  } else if (globalConfig.stream !== undefined) {
    streamDescription = globalConfig.streamDescription;
  } else {
    // No explicit stream configured; we're using DEFAULT_STREAM.
    // Ignore any inherited streamDescription to avoid mismatching it to the default stream.
    streamDescription = undefined;
  }

  // Determine the source of the stream value for logging
  let streamSource: Config["streamSource"] = "default";
  if (projectConfig.stream !== undefined) {
    streamSource = "project-config";
  } else if (envConfig.stream !== undefined) {
    streamSource = "env-var";
  } else if (globalConfig.stream !== undefined) {
    streamSource = "global-config";
  }

  if (!serverUrl) {
    if (!hasInvalidFieldError(errors, "serverUrl")) {
      errors.push({
        type: "missing",
        var: "serverUrl",
        message:
          "Zulip server URL is required (set in config files or ZULIP_SERVER_URL)",
      });
    }
  } else if (!isValidUrl(serverUrl)) {
    errors.push({
      type: "invalid_url",
      var: "serverUrl",
      message:
        "serverUrl must be a valid URL starting with http:// or https://",
    });
  }

  if (!botEmail && !hasInvalidFieldError(errors, "botEmail")) {
    errors.push({
      type: "missing",
      var: "botEmail",
      message: "Bot email is required (set in config files or ZULIP_BOT_EMAIL)",
    });
  }

  if (!botApiKey && !hasInvalidFieldError(errors, "botApiKey")) {
    errors.push({
      type: "missing",
      var: "botApiKey",
      message:
        "Bot API key is required (set in config files or ZULIP_BOT_API_KEY)",
    });
  }

  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    errors.push({
      type: "invalid",
      var: "pollIntervalMs",
      message: "pollIntervalMs must be a positive integer",
    });
  }

  if (errors.length > 0) {
    const message = errors.map((e) => `  ${e.var}: ${e.message}`).join("\n");
    const error = new Error(
      `Configuration validation failed:\n${message}\n\nConfigure via /human-loop-config or set config files / environment variables.`,
    ) as Error & { configErrors: ConfigError[] };
    error.configErrors = errors;
    throw error;
  }

  const config: Config = {
    serverUrl: serverUrl!,
    botEmail: botEmail!,
    botApiKey: botApiKey!,
    stream,
    pollIntervalMs,
    autoProvision,
    debug,
    streamSource,
  };

  if (streamDescription !== undefined) {
    config.streamDescription = streamDescription;
  }

  return config;
}

export const CONFIG_DEFAULTS = {
  stream: DEFAULT_STREAM,
  pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
  autoProvision: DEFAULT_AUTO_PROVISION,
};
