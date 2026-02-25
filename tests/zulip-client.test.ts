/**
 * Tests for Zulip client.
 */

import { describe, it, expect, vi } from "vitest";
import { createZulipClient } from "../src/zulip-client.ts";

describe("zulip-client", () => {
  it("should post message to Zulip", async () => {
    // TODO: Implement test with mocked fetch
    expect(true).toBe(true);
  });

  it("should register event queue", async () => {
    // TODO: Implement test with mocked fetch
  });

  it("should poll for reply and return human message", async () => {
    // TODO: Implement test with mocked fetch
  });

  it("should re-poll on empty response", async () => {
    // TODO: Implement test with mocked fetch
  });

  it("should filter out bot messages", async () => {
    // TODO: Implement test
  });

  it("should exit on signal.aborted", async () => {
    // TODO: Implement test with AbortController
  });

  it("should deregister queue", async () => {
    // TODO: Implement test with mocked fetch
  });
});
