/**
 * Configuration for the pi-human-loop extension.
 *
 * Reads environment variables and validates them.
 */

export interface Config {
  serverUrl: string;
  botEmail: string;
  botApiKey: string;
  stream: string;
  pollIntervalMs: number;
}

export interface ConfigError {
  type: "missing" | "invalid" | "invalid_url";
  var: string;
  message: string;
}

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

/**
 * Loads and validates configuration from environment variables.
 *
 * @throws {Error} If validation fails, with a descriptive message
 */
export function loadConfig(): Config {
  const errors: ConfigError[] = [];

  // Read required environment variables
  const serverUrl = process.env.ZULIP_SERVER_URL;
  const botEmail = process.env.ZULIP_BOT_EMAIL;
  const botApiKey = process.env.ZULIP_BOT_API_KEY;
  const stream = process.env.ZULIP_STREAM;

  // Validate required variables
  if (!serverUrl) {
    errors.push({
      type: "missing",
      var: "ZULIP_SERVER_URL",
      message: "Zulip server URL is required",
    });
  } else if (!isValidUrl(serverUrl)) {
    errors.push({
      type: "invalid_url",
      var: "ZULIP_SERVER_URL",
      message:
        "ZULIP_SERVER_URL must be a valid URL starting with http:// or https://",
    });
  }

  if (!botEmail) {
    errors.push({
      type: "missing",
      var: "ZULIP_BOT_EMAIL",
      message: "Bot email address is required",
    });
  }

  if (!botApiKey) {
    errors.push({
      type: "missing",
      var: "ZULIP_BOT_API_KEY",
      message: "Bot API key is required",
    });
  }

  if (!stream) {
    errors.push({
      type: "missing",
      var: "ZULIP_STREAM",
      message: "Stream name is required",
    });
  }

  if (errors.length > 0) {
    const message = errors.map((e) => `  ${e.var}: ${e.message}`).join("\n");
    const error = new Error(
      `Configuration validation failed:\n${message}\n\nPlease set the required environment variables.`,
    ) as Error & { configErrors: ConfigError[] };
    error.configErrors = errors;
    throw error;
  }

  // Parse optional poll interval
  let pollIntervalMs = 5000; // Default 5 seconds
  const pollIntervalStr = process.env.ZULIP_POLL_INTERVAL_MS;
  if (pollIntervalStr) {
    const parsed = Number.parseInt(pollIntervalStr, 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
      errors.push({
        type: "invalid",
        var: "ZULIP_POLL_INTERVAL_MS",
        message: "ZULIP_POLL_INTERVAL_MS must be a positive integer",
      });
    } else {
      pollIntervalMs = parsed;
    }
  }

  // Check for poll interval errors
  if (errors.length > 0) {
    const message = errors.map((e) => `  ${e.var}: ${e.message}`).join("\n");
    const error = new Error(
      `Configuration validation failed:\n${message}\n\nPlease fix the above configuration errors.`,
    ) as Error & { configErrors: ConfigError[] };
    error.configErrors = errors;
    throw error;
  }

  return {
    serverUrl: serverUrl!,
    botEmail: botEmail!,
    botApiKey: botApiKey!,
    stream: stream!,
    pollIntervalMs,
  };
}
