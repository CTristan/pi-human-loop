/**
 * Tests for repository helpers.
 */

import { detectBranchName } from "../src/repo.js";

describe("detectBranchName", () => {
  it("returns the current branch name", () => {
    const branch = detectBranchName({
      cwd: "/tmp/project",
      execGit: () => "feature/add-payments",
    });

    expect(branch).toBe("feature/add-payments");
  });

  it("returns Detached HEAD when git reports HEAD", () => {
    const branch = detectBranchName({
      cwd: "/tmp/project",
      execGit: () => "HEAD",
    });

    expect(branch).toBe("Detached HEAD");
  });

  it("returns Detached HEAD when git command fails", () => {
    const branch = detectBranchName({
      cwd: "/tmp/project",
      execGit: () => null,
    });

    expect(branch).toBe("Detached HEAD");
  });

  it("preserves branch names with special characters", () => {
    const branch = detectBranchName({
      cwd: "/tmp/project",
      execGit: () => "feature/release-2026.02_hotfix",
    });

    expect(branch).toBe("feature/release-2026.02_hotfix");
  });
});
