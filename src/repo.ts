/**
 * Repository detection helpers for auto-provisioning.
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

  return path.basename(cwd);
}
