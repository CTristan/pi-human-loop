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

/**
 * Loads and validates configuration from environment variables.
 */
export function loadConfig(): Config {
  // TODO: Implement config loading and validation
  throw new Error("Not implemented yet");
}
