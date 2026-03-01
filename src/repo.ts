/**
 * Repository detection helpers for auto-provisioning and topic selection.
 */

import { execSync } from "node:child_process";
import path from "node:path";

export function parseRepoNameFromRemote(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim();
  if (!trimmed) {
    return null;
  }

  const withoutGit = trimmed.replace(/\.git$/, "");

  if (withoutGit.includes("://")) {
    try {
      const parsed = new URL(withoutGit);
      const segments = parsed.pathname.split("/").filter(Boolean);
      return segments.length > 0
        ? (segments[segments.length - 1] ?? null)
        : null;
    } catch {
      // Fall through to SSH parsing
    }
  }

  const sshMatch = withoutGit.match(/^[^@]+@[^:]+:(.+)$/);
  if (sshMatch?.[1]) {
    const segments = sshMatch[1].split("/").filter(Boolean);
    return segments.length > 0 ? (segments[segments.length - 1] ?? null) : null;
  }

  const segments = withoutGit.split("/").filter(Boolean);
  return segments.length > 0 ? (segments[segments.length - 1] ?? null) : null;
}

export function detectRepoName(options?: {
  cwd?: string;
  getRemoteUrl?: (cwd: string) => string | null;
}): string {
  const cwd = options?.cwd ?? process.cwd();
  const getRemoteUrl =
    options?.getRemoteUrl ??
    ((workingDir: string) => {
      try {
        const output = execSync("git remote get-url origin", {
          cwd: workingDir,
          stdio: ["ignore", "pipe", "ignore"],
        });
        return output.toString().trim();
      } catch {
        return null;
      }
    });

  const remoteUrl = getRemoteUrl(cwd);
  const parsed = remoteUrl ? parseRepoNameFromRemote(remoteUrl) : null;
  if (parsed) {
    return parsed;
  }

  const fallback = path.basename(cwd).trim();
  return fallback || "unknown-repo";
}

export function detectBranchName(options?: {
  cwd?: string;
  execGit?: (cwd: string) => string | null;
}): string {
  const cwd = options?.cwd ?? process.cwd();
  const execGit =
    options?.execGit ??
    ((workingDir: string) => {
      try {
        const output = execSync("git rev-parse --abbrev-ref HEAD", {
          cwd: workingDir,
          stdio: ["ignore", "pipe", "ignore"],
        });
        return output.toString().trim();
      } catch {
        return null;
      }
    });

  const branch = execGit(cwd)?.trim();
  if (!branch || branch === "HEAD") {
    return "Detached HEAD";
  }

  return branch;
}
