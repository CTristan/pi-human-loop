/**
 * Debug logging for the pi-human-loop extension.
 *
 * Provides zero-overhead logging when disabled, and JSON-formatted
 * structured logging when enabled. Log files are truncated on session
 * start to retain only the current session's data.
 */

import fs from "node:fs";
import path from "node:path";

export interface Logger {
  /** Log a debug message with optional structured data. */
  debug(message: string, data?: Record<string, unknown>): void;
}

export interface LoggerConfig {
  /** Whether debug logging is enabled. */
  debug: boolean;
  /** Path to the debug log file (relative to project root). */
  logPath: string;
  /** Current working directory for resolving relative paths. */
  cwd?: string;
}

interface LogEntry {
  timestamp: string;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Creates a logger instance.
 *
 * When debug is false, returns a no-op logger with zero overhead.
 * When debug is true, creates a logger that writes JSON-formatted
 * log entries to the specified file. The log file is truncated
 * on first write (session start).
 *
 * @param config - Logger configuration
 * @returns Logger instance
 */
export function createLogger(config: LoggerConfig): Logger {
  const { debug, logPath, cwd = process.cwd() } = config;

  if (!debug) {
    return createNoOpLogger();
  }

  let initialized = false;
  const fullPath = path.resolve(cwd, logPath);

  return {
    debug(message: string, data?: Record<string, unknown>): void {
      if (!initialized) {
        // Truncate log file on session start
        ensureLogFileExists(fullPath);
        initialized = true;
      }

      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        message,
        ...(data !== undefined && { data }),
      };

      appendLogLine(fullPath, entry);
    },
  };
}

function createNoOpLogger(): Logger {
  return {
    debug(): void {
      // No-op - zero overhead when debug is disabled
    },
  };
}

function ensureLogFileExists(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  // Truncate file to start fresh for this session
  try {
    fs.writeFileSync(filePath, "", { mode: 0o600 });
  } catch {
    // Silently fail on write errors
  }
}

function appendLogLine(filePath: string, entry: LogEntry): void {
  const line = JSON.stringify(entry) + "\n";
  try {
    fs.appendFileSync(filePath, line, "utf8");
  } catch (error) {
    // Silently fail on write errors to avoid crashing the application
    // The logging should be robust - if it fails, the app should continue
  }
}
