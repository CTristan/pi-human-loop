/**
 * Tests for system prompt guidance.
 */

import { ASK_HUMAN_GUIDANCE } from "../src/prompt.js";

describe("prompt", () => {
  it("should contain ask_human tool name", () => {
    expect(ASK_HUMAN_GUIDANCE).toContain("ask_human");
  });

  it("should instruct to compose natural messages", () => {
    expect(ASK_HUMAN_GUIDANCE).toContain("naturally");
  });

  it("should mention confidence with reasoning", () => {
    expect(ASK_HUMAN_GUIDANCE).toContain("confidence score");
    expect(ASK_HUMAN_GUIDANCE).toContain("explanation of why");
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

  it("should mention the message parameter", () => {
    expect(ASK_HUMAN_GUIDANCE).toContain("ask_human({ message");
  });

  it("should instruct to stop on errors", () => {
    expect(ASK_HUMAN_GUIDANCE).toContain("MUST stop working immediately");
    expect(ASK_HUMAN_GUIDANCE).toContain("Do NOT attempt to continue");
  });
});
