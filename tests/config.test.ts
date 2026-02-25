/**
 * Tests for configuration loading and validation.
 */

import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.ts";

describe("config", () => {
  it("should load valid config", () => {
    // TODO: Implement test
    expect(() => loadConfig()).toThrow("Not implemented yet");
  });

  it("should validate required environment variables", () => {
    // TODO: Implement test
  });

  it("should validate server URL format", () => {
    // TODO: Implement test
  });

  it("should use default poll interval if not provided", () => {
    // TODO: Implement test
  });

  it("should reject invalid poll interval", () => {
    // TODO: Implement test
  });
});
