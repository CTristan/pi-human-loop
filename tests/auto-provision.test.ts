/**
 * Tests for auto-provisioning and repo detection.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { autoProvisionStream } from "../src/auto-provision.js";
import { getConfigPaths, loadProjectConfig } from "../src/config.js";
import * as repo from "../src/repo.js";
import { detectRepoName, parseRepoNameFromRemote } from "../src/repo.js";
import type { ZulipClient } from "../src/zulip-client.js";

function setupTempDirs() {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-human-loop-"));
  const homeDir = path.join(baseDir, "home");
  const projectDir = path.join(baseDir, "project-repo");
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });
  const paths = getConfigPaths({ homeDir, cwd: projectDir });
  return { baseDir, homeDir, projectDir, paths };
}

describe("repo detection", () => {
  it("should parse repo name from HTTPS remote", () => {
    expect(
      parseRepoNameFromRemote("https://github.com/user/repo-name.git"),
    ).toBe("repo-name");
    expect(parseRepoNameFromRemote("https://github.com/user/repo-name")).toBe(
      "repo-name",
    );
  });

  it("should parse repo name from SSH remote", () => {
    expect(parseRepoNameFromRemote("git@github.com:user/repo.git")).toBe(
      "repo",
    );
  });

  it("should handle invalid URL formats", () => {
    expect(parseRepoNameFromRemote("https://github.com:user/repo.git")).toBe(
      "repo",
    );
    expect(parseRepoNameFromRemote("")).toBeNull();
    expect(parseRepoNameFromRemote("https://github.com/")).toBeNull();
  });

  it("should use repo name from git remote when available", () => {
    const { projectDir } = setupTempDirs();
    const repoName = detectRepoName({
      cwd: projectDir,
      getRemoteUrl: () => "https://github.com/user/remote-repo.git",
    });
    expect(repoName).toBe("remote-repo");
  });

  it("should fall back to directory name when remote is unparseable", () => {
    const { projectDir } = setupTempDirs();
    const repoName = detectRepoName({
      cwd: projectDir,
      getRemoteUrl: () => "https://github.com/",
    });
    expect(repoName).toBe("project-repo");
  });

  it("should fall back to directory name", () => {
    const { projectDir } = setupTempDirs();
    const repoName = detectRepoName({
      cwd: projectDir,
      getRemoteUrl: () => null,
    });
    expect(repoName).toBe("project-repo");
  });

  it("should use the default git remote lookup and fall back when unavailable", () => {
    const { projectDir } = setupTempDirs();
    const repoName = detectRepoName({ cwd: projectDir });
    expect(repoName).toBe("project-repo");
  });
});

describe("autoProvisionStream", () => {
  it("should create a stream and save project config", async () => {
    const { projectDir, paths } = setupTempDirs();
    const mockClient: Pick<ZulipClient, "createStream"> = {
      createStream: vi.fn().mockResolvedValue(undefined),
    };

    const config = {
      serverUrl: "https://zulip.example.com",
      botEmail: "bot@example.com",
      botApiKey: "test-key",
      pollIntervalMs: 5000,
      autoProvision: true,
      debug: false,
    };

    const streamName = await autoProvisionStream(
      config,
      mockClient as ZulipClient,
      { cwd: projectDir },
    );

    expect(streamName).toBe("project-repo");
    expect(mockClient.createStream).toHaveBeenCalledWith(
      "project-repo",
      undefined,
    );

    const projectConfig = loadProjectConfig(paths);
    expect(projectConfig.stream).toBe("project-repo");
  });

  it("should persist stream description when provided", async () => {
    const { projectDir, paths } = setupTempDirs();
    const mockClient: Pick<ZulipClient, "createStream"> = {
      createStream: vi.fn().mockResolvedValue(undefined),
    };

    const config = {
      serverUrl: "https://zulip.example.com",
      botEmail: "bot@example.com",
      botApiKey: "test-key",
      pollIntervalMs: 5000,
      autoProvision: true,
      streamDescription: "Auto-provisioned stream",
      debug: false,
    };

    await autoProvisionStream(config, mockClient as ZulipClient, {
      cwd: projectDir,
    });

    const projectConfig = loadProjectConfig(paths);
    expect(projectConfig.streamDescription).toBe("Auto-provisioned stream");
  });

  it("should throw when auto-provision is disabled", async () => {
    const { projectDir } = setupTempDirs();
    const mockClient: Pick<ZulipClient, "createStream"> = {
      createStream: vi.fn().mockResolvedValue(undefined),
    };

    const config = {
      serverUrl: "https://zulip.example.com",
      botEmail: "bot@example.com",
      botApiKey: "test-key",
      pollIntervalMs: 5000,
      autoProvision: false,
      debug: false,
    };

    await expect(
      autoProvisionStream(config, mockClient as ZulipClient, {
        cwd: projectDir,
      }),
    ).rejects.toThrow(/auto-provisioning is disabled/);
  });

  it("should surface errors from Zulip stream creation", async () => {
    const { projectDir } = setupTempDirs();
    const mockClient: Pick<ZulipClient, "createStream"> = {
      createStream: vi.fn().mockRejectedValue(new Error("Permission denied")),
    };

    const config = {
      serverUrl: "https://zulip.example.com",
      botEmail: "bot@example.com",
      botApiKey: "test-key",
      pollIntervalMs: 5000,
      autoProvision: true,
      debug: false,
    };

    await expect(
      autoProvisionStream(config, mockClient as ZulipClient, {
        cwd: projectDir,
      }),
    ).rejects.toThrow(/Permission denied/);
  });

  it("should throw when repo name cannot be detected", async () => {
    const { projectDir } = setupTempDirs();
    const mockClient: Pick<ZulipClient, "createStream"> = {
      createStream: vi.fn().mockResolvedValue(undefined),
    };

    const config = {
      serverUrl: "https://zulip.example.com",
      botEmail: "bot@example.com",
      botApiKey: "test-key",
      pollIntervalMs: 5000,
      autoProvision: true,
      debug: false,
    };

    const spy = vi.spyOn(repo, "detectRepoName").mockReturnValueOnce("");

    await expect(
      autoProvisionStream(config, mockClient as ZulipClient, {
        cwd: projectDir,
      }),
    ).rejects.toThrow(/Unable to determine/);

    spy.mockRestore();
  });
});
