/**
 * Tests for auto-provisioning and repo detection.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { autoProvisionStream } from "../src/auto-provision.js";
import { detectRepoName, parseRepoNameFromRemote } from "../src/repo.js";
import type { ZulipClient } from "../src/zulip-client.js";

const tempBaseDirs: string[] = [];

function setupTempDirs() {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-human-loop-"));
  const homeDir = path.join(baseDir, "home");
  const projectDir = path.join(baseDir, "project-repo");
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });
  tempBaseDirs.push(baseDir);
  return { baseDir, homeDir, projectDir };
}

afterEach(() => {
  for (const baseDir of tempBaseDirs.splice(0, tempBaseDirs.length)) {
    try {
      fs.rmSync(baseDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors in tests
    }
  }
});

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
  it("should create a stream", async () => {
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
      stream: "pi-human-loop",
      streamSource: "default" as const,
    };

    const result = await autoProvisionStream(config, mockClient as ZulipClient);

    expect(result).toBeUndefined();
    expect(mockClient.createStream).toHaveBeenCalledWith(
      "pi-human-loop",
      undefined,
    );
  });

  it("should pass stream description when provided", async () => {
    const mockClient: Pick<ZulipClient, "createStream"> = {
      createStream: vi.fn().mockResolvedValue(undefined),
    };

    const config = {
      serverUrl: "https://zulip.example.com",
      botEmail: "bot@example.com",
      botApiKey: "test-key",
      pollIntervalMs: 5000,
      autoProvision: true,
      streamDescription: "Stream for agent questions",
      debug: false,
      stream: "my-stream",
      streamSource: "project-config" as const,
    };

    await autoProvisionStream(config, mockClient as ZulipClient);

    expect(mockClient.createStream).toHaveBeenCalledWith(
      "my-stream",
      "Stream for agent questions",
    );
  });

  it("should throw when auto-provision is disabled", async () => {
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
      stream: "my-stream",
      streamSource: "global-config" as const,
    };

    await expect(
      autoProvisionStream(config, mockClient as ZulipClient),
    ).rejects.toThrow(/auto-provisioning is disabled/);
  });

  it("should surface errors from Zulip stream creation", async () => {
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
      stream: "my-stream",
      streamSource: "default" as const,
    };

    await expect(
      autoProvisionStream(config, mockClient as ZulipClient),
    ).rejects.toThrow(/Permission denied/);
  });

  it("should be idempotent - multiple calls are safe", async () => {
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
      stream: "my-stream",
      streamSource: "default" as const,
    };

    await autoProvisionStream(config, mockClient as ZulipClient);
    await autoProvisionStream(config, mockClient as ZulipClient);
    await autoProvisionStream(config, mockClient as ZulipClient);

    expect(mockClient.createStream).toHaveBeenCalledTimes(3);
  });
});
