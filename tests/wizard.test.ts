/**
 * Tests for configuration wizard.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
  getConfigPaths,
  loadConfig,
  loadGlobalConfig,
  loadProjectConfig,
  saveConfigFile,
} from "../src/config.js";
import { runWizard } from "../src/wizard.js";
import type { ZulipClient } from "../src/zulip-client.js";

function setupTempDirs() {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-human-loop-"));
  const homeDir = path.join(baseDir, "home");
  const projectDir = path.join(baseDir, "project");
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });
  const paths = getConfigPaths({ homeDir, cwd: projectDir });
  return { baseDir, homeDir, projectDir, paths };
}

function makeContext(overrides: Partial<ExtensionContext>): ExtensionContext {
  return {
    hasUI: true,
    cwd: "/tmp",
    ui: {
      select: vi.fn(),
      input: vi.fn(),
      confirm: vi.fn(),
      notify: vi.fn(),
    } as any,
    ...overrides,
  } as ExtensionContext;
}

describe("wizard", () => {
  it("should guard when UI is unavailable", async () => {
    const ui = {
      select: vi.fn(),
      input: vi.fn(),
      confirm: vi.fn(),
      notify: vi.fn(),
    } as any;

    const ctx = makeContext({ hasUI: false, ui, cwd: "/tmp" });

    await runWizard(ctx);

    expect(ui.notify).toHaveBeenCalledWith(
      "Human-loop configuration requires interactive mode.",
      "error",
    );
  });

  it("should continue when config files cannot be loaded", async () => {
    const { projectDir, paths } = setupTempDirs();

    const ui = {
      select: vi.fn().mockResolvedValueOnce("Done"),
      input: vi.fn(),
      confirm: vi.fn(),
      notify: vi.fn(),
    } as any;

    const ctx = makeContext({ hasUI: true, ui, cwd: projectDir });

    await expect(
      runWizard(ctx, {
        getConfigPaths: () => paths,
        loadGlobalConfig: () => {
          throw new Error("global parse failure");
        },
        loadProjectConfig: () => {
          throw new Error("project parse failure");
        },
        saveConfigFile,
      }),
    ).resolves.toBeUndefined();

    expect(ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Failed to load global configuration"),
      "warning",
    );
    expect(ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Failed to load project configuration"),
      "warning",
    );
  });

  it("should save credentials after validation", async () => {
    const { homeDir, projectDir, paths } = setupTempDirs();

    const ui = {
      select: vi
        .fn()
        .mockResolvedValueOnce("Configure bot credentials")
        .mockResolvedValueOnce("Done"),
      input: vi
        .fn()
        .mockResolvedValueOnce("https://zulip.example.com")
        .mockResolvedValueOnce("bot@example.com")
        .mockResolvedValueOnce("test-key"),
      confirm: vi.fn(),
      notify: vi.fn(),
    } as any;

    const validateCredentials = vi.fn().mockResolvedValue({
      email: "bot@example.com",
      full_name: "Bot",
      user_id: 1,
    });

    const ctx = makeContext({ hasUI: true, ui, cwd: projectDir });

    await runWizard(ctx, {
      getConfigPaths: () => paths,
      loadGlobalConfig: () => loadGlobalConfig(paths),
      loadProjectConfig: () => loadProjectConfig(paths),
      saveConfigFile,
      loadConfig: (options) =>
        loadConfig({ homeDir, cwd: options?.cwd ?? projectDir }),
      createZulipClient: () =>
        ({ validateCredentials }) as unknown as ZulipClient,
    });

    const globalConfig = loadGlobalConfig(paths);
    expect(globalConfig.serverUrl).toBe("https://zulip.example.com");
    expect(globalConfig.botEmail).toBe("bot@example.com");
    expect(globalConfig.botApiKey).toBe("test-key");
    expect(validateCredentials).toHaveBeenCalled();
  });

  it("should redact existing bot API key in prompts", async () => {
    const { homeDir, projectDir, paths } = setupTempDirs();

    saveConfigFile(paths.globalPath, {
      serverUrl: "https://zulip.example.com",
      botEmail: "bot@example.com",
      botApiKey: "super-secret-key",
    });

    const ui = {
      select: vi
        .fn()
        .mockResolvedValueOnce("Configure bot credentials")
        .mockResolvedValueOnce("Done"),
      input: vi
        .fn()
        .mockResolvedValueOnce("")
        .mockResolvedValueOnce("")
        .mockResolvedValueOnce(""),
      confirm: vi.fn(),
      notify: vi.fn(),
    } as any;

    const validateCredentials = vi.fn().mockResolvedValue({
      email: "bot@example.com",
      full_name: "Bot",
      user_id: 1,
    });

    const ctx = makeContext({ hasUI: true, ui, cwd: projectDir });

    await runWizard(ctx, {
      getConfigPaths: () => paths,
      loadGlobalConfig: () => loadGlobalConfig(paths),
      loadProjectConfig: () => loadProjectConfig(paths),
      saveConfigFile,
      loadConfig: (options) =>
        loadConfig({ homeDir, cwd: options?.cwd ?? projectDir }),
      createZulipClient: () =>
        ({ validateCredentials }) as unknown as ZulipClient,
    });

    const inputPrompts = ui.input.mock.calls.map(([title]: [string]) => title);
    const botApiKeyPrompt = inputPrompts.find((title: string) =>
      title.startsWith("Bot API key"),
    );

    expect(botApiKeyPrompt).toBeDefined();
    expect(botApiKeyPrompt).toContain("[redacted]");
    expect(botApiKeyPrompt).not.toContain("super-secret-key");
    expect(validateCredentials).toHaveBeenCalled();
  });

  it("should warn when credentials input is cancelled", async () => {
    const { projectDir, paths } = setupTempDirs();

    const ui = {
      select: vi
        .fn()
        .mockResolvedValueOnce("Configure bot credentials")
        .mockResolvedValueOnce("Done"),
      input: vi.fn().mockResolvedValueOnce(undefined),
      confirm: vi.fn(),
      notify: vi.fn(),
    } as any;

    const ctx = makeContext({ hasUI: true, ui, cwd: projectDir });

    await runWizard(ctx, {
      getConfigPaths: () => paths,
      loadGlobalConfig: () => loadGlobalConfig(paths),
      loadProjectConfig: () => loadProjectConfig(paths),
      saveConfigFile,
    });

    expect(ui.notify).toHaveBeenCalledWith(
      "Server URL is required.",
      "warning",
    );
  });

  it("should warn when bot email is missing", async () => {
    const { projectDir, paths } = setupTempDirs();

    const ui = {
      select: vi
        .fn()
        .mockResolvedValueOnce("Configure bot credentials")
        .mockResolvedValueOnce("Done"),
      input: vi
        .fn()
        .mockResolvedValueOnce("https://zulip.example.com")
        .mockResolvedValueOnce(""),
      confirm: vi.fn(),
      notify: vi.fn(),
    } as any;

    const ctx = makeContext({ hasUI: true, ui, cwd: projectDir });

    await runWizard(ctx, {
      getConfigPaths: () => paths,
      loadGlobalConfig: () => loadGlobalConfig(paths),
      loadProjectConfig: () => loadProjectConfig(paths),
      saveConfigFile,
    });

    expect(ui.notify).toHaveBeenCalledWith("Bot email is required.", "warning");
  });

  it("should save stream config and create stream", async () => {
    const { homeDir, projectDir, paths } = setupTempDirs();

    saveConfigFile(paths.globalPath, {
      serverUrl: "https://zulip.example.com",
      botEmail: "bot@example.com",
      botApiKey: "test-key",
    });

    const ui = {
      select: vi
        .fn()
        .mockResolvedValueOnce("Configure stream")
        .mockResolvedValueOnce(`Project (${paths.projectPath})`)
        .mockResolvedValueOnce("Done"),
      input: vi
        .fn()
        .mockResolvedValueOnce("my-stream")
        .mockResolvedValueOnce("my description"),
      confirm: vi.fn().mockResolvedValueOnce(true),
      notify: vi.fn(),
    } as any;

    const createStream = vi.fn().mockResolvedValue(undefined);

    const ctx = makeContext({ hasUI: true, ui, cwd: projectDir });

    await runWizard(ctx, {
      getConfigPaths: () => paths,
      loadGlobalConfig: () => loadGlobalConfig(paths),
      loadProjectConfig: () => loadProjectConfig(paths),
      saveConfigFile,
      loadConfig: (options) =>
        loadConfig({ homeDir, cwd: options?.cwd ?? projectDir }),
      createZulipClient: () => ({ createStream }) as unknown as ZulipClient,
    });

    expect(createStream).toHaveBeenCalledWith("my-stream", "my description");

    const projectConfig = loadProjectConfig(paths);
    expect(projectConfig.stream).toBe("my-stream");
    expect(projectConfig.streamDescription).toBe("my description");
  });

  it("should handle stream creation failures", async () => {
    const { homeDir, projectDir, paths } = setupTempDirs();

    saveConfigFile(paths.globalPath, {
      serverUrl: "https://zulip.example.com",
      botEmail: "bot@example.com",
      botApiKey: "test-key",
    });

    const ui = {
      select: vi
        .fn()
        .mockResolvedValueOnce("Configure stream")
        .mockResolvedValueOnce("Done"),
      input: vi
        .fn()
        .mockResolvedValueOnce("my-stream")
        .mockResolvedValueOnce("description"),
      confirm: vi.fn().mockResolvedValueOnce(true),
      notify: vi.fn(),
    } as any;

    const createStream = vi.fn().mockRejectedValue(new Error("No permission"));

    const ctx = makeContext({ hasUI: true, ui, cwd: projectDir });

    await runWizard(ctx, {
      getConfigPaths: () => paths,
      loadGlobalConfig: () => loadGlobalConfig(paths),
      loadProjectConfig: () => loadProjectConfig(paths),
      saveConfigFile,
      loadConfig: () => loadConfig({ homeDir, cwd: projectDir }),
      createZulipClient: () => ({ createStream }) as unknown as ZulipClient,
    });

    expect(ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Failed to create stream"),
      "error",
    );
  });

  it("should skip saving stream when selection is cancelled", async () => {
    const { projectDir, paths } = setupTempDirs();

    const ui = {
      select: vi
        .fn()
        .mockResolvedValueOnce("Configure stream")
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce("Done"),
      input: vi
        .fn()
        .mockResolvedValueOnce("global-stream")
        .mockResolvedValueOnce("description"),
      confirm: vi.fn().mockResolvedValueOnce(false),
      notify: vi.fn(),
    } as any;

    const ctx = makeContext({ hasUI: true, ui, cwd: projectDir });

    await runWizard(ctx, {
      getConfigPaths: () => paths,
      loadGlobalConfig: () => loadGlobalConfig(paths),
      loadProjectConfig: () => loadProjectConfig(paths),
      saveConfigFile,
    });

    const globalConfig = loadGlobalConfig(paths);
    expect(globalConfig.stream).toBeUndefined();
  });

  it("should save stream to global without description", async () => {
    const { projectDir, paths } = setupTempDirs();

    const ui = {
      select: vi
        .fn()
        .mockResolvedValueOnce("Configure stream")
        .mockResolvedValueOnce(`Global (${paths.globalPath})`)
        .mockResolvedValueOnce("Done"),
      input: vi
        .fn()
        .mockResolvedValueOnce("global-stream")
        .mockResolvedValueOnce(""),
      confirm: vi.fn().mockResolvedValueOnce(false),
      notify: vi.fn(),
    } as any;

    const ctx = makeContext({ hasUI: true, ui, cwd: projectDir });

    await runWizard(ctx, {
      getConfigPaths: () => paths,
      loadGlobalConfig: () => loadGlobalConfig(paths),
      loadProjectConfig: () => loadProjectConfig(paths),
      saveConfigFile,
    });

    const globalConfig = loadGlobalConfig(paths);
    expect(globalConfig.stream).toBe("global-stream");
    expect(globalConfig.streamDescription).toBeUndefined();
  });

  it("should enable auto-provisioning", async () => {
    const { projectDir, paths } = setupTempDirs();

    saveConfigFile(paths.globalPath, {
      autoProvision: false,
    });

    const ui = {
      select: vi
        .fn()
        .mockResolvedValueOnce("Configure auto-provision")
        .mockResolvedValueOnce("Enable auto-provision")
        .mockResolvedValueOnce("Done"),
      input: vi.fn(),
      confirm: vi.fn(),
      notify: vi.fn(),
    } as any;

    const ctx = makeContext({ hasUI: true, ui, cwd: projectDir });

    await runWizard(ctx, {
      getConfigPaths: () => paths,
      loadGlobalConfig: () => loadGlobalConfig(paths),
      loadProjectConfig: () => loadProjectConfig(paths),
      saveConfigFile,
    });

    const globalConfig = loadGlobalConfig(paths);
    expect(globalConfig.autoProvision).toBe(true);
  });

  it("should save poll interval to project config", async () => {
    const { homeDir, projectDir, paths } = setupTempDirs();

    const ui = {
      select: vi
        .fn()
        .mockResolvedValueOnce("Configure poll interval")
        .mockResolvedValueOnce(`Project (${paths.projectPath})`)
        .mockResolvedValueOnce("Done"),
      input: vi.fn().mockResolvedValueOnce("4200"),
      confirm: vi.fn(),
      notify: vi.fn(),
    } as any;

    const ctx = makeContext({ hasUI: true, ui, cwd: projectDir });

    await runWizard(ctx, {
      getConfigPaths: () => paths,
      loadGlobalConfig: () => loadGlobalConfig(paths),
      loadProjectConfig: () => loadProjectConfig(paths),
      saveConfigFile,
      loadConfig: (options) =>
        loadConfig({ homeDir, cwd: options?.cwd ?? projectDir }),
    });

    const projectConfig = loadProjectConfig(paths);
    expect(projectConfig.pollIntervalMs).toBe(4200);
  });

  it("should reject malformed poll interval input", async () => {
    const { projectDir, paths } = setupTempDirs();

    const ui = {
      select: vi
        .fn()
        .mockResolvedValueOnce("Configure poll interval")
        .mockResolvedValueOnce("Done"),
      input: vi.fn().mockResolvedValueOnce("5000ms"),
      confirm: vi.fn(),
      notify: vi.fn(),
    } as any;

    const ctx = makeContext({ hasUI: true, ui, cwd: projectDir });

    await runWizard(ctx, {
      getConfigPaths: () => paths,
      loadGlobalConfig: () => loadGlobalConfig(paths),
      loadProjectConfig: () => loadProjectConfig(paths),
      saveConfigFile,
    });

    expect(ui.notify).toHaveBeenCalledWith(
      "Poll interval must be a positive integer.",
      "error",
    );
  });

  it("should show debug toggle in wizard menu", async () => {
    const { projectDir, paths } = setupTempDirs();

    const ui = {
      select: vi.fn().mockResolvedValueOnce("Done"),
      input: vi.fn(),
      confirm: vi.fn(),
      notify: vi.fn(),
    } as any;

    const ctx = makeContext({ hasUI: true, ui, cwd: projectDir });

    await runWizard(ctx, {
      getConfigPaths: () => paths,
      loadGlobalConfig: () => loadGlobalConfig(paths),
      loadProjectConfig: () => loadProjectConfig(paths),
      saveConfigFile,
    });

    // Check that the debug option was presented in the menu
    const selectCalls = ui.select.mock.calls;
    const menuOptions = selectCalls[0]?.[1] as string[] | undefined;

    expect(menuOptions).toBeDefined();
    expect(
      menuOptions?.find((opt) => opt.startsWith("Configure debug logging")),
    ).toBeDefined();
  });

  it("should enable debug logging via wizard", async () => {
    const { projectDir, paths } = setupTempDirs();

    const ui = {
      select: vi
        .fn()
        .mockResolvedValueOnce("Configure debug logging")
        .mockResolvedValueOnce("Enable debug logging")
        .mockResolvedValueOnce("Done"),
      input: vi.fn(),
      confirm: vi.fn(),
      notify: vi.fn(),
    } as any;

    const ctx = makeContext({ hasUI: true, ui, cwd: projectDir });

    await runWizard(ctx, {
      getConfigPaths: () => paths,
      loadGlobalConfig: () => loadGlobalConfig(paths),
      loadProjectConfig: () => loadProjectConfig(paths),
      saveConfigFile,
    });

    // Check that debug was saved to global config
    const globalConfig = loadGlobalConfig(paths);
    expect(globalConfig.debug).toBe(true);

    expect(ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Debug logging enabled"),
      "info",
    );
  });

  it("should disable debug logging via wizard", async () => {
    const { projectDir, paths } = setupTempDirs();

    // Start with debug enabled
    saveConfigFile(paths.globalPath, {
      serverUrl: "https://zulip.example.com",
      botEmail: "bot@example.com",
      botApiKey: "test-key",
      debug: true,
    });

    const ui = {
      select: vi
        .fn()
        .mockResolvedValueOnce("Configure debug logging")
        .mockResolvedValueOnce("Disable debug logging")
        .mockResolvedValueOnce("Done"),
      input: vi.fn(),
      confirm: vi.fn(),
      notify: vi.fn(),
    } as any;

    const ctx = makeContext({ hasUI: true, ui, cwd: projectDir });

    await runWizard(ctx, {
      getConfigPaths: () => paths,
      loadGlobalConfig: () => loadGlobalConfig(paths),
      loadProjectConfig: () => loadProjectConfig(paths),
      saveConfigFile,
    });

    // Check that debug was saved to global config
    const globalConfig = loadGlobalConfig(paths);
    expect(globalConfig.debug).toBe(false);

    expect(ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Debug logging disabled"),
      "info",
    );
  });

  it("should show current debug state in menu", async () => {
    const { projectDir, paths } = setupTempDirs();

    // Start with debug enabled
    saveConfigFile(paths.globalPath, {
      serverUrl: "https://zulip.example.com",
      botEmail: "bot@example.com",
      botApiKey: "test-key",
      debug: true,
    });

    const ui = {
      select: vi.fn().mockResolvedValueOnce("Done"),
      input: vi.fn(),
      confirm: vi.fn(),
      notify: vi.fn(),
    } as any;

    const ctx = makeContext({ hasUI: true, ui, cwd: projectDir });

    await runWizard(ctx, {
      getConfigPaths: () => paths,
      loadGlobalConfig: () => loadGlobalConfig(paths),
      loadProjectConfig: () => loadProjectConfig(paths),
      saveConfigFile,
    });

    // Check that the debug option shows the current state
    const selectCalls = ui.select.mock.calls;
    const menuOptions = selectCalls[0]?.[1] as string[] | undefined;

    // Find the debug logging menu option
    const debugOption = menuOptions?.find((opt) =>
      opt.includes("Configure debug logging"),
    );
    expect(debugOption).toContain("enabled");
  });

  it("should default debug to disabled when not set", async () => {
    const { projectDir, paths } = setupTempDirs();

    // Config without debug field
    saveConfigFile(paths.globalPath, {
      serverUrl: "https://zulip.example.com",
      botEmail: "bot@example.com",
      botApiKey: "test-key",
    });

    const ui = {
      select: vi.fn().mockResolvedValueOnce("Done"),
      input: vi.fn(),
      confirm: vi.fn(),
      notify: vi.fn(),
    } as any;

    const ctx = makeContext({ hasUI: true, ui, cwd: projectDir });

    await runWizard(ctx, {
      getConfigPaths: () => paths,
      loadGlobalConfig: () => loadGlobalConfig(paths),
      loadProjectConfig: () => loadProjectConfig(paths),
      saveConfigFile,
    });

    // Find the debug logging menu option
    const selectCalls = ui.select.mock.calls;
    const menuOptions = selectCalls[0]?.[1] as string[] | undefined;
    const debugOption = menuOptions?.find((opt) =>
      opt.includes("Configure debug logging"),
    );

    expect(debugOption).toContain("disabled");
  });
});
