/**
 * Unit tests for logger module.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "../src/logger.js";

describe("logger", () => {
  let tempDir: string;
  let logPath: string;

  beforeEach(() => {
    // Create a temporary directory for log files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "human-loop-test-"));
    logPath = path.join(tempDir, "debug.log");
  });

  afterEach(() => {
    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("debug=true", () => {
    it("writes log lines to file", () => {
      const logger = createLogger({
        debug: true,
        logPath: logPath,
        cwd: tempDir,
      });

      logger.debug("Test message");
      logger.debug("Another message", { key: "value" });

      const logContent = fs.readFileSync(logPath, "utf8");
      const lines = logContent.trim().split("\n");

      expect(lines).toHaveLength(2);

      const firstEntry = JSON.parse(lines[0]!);
      expect(firstEntry).toHaveProperty("timestamp");
      expect(firstEntry.message).toBe("Test message");
      expect(firstEntry.data).toBeUndefined();

      const secondEntry = JSON.parse(lines[1]!);
      expect(secondEntry).toHaveProperty("timestamp");
      expect(secondEntry.message).toBe("Another message");
      expect(secondEntry.data).toEqual({ key: "value" });
    });

    it("writes error log lines to file", () => {
      const logger = createLogger({
        debug: true,
        logPath: logPath,
        cwd: tempDir,
      });

      logger.error("Error message");
      logger.error("Another error", { code: 500 });

      const logContent = fs.readFileSync(logPath, "utf8");
      const lines = logContent.trim().split("\n");

      expect(lines).toHaveLength(2);

      const firstEntry = JSON.parse(lines[0]!);
      expect(firstEntry).toHaveProperty("timestamp");
      expect(firstEntry.level).toBe("ERROR");
      expect(firstEntry.message).toBe("Error message");
      expect(firstEntry.data).toBeUndefined();

      const secondEntry = JSON.parse(lines[1]!);
      expect(secondEntry).toHaveProperty("timestamp");
      expect(secondEntry.level).toBe("ERROR");
      expect(secondEntry.message).toBe("Another error");
      expect(secondEntry.data).toEqual({ code: 500 });
    });

    it("truncates log file on session start", () => {
      // Create initial log content
      fs.writeFileSync(logPath, "old content\n");

      const logger = createLogger({
        debug: true,
        logPath: logPath,
        cwd: tempDir,
      });

      logger.debug("New message");

      const logContent = fs.readFileSync(logPath, "utf8");
      expect(logContent).not.toContain("old content");
      expect(logContent).toContain("New message");
    });

    it("appends to existing log file for subsequent logger instances in the same process", () => {
      // First logger instance truncates and initializes the file
      const logger1 = createLogger({
        debug: true,
        logPath: logPath,
        cwd: tempDir,
      });
      logger1.debug("First message");

      // Verify permissions on the file
      const stats1 = fs.statSync(logPath);
      expect(stats1.mode & 0o777).toBe(0o600);

      // Second logger instance appending to the same file
      const logger2 = createLogger({
        debug: true,
        logPath: logPath,
        cwd: tempDir,
      });

      // Tamper with permissions to verify they are restored
      fs.chmodSync(logPath, 0o644);

      logger2.debug("Second message");

      // Verify the file contains both messages (not truncated)
      const logContent = fs.readFileSync(logPath, "utf8");
      expect(logContent).toContain("First message");
      expect(logContent).toContain("Second message");

      // Verify permissions were enforced again
      const stats2 = fs.statSync(logPath);
      expect(stats2.mode & 0o777).toBe(0o600);
    });

    it("uses JSON format", () => {
      const logger = createLogger({
        debug: true,
        logPath: logPath,
        cwd: tempDir,
      });

      logger.debug("Test", {
        number: 42,
        boolean: true,
        nested: { key: "value" },
      });

      const logContent = fs.readFileSync(logPath, "utf8");
      const entry = JSON.parse(logContent.trim());

      expect(entry).toHaveProperty("timestamp");
      expect(entry.message).toBe("Test");
      expect(entry.data).toEqual({
        number: 42,
        boolean: true,
        nested: { key: "value" },
      });
    });

    it("includes ISO timestamp", () => {
      const logger = createLogger({
        debug: true,
        logPath: logPath,
        cwd: tempDir,
      });

      logger.debug("Test");

      const logContent = fs.readFileSync(logPath, "utf8");
      const entry = JSON.parse(logContent.trim());

      expect(entry.timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
    });

    it("handles special characters in message", () => {
      const logger = createLogger({
        debug: true,
        logPath: logPath,
        cwd: tempDir,
      });

      const message =
        "Message with \"quotes\" and 'apostrophes' and \n newlines";
      logger.debug(message);

      const logContent = fs.readFileSync(logPath, "utf8");
      const entry = JSON.parse(logContent.trim());

      expect(entry.message).toBe(message);
    });

    it("handles undefined data gracefully", () => {
      const logger = createLogger({
        debug: true,
        logPath: logPath,
        cwd: tempDir,
      });

      logger.debug("Message without data");

      const logContent = fs.readFileSync(logPath, "utf8");
      const entry = JSON.parse(logContent.trim());

      expect(entry.message).toBe("Message without data");
      expect(entry).not.toHaveProperty("data");
    });
  });

  describe("debug=false", () => {
    it("produces no file I/O", () => {
      const logger = createLogger({
        debug: false,
        logPath: logPath,
        cwd: tempDir,
      });

      logger.debug("Test message");
      logger.debug("Another message", { key: "value" });

      // Log file should not exist
      expect(fs.existsSync(logPath)).toBe(false);
    });

    it("handles calls without errors", () => {
      const logger = createLogger({
        debug: false,
        logPath: logPath,
        cwd: tempDir,
      });

      // Should not throw
      expect(() => {
        logger.debug("Test");
        logger.debug("Test", { data: "value" });
      }).not.toThrow();
    });
  });

  describe("directory creation", () => {
    it("creates log directory if it does not exist", () => {
      const nestedPath = path.join(tempDir, "nested", "dir", "debug.log");

      const logger = createLogger({
        debug: true,
        logPath: nestedPath,
        cwd: tempDir,
      });

      logger.debug("Test");

      expect(fs.existsSync(nestedPath)).toBe(true);
    });
  });

  describe("error handling", () => {
    it("continues silently on write errors", () => {
      // Create a file path that will fail (a directory)
      const dirPath = path.join(tempDir, "logfile");
      fs.mkdirSync(dirPath);

      const logger = createLogger({
        debug: true,
        logPath: dirPath,
        cwd: tempDir,
      });

      // Should not throw even though writing to a directory will fail
      expect(() => {
        logger.debug("Test message");
      }).not.toThrow();
    });
  });
});
