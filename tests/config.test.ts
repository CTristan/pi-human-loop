/**
 * Tests for configuration loading and validation.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  CONFIG_DEFAULTS,
  getConfigPaths,
  loadConfig,
  loadGlobalConfig,
  saveConfigFile,
} from "../src/config.js";

describe("config", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("ZULIP_")) {
        delete process.env[key as keyof typeof process.env];
      }
    }
  });

  afterAll(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key as keyof typeof process.env];
      }
    }

    for (const [key, value] of Object.entries(originalEnv)) {
      process.env[key] = value;
    }
  });

  function setupTempDirs() {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-human-loop-"));
    const homeDir = path.join(baseDir, "home");
    const projectDir = path.join(baseDir, "project");
    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });
    const paths = getConfigPaths({ homeDir, cwd: projectDir });
    return { baseDir, homeDir, projectDir, paths };
  }

  it("should merge project > env > global", () => {
    const { paths, homeDir, projectDir } = setupTempDirs();

    saveConfigFile(paths.globalPath, {
      serverUrl: "https://global.example.com",
      botEmail: "global@example.com",
      botApiKey: "global-key",
      stream: "global-stream",
      pollIntervalMs: 9000,
      autoProvision: false,
    });

    saveConfigFile(paths.projectPath, {
      stream: "project-stream",
      pollIntervalMs: 3000,
    });

    process.env.ZULIP_SERVER_URL = "https://env.example.com";
    process.env.ZULIP_STREAM = "env-stream";

    const config = loadConfig({ homeDir, cwd: projectDir });

    expect(config.serverUrl).toBe("https://env.example.com");
    expect(config.botEmail).toBe("global@example.com");
    expect(config.botApiKey).toBe("global-key");
    expect(config.stream).toBe("project-stream");
    expect(config.pollIntervalMs).toBe(3000);
    expect(config.autoProvision).toBe(false);
  });

  it("should allow env-only configuration", () => {
    const { homeDir, projectDir } = setupTempDirs();

    process.env.ZULIP_SERVER_URL = "https://zulip.example.com";
    process.env.ZULIP_BOT_EMAIL = "bot@example.com";
    process.env.ZULIP_BOT_API_KEY = "test-api-key";
    process.env.ZULIP_STREAM = "env-stream";

    const config = loadConfig({ homeDir, cwd: projectDir });

    expect(config.serverUrl).toBe("https://zulip.example.com");
    expect(config.botEmail).toBe("bot@example.com");
    expect(config.botApiKey).toBe("test-api-key");
    expect(config.stream).toBe("env-stream");
    expect(config.pollIntervalMs).toBe(CONFIG_DEFAULTS.pollIntervalMs);
  });

  it("should combine partial configs across sources", () => {
    const { paths, homeDir, projectDir } = setupTempDirs();

    saveConfigFile(paths.globalPath, {
      serverUrl: "https://zulip.example.com",
      botEmail: "bot@example.com",
    });

    saveConfigFile(paths.projectPath, {
      stream: "project-stream",
    });

    process.env.ZULIP_BOT_API_KEY = "env-key";

    const config = loadConfig({ homeDir, cwd: projectDir });

    expect(config.serverUrl).toBe("https://zulip.example.com");
    expect(config.botEmail).toBe("bot@example.com");
    expect(config.botApiKey).toBe("env-key");
    expect(config.stream).toBe("project-stream");
    expect(config.autoProvision).toBe(true);
  });

  it("should save and load config files", () => {
    const { paths } = setupTempDirs();

    const payload = {
      serverUrl: "https://zulip.example.com",
      botEmail: "bot@example.com",
      botApiKey: "test-key",
      autoProvision: true,
      pollIntervalMs: 7000,
    };

    saveConfigFile(paths.globalPath, payload);

    const loaded = loadGlobalConfig(paths);
    expect(loaded).toEqual(payload);
  });

  it("should save config files with restrictive permissions", () => {
    if (process.platform === "win32") {
      return;
    }

    const { paths } = setupTempDirs();

    saveConfigFile(paths.globalPath, {
      serverUrl: "https://zulip.example.com",
      botEmail: "bot@example.com",
      botApiKey: "test-key",
    });

    const directoryMode =
      fs.statSync(path.dirname(paths.globalPath)).mode & 0o777;
    const fileMode = fs.statSync(paths.globalPath).mode & 0o777;

    expect(directoryMode).toBe(0o700);
    expect(fileMode).toBe(0o600);
  });

  it("should throw when required fields are missing", () => {
    const { homeDir, projectDir } = setupTempDirs();

    expect(() => loadConfig({ homeDir, cwd: projectDir })).toThrow(
      /Configuration validation failed/,
    );
  });

  it("should throw on invalid server URL", () => {
    const { paths, homeDir, projectDir } = setupTempDirs();

    saveConfigFile(paths.globalPath, {
      serverUrl: "not-a-url",
      botEmail: "bot@example.com",
      botApiKey: "test-key",
    });

    expect(() => loadConfig({ homeDir, cwd: projectDir })).toThrow(
      /serverUrl must be a valid URL/,
    );
  });

  it("should throw on invalid poll interval from env", () => {
    const { paths, homeDir, projectDir } = setupTempDirs();

    saveConfigFile(paths.globalPath, {
      serverUrl: "https://zulip.example.com",
      botEmail: "bot@example.com",
      botApiKey: "test-key",
    });

    process.env.ZULIP_POLL_INTERVAL_MS = "not-a-number";

    expect(() => loadConfig({ homeDir, cwd: projectDir })).toThrow(
      /ZULIP_POLL_INTERVAL_MS/,
    );
  });

  it("should reject malformed poll interval values from env", () => {
    const { paths, homeDir, projectDir } = setupTempDirs();

    saveConfigFile(paths.globalPath, {
      serverUrl: "https://zulip.example.com",
      botEmail: "bot@example.com",
      botApiKey: "test-key",
    });

    process.env.ZULIP_POLL_INTERVAL_MS = "5000ms";

    expect(() => loadConfig({ homeDir, cwd: projectDir })).toThrow(
      /ZULIP_POLL_INTERVAL_MS/,
    );
  });

  it("should throw on invalid poll interval in project config", () => {
    const { paths, homeDir, projectDir } = setupTempDirs();

    saveConfigFile(paths.globalPath, {
      serverUrl: "https://zulip.example.com",
      botEmail: "bot@example.com",
      botApiKey: "test-key",
    });

    saveConfigFile(paths.projectPath, {
      pollIntervalMs: "nope",
    });

    expect(() => loadConfig({ homeDir, cwd: projectDir })).toThrow(
      /projectConfig.pollIntervalMs/,
    );
  });

  it("should reject malformed poll interval strings in config files", () => {
    const { paths, homeDir, projectDir } = setupTempDirs();

    saveConfigFile(paths.globalPath, {
      serverUrl: "https://zulip.example.com",
      botEmail: "bot@example.com",
      botApiKey: "test-key",
    });

    saveConfigFile(paths.projectPath, {
      pollIntervalMs: "42abc",
    });

    expect(() => loadConfig({ homeDir, cwd: projectDir })).toThrow(
      /projectConfig.pollIntervalMs/,
    );
  });

  it("should throw on invalid config field types", () => {
    const { paths, homeDir, projectDir } = setupTempDirs();

    saveConfigFile(paths.globalPath, {
      serverUrl: "https://zulip.example.com",
      botEmail: 123,
      botApiKey: "test-key",
    });

    expect(() => loadConfig({ homeDir, cwd: projectDir })).toThrow(
      /globalConfig.botEmail/,
    );
  });

  it("should parse debug field from global config", () => {
    const { paths, homeDir, projectDir } = setupTempDirs();

    saveConfigFile(paths.globalPath, {
      serverUrl: "https://zulip.example.com",
      botEmail: "bot@example.com",
      botApiKey: "test-key",
      debug: true,
    });

    const config = loadConfig({ homeDir, cwd: projectDir });

    expect(config.debug).toBe(true);
  });

  it("should parse debug field from project config", () => {
    const { paths, homeDir, projectDir } = setupTempDirs();

    saveConfigFile(paths.globalPath, {
      serverUrl: "https://zulip.example.com",
      botEmail: "bot@example.com",
      botApiKey: "test-key",
      debug: false,
    });

    saveConfigFile(paths.projectPath, {
      debug: true,
    });

    const config = loadConfig({ homeDir, cwd: projectDir });

    expect(config.debug).toBe(true);
  });

  it("should parse debug field from env var ZULIP_DEBUG=true", () => {
    const { paths, homeDir, projectDir } = setupTempDirs();

    saveConfigFile(paths.globalPath, {
      serverUrl: "https://zulip.example.com",
      botEmail: "bot@example.com",
      botApiKey: "test-key",
    });

    process.env.ZULIP_DEBUG = "true";

    const config = loadConfig({ homeDir, cwd: projectDir });

    expect(config.debug).toBe(true);
  });

  it("should parse debug field from env var ZULIP_DEBUG=1", () => {
    const { paths, homeDir, projectDir } = setupTempDirs();

    saveConfigFile(paths.globalPath, {
      serverUrl: "https://zulip.example.com",
      botEmail: "bot@example.com",
      botApiKey: "test-key",
    });

    process.env.ZULIP_DEBUG = "1";

    const config = loadConfig({ homeDir, cwd: projectDir });

    expect(config.debug).toBe(true);
  });

  it("should parse debug field from env var ZULIP_DEBUG=yes", () => {
    const { paths, homeDir, projectDir } = setupTempDirs();

    saveConfigFile(paths.globalPath, {
      serverUrl: "https://zulip.example.com",
      botEmail: "bot@example.com",
      botApiKey: "test-key",
    });

    process.env.ZULIP_DEBUG = "yes";

    const config = loadConfig({ homeDir, cwd: projectDir });

    expect(config.debug).toBe(true);
  });

  it("should treat truthy env var values other than true/1/yes as false", () => {
    const { paths, homeDir, projectDir } = setupTempDirs();

    saveConfigFile(paths.globalPath, {
      serverUrl: "https://zulip.example.com",
      botEmail: "bot@example.com",
      botApiKey: "test-key",
    });

    process.env.ZULIP_DEBUG = "enabled";

    const config = loadConfig({ homeDir, cwd: projectDir });

    expect(config.debug).toBe(false);
  });

  it("should default debug to false when not specified", () => {
    const { paths, homeDir, projectDir } = setupTempDirs();

    saveConfigFile(paths.globalPath, {
      serverUrl: "https://zulip.example.com",
      botEmail: "bot@example.com",
      botApiKey: "test-key",
    });

    const config = loadConfig({ homeDir, cwd: projectDir });

    expect(config.debug).toBe(false);
  });

  it("should merge debug with project > env > global precedence", () => {
    const { paths, homeDir, projectDir } = setupTempDirs();

    saveConfigFile(paths.globalPath, {
      serverUrl: "https://zulip.example.com",
      botEmail: "bot@example.com",
      botApiKey: "test-key",
      debug: false,
    });

    saveConfigFile(paths.projectPath, {
      debug: true,
    });

    process.env.ZULIP_DEBUG = "false";

    const config = loadConfig({ homeDir, cwd: projectDir });

    expect(config.debug).toBe(true);
  });

  it("should merge debug with env > global precedence when no project config", () => {
    const { paths, homeDir, projectDir } = setupTempDirs();

    saveConfigFile(paths.globalPath, {
      serverUrl: "https://zulip.example.com",
      botEmail: "bot@example.com",
      botApiKey: "test-key",
      debug: false,
    });

    process.env.ZULIP_DEBUG = "true";

    const config = loadConfig({ homeDir, cwd: projectDir });

    expect(config.debug).toBe(true);
  });

  it("should handle boolean debug field in config files", () => {
    const { paths, homeDir, projectDir } = setupTempDirs();

    saveConfigFile(paths.globalPath, {
      serverUrl: "https://zulip.example.com",
      botEmail: "bot@example.com",
      botApiKey: "test-key",
    });

    saveConfigFile(paths.projectPath, {
      debug: true,
    });

    const config = loadConfig({ homeDir, cwd: projectDir });

    expect(config.debug).toBe(true);
  });
});
