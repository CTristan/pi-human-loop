/**
 * Tests for system prompt guidance.
 */

import { ASK_HUMAN_GUIDANCE } from "../src/prompt.js";

describe("prompt", () => {
  it("should contain ask_human tool name", () => {
    expect(ASK_HUMAN_GUIDANCE).toContain("ask_human");
  });

  it("should mention confidence level", () => {
    expect(ASK_HUMAN_GUIDANCE).toContain("confidence");
  });

  it("should mention thread_id for follow-ups", () => {
    expect(ASK_HUMAN_GUIDANCE).toContain("thread_id");
  });

  it("should include 'when to use' section", () => {
    expect(ASK_HUMAN_GUIDANCE).toContain("When to use ask_human");
  });

  it("should include 'when NOT to use' section", () => {
    expect(ASK_HUMAN_GUIDANCE).toContain("When NOT to use ask_human");
  });

  it("should include 'how to use it' section", () => {
    expect(ASK_HUMAN_GUIDANCE).toContain("How to use it");
  });
});
