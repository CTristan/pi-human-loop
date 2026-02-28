/**
 * Tests for configuration loading and validation.
 */

import { loadConfig } from "../src/config.js";

describe("config", () => {
  // Store original env vars
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset to original env before each test
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("ZULIP_")) {
        delete process.env[key as keyof typeof process.env];
      }
    }
    // Restore original ZULIP_* vars if they existed
    for (const key of Object.keys(originalEnv)) {
      if (key.startsWith("ZULIP_")) {
        process.env[key as keyof typeof process.env] = originalEnv[
          key as keyof typeof originalEnv
        ] as string | undefined;
      }
    }
  });

  it("should load valid config with all required vars", () => {
    process.env.ZULIP_SERVER_URL = "https://zulip.example.com";
    process.env.ZULIP_BOT_EMAIL = "bot@example.com";
    process.env.ZULIP_BOT_API_KEY = "test-api-key";
    process.env.ZULIP_STREAM = "test-stream";

    const config = loadConfig();
    expect(config.serverUrl).toBe("https://zulip.example.com");
    expect(config.botEmail).toBe("bot@example.com");
    expect(config.botApiKey).toBe("test-api-key");
    expect(config.stream).toBe("test-stream");
    expect(config.pollIntervalMs).toBe(5000);
  });

  it("should load valid config with custom poll interval", () => {
    process.env.ZULIP_SERVER_URL = "https://zulip.example.com";
    process.env.ZULIP_BOT_EMAIL = "bot@example.com";
    process.env.ZULIP_BOT_API_KEY = "test-api-key";
    process.env.ZULIP_STREAM = "test-stream";
    process.env.ZULIP_POLL_INTERVAL_MS = "10000";

    const config = loadConfig();
    expect(config.pollIntervalMs).toBe(10000);
  });

  it("should load valid config with http URL", () => {
    process.env.ZULIP_SERVER_URL = "http://zulip.example.com";
    process.env.ZULIP_BOT_EMAIL = "bot@example.com";
    process.env.ZULIP_BOT_API_KEY = "test-api-key";
    process.env.ZULIP_STREAM = "test-stream";

    const config = loadConfig();
    expect(config.serverUrl).toBe("http://zulip.example.com");
  });

  it("should throw error when ZULIP_SERVER_URL is missing", () => {
    process.env.ZULIP_BOT_EMAIL = "bot@example.com";
    process.env.ZULIP_BOT_API_KEY = "test-api-key";
    process.env.ZULIP_STREAM = "test-stream";

    expect(() => loadConfig()).toThrow(/Configuration validation failed/);
    expect(() => loadConfig()).toThrow(/ZULIP_SERVER_URL/);

    try {
      loadConfig();
    } catch (e) {
      const err = e as Error & { configErrors?: unknown[] };
      expect(err.configErrors).toBeDefined();
      expect(err.configErrors).toHaveLength(1);
      if (err.configErrors) {
        expect(err.configErrors[0]).toMatchObject({
          type: "missing",
          var: "ZULIP_SERVER_URL",
        });
      }
    }
  });

  it("should throw error when ZULIP_BOT_EMAIL is missing", () => {
    process.env.ZULIP_SERVER_URL = "https://zulip.example.com";
    process.env.ZULIP_BOT_API_KEY = "test-api-key";
    process.env.ZULIP_STREAM = "test-stream";

    expect(() => loadConfig()).toThrow(/Configuration validation failed/);
    expect(() => loadConfig()).toThrow(/ZULIP_BOT_EMAIL/);
  });

  it("should throw error when ZULIP_BOT_API_KEY is missing", () => {
    process.env.ZULIP_SERVER_URL = "https://zulip.example.com";
    process.env.ZULIP_BOT_EMAIL = "bot@example.com";
    process.env.ZULIP_STREAM = "test-stream";

    expect(() => loadConfig()).toThrow(/Configuration validation failed/);
    expect(() => loadConfig()).toThrow(/ZULIP_BOT_API_KEY/);
  });

  it("should throw error when ZULIP_STREAM is missing", () => {
    process.env.ZULIP_SERVER_URL = "https://zulip.example.com";
    process.env.ZULIP_BOT_EMAIL = "bot@example.com";
    process.env.ZULIP_BOT_API_KEY = "test-api-key";

    expect(() => loadConfig()).toThrow(/Configuration validation failed/);
    expect(() => loadConfig()).toThrow(/ZULIP_STREAM/);
  });

  it("should throw error when multiple required vars are missing", () => {
    process.env.ZULIP_SERVER_URL = "https://zulip.example.com";

    expect(() => loadConfig()).toThrow(/Configuration validation failed/);

    try {
      loadConfig();
    } catch (e) {
      const err = e as Error & { configErrors?: unknown[] };
      expect(err.configErrors).toHaveLength(3);
    }
  });

  it("should throw error when ZULIP_SERVER_URL is invalid", () => {
    process.env.ZULIP_SERVER_URL = "not-a-valid-url";
    process.env.ZULIP_BOT_EMAIL = "bot@example.com";
    process.env.ZULIP_BOT_API_KEY = "test-api-key";
    process.env.ZULIP_STREAM = "test-stream";

    expect(() => loadConfig()).toThrow(/must be a valid URL/);
  });

  it("should throw error when ZULIP_SERVER_URL is ftp protocol", () => {
    process.env.ZULIP_SERVER_URL = "ftp://zulip.example.com";
    process.env.ZULIP_BOT_EMAIL = "bot@example.com";
    process.env.ZULIP_BOT_API_KEY = "test-api-key";
    process.env.ZULIP_STREAM = "test-stream";

    expect(() => loadConfig()).toThrow(/must be a valid URL/);
  });

  it("should throw error when ZULIP_POLL_INTERVAL_MS is not a number", () => {
    process.env.ZULIP_SERVER_URL = "https://zulip.example.com";
    process.env.ZULIP_BOT_EMAIL = "bot@example.com";
    process.env.ZULIP_BOT_API_KEY = "test-api-key";
    process.env.ZULIP_STREAM = "test-stream";
    process.env.ZULIP_POLL_INTERVAL_MS = "not-a-number";

    expect(() => loadConfig()).toThrow(/must be a positive integer/);
  });

  it("should throw error when ZULIP_POLL_INTERVAL_MS is negative", () => {
    process.env.ZULIP_SERVER_URL = "https://zulip.example.com";
    process.env.ZULIP_BOT_EMAIL = "bot@example.com";
    process.env.ZULIP_BOT_API_KEY = "test-api-key";
    process.env.ZULIP_STREAM = "test-stream";
    process.env.ZULIP_POLL_INTERVAL_MS = "-100";

    expect(() => loadConfig()).toThrow(/must be a positive integer/);
  });

  it("should throw error when ZULIP_POLL_INTERVAL_MS is zero", () => {
    process.env.ZULIP_SERVER_URL = "https://zulip.example.com";
    process.env.ZULIP_BOT_EMAIL = "bot@example.com";
    process.env.ZULIP_BOT_API_KEY = "test-api-key";
    process.env.ZULIP_STREAM = "test-stream";
    process.env.ZULIP_POLL_INTERVAL_MS = "0";

    expect(() => loadConfig()).toThrow(/must be a positive integer/);
  });

  it("should accept ZULIP_POLL_INTERVAL_MS as decimal string", () => {
    process.env.ZULIP_SERVER_URL = "https://zulip.example.com";
    process.env.ZULIP_BOT_EMAIL = "bot@example.com";
    process.env.ZULIP_BOT_API_KEY = "test-api-key";
    process.env.ZULIP_STREAM = "test-stream";
    process.env.ZULIP_POLL_INTERVAL_MS = "123";

    const config = loadConfig();
    expect(config.pollIntervalMs).toBe(123);
  });

  it("should use default poll interval if not provided", () => {
    process.env.ZULIP_SERVER_URL = "https://zulip.example.com";
    process.env.ZULIP_BOT_EMAIL = "bot@example.com";
    process.env.ZULIP_BOT_API_KEY = "test-api-key";
    process.env.ZULIP_STREAM = "test-stream";

    const config = loadConfig();
    expect(config.pollIntervalMs).toBe(5000);
  });

  it("should handle URL with trailing slash", () => {
    process.env.ZULIP_SERVER_URL = "https://zulip.example.com/";
    process.env.ZULIP_BOT_EMAIL = "bot@example.com";
    process.env.ZULIP_BOT_API_KEY = "test-api-key";
    process.env.ZULIP_STREAM = "test-stream";

    const config = loadConfig();
    expect(config.serverUrl).toBe("https://zulip.example.com/");
  });
});
