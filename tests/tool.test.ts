/**
 * Tests for ask_human tool.
 */

import { createAskHumanTool } from "../src/tool.js";
import type { ZulipClient } from "../src/zulip-client.js";
import type { MockedZulipClient } from "./vitest-env.d.ts";

describe("tool", () => {
  const mockConfig = {
    serverUrl: "https://zulip.example.com",
    botEmail: "bot@example.com",
    botApiKey: "test-api-key",
    stream: "test-stream",
    pollIntervalMs: 5000,
  };

  const mockZulipClient: MockedZulipClient = {
    postMessage: vi.fn(),
    registerEventQueue: vi.fn(),
    pollForReply: vi.fn(),
    deregisterQueue: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should post message and return reply for new question", async () => {
    mockZulipClient.postMessage.mockResolvedValue("123");
    mockZulipClient.registerEventQueue.mockResolvedValue({
      queueId: "queue-123",
      lastEventId: "999",
    });
    mockZulipClient.pollForReply.mockResolvedValue({
      id: "456",
      sender_email: "human@example.com",
      content: "Here's the answer",
    });
    mockZulipClient.deregisterQueue.mockResolvedValue();

    const tool = createAskHumanTool(
      mockConfig,
      mockZulipClient as unknown as ZulipClient,
    );

    const result = await tool.execute(
      "tool-call-123",
      {
        question: "What should I do?",
        context: "Error: something failed",
        confidence: 25,
      },
      new AbortController().signal,
      undefined,
      {} as any,
    );

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: "Human replied: Here's the answer",
        },
      ],
      isError: false,
      details: {
        thread_id: expect.stringContaining("Agent Q #"),
        responder: "human@example.com",
      },
    });

    expect(mockZulipClient.postMessage).toHaveBeenCalledWith(
      "test-stream",
      expect.stringContaining("Agent Q #"),
      expect.stringContaining("What should I do?"),
    );
    expect(mockZulipClient.registerEventQueue).toHaveBeenCalled();
    expect(mockZulipClient.pollForReply).toHaveBeenCalled();
    expect(mockZulipClient.deregisterQueue).toHaveBeenCalledWith("queue-123");
  });

  it("should post to existing topic for follow-up", async () => {
    mockZulipClient.postMessage.mockResolvedValue("123");
    mockZulipClient.registerEventQueue.mockResolvedValue({
      queueId: "queue-123",
      lastEventId: "999",
    });
    mockZulipClient.pollForReply.mockResolvedValue({
      id: "456",
      sender_email: "human@example.com",
      content: "Follow-up answer",
    });
    mockZulipClient.deregisterQueue.mockResolvedValue();

    const tool = createAskHumanTool(
      mockConfig,
      mockZulipClient as unknown as ZulipClient,
    );

    const result = await tool.execute(
      "tool-call-123",
      {
        question: "Does this help?",
        context: "More context",
        confidence: 40,
        thread_id: "Agent Q #42 — payment processing",
      },
      new AbortController().signal,
      undefined,
      {} as any,
    );

    expect(result.isError).toBe(false);
    expect(result.details?.thread_id).toBe("Agent Q #42 — payment processing");
    expect(mockZulipClient.postMessage).toHaveBeenCalledWith(
      "test-stream",
      "Agent Q #42 — payment processing",
      expect.stringContaining("Follow-up:"),
    );
  });

  it("should format message correctly for new question", async () => {
    mockZulipClient.postMessage.mockResolvedValue("123");
    mockZulipClient.registerEventQueue.mockResolvedValue({
      queueId: "queue-123",
      lastEventId: "999",
    });
    mockZulipClient.pollForReply.mockResolvedValue({
      id: "456",
      sender_email: "human@example.com",
      content: "Answer",
    });
    mockZulipClient.deregisterQueue.mockResolvedValue();

    const tool = createAskHumanTool(
      mockConfig,
      mockZulipClient as unknown as ZulipClient,
    );

    await tool.execute(
      "tool-call-123",
      {
        question: "Should I change X or Y?",
        context: "Context line 1\nContext line 2\nContext line 3",
        confidence: 30,
      },
      new AbortController().signal,
      undefined,
      {} as any,
    );

    const postedMessage = mockZulipClient.postMessage.mock
      .calls[0]?.[2] as string;

    expect(postedMessage).toContain("Agent needs help");
    expect(postedMessage).toContain("**Question:** Should I change X or Y?");
    expect(postedMessage).toContain("**Context:**");
    expect(postedMessage).toContain("Context line 1");
    expect(postedMessage).toContain("**Confidence:** 30/100");
    expect(postedMessage).toContain(
      "Reply in this topic. The agent is waiting for your response.",
    );
  });

  it("should format message correctly for follow-up", async () => {
    mockZulipClient.postMessage.mockResolvedValue("123");
    mockZulipClient.registerEventQueue.mockResolvedValue({
      queueId: "queue-123",
      lastEventId: "999",
    });
    mockZulipClient.pollForReply.mockResolvedValue({
      id: "456",
      sender_email: "human@example.com",
      content: "Answer",
    });
    mockZulipClient.deregisterQueue.mockResolvedValue();

    const tool = createAskHumanTool(
      mockConfig,
      mockZulipClient as unknown as ZulipClient,
    );

    await tool.execute(
      "tool-call-123",
      {
        question: "Here is more info",
        context: "",
        confidence: 50,
        thread_id: "Agent Q #1 — previous topic",
      },
      new AbortController().signal,
      undefined,
      {} as any,
    );

    const postedMessage = mockZulipClient.postMessage.mock
      .calls[0]?.[2] as string;

    expect(postedMessage).toContain("Follow-up:");
    expect(postedMessage).toContain("Here is more info");
    expect(postedMessage).not.toContain("Question:");
    expect(postedMessage).not.toContain("Confidence:");
  });

  it("should return error on Zulip post failure", async () => {
    mockZulipClient.postMessage.mockRejectedValue(
      new Error("Failed to post message: 500 Internal Server Error"),
    );

    const tool = createAskHumanTool(
      mockConfig,
      mockZulipClient as unknown as ZulipClient,
    );

    const result = await tool.execute(
      "tool-call-123",
      {
        question: "What should I do?",
        context: "Error context",
        confidence: 25,
      },
      new AbortController().signal,
      undefined,
      {} as any,
    );

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: "Failed to reach human: Failed to post message: 500 Internal Server Error. Proceeding without human input.",
        },
      ],
      isError: true,
      details: {},
    });
  });

  it("should return error on register queue failure", async () => {
    mockZulipClient.postMessage.mockResolvedValue("123");
    mockZulipClient.registerEventQueue.mockRejectedValue(
      new Error("Failed to register queue: 400 Bad Request"),
    );

    const tool = createAskHumanTool(
      mockConfig,
      mockZulipClient as unknown as ZulipClient,
    );

    const result = await tool.execute(
      "tool-call-123",
      {
        question: "What should I do?",
        context: "Error context",
        confidence: 25,
      },
      new AbortController().signal,
      undefined,
      {} as any,
    );

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("Failed to register queue");
  });

  it("should return error on poll failure", async () => {
    mockZulipClient.postMessage.mockResolvedValue("123");
    mockZulipClient.registerEventQueue.mockResolvedValue({
      queueId: "queue-123",
      lastEventId: "999",
    });
    mockZulipClient.pollForReply.mockRejectedValue(
      new Error("Failed to poll for reply: 500 Internal Server Error"),
    );
    mockZulipClient.deregisterQueue.mockResolvedValue();

    const tool = createAskHumanTool(
      mockConfig,
      mockZulipClient as unknown as ZulipClient,
    );

    const result = await tool.execute(
      "tool-call-123",
      {
        question: "What should I do?",
        context: "Error context",
        confidence: 25,
      },
      new AbortController().signal,
      undefined,
      {} as any,
    );

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("Failed to poll for reply");
    expect(mockZulipClient.deregisterQueue).toHaveBeenCalledWith("queue-123");
  });

  it("should return cancellation on signal.aborted", async () => {
    const abortController = new AbortController();

    mockZulipClient.postMessage.mockResolvedValue("123");
    mockZulipClient.registerEventQueue.mockResolvedValue({
      queueId: "queue-123",
      lastEventId: "999",
    });
    mockZulipClient.pollForReply.mockImplementation(async () => {
      abortController.abort();
      return null;
    });
    mockZulipClient.deregisterQueue.mockResolvedValue();

    const tool = createAskHumanTool(
      mockConfig,
      mockZulipClient as unknown as ZulipClient,
    );

    const result = await tool.execute(
      "tool-call-123",
      {
        question: "What should I do?",
        context: "Context",
        confidence: 25,
      },
      abortController.signal,
      undefined,
      {} as any,
    );

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: "Human consultation cancelled.",
        },
      ],
      isError: false,
      details: {},
    });

    expect(mockZulipClient.deregisterQueue).toHaveBeenCalledWith("queue-123");
  });

  it("should return cancellation when signal.aborted at start", async () => {
    const abortController = new AbortController();
    abortController.abort();

    const tool = createAskHumanTool(
      mockConfig,
      mockZulipClient as unknown as ZulipClient,
    );

    const result = await tool.execute(
      "tool-call-123",
      {
        question: "What should I do?",
        context: "Context",
        confidence: 25,
      },
      abortController.signal,
      undefined,
      {} as any,
    );

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: "Human consultation cancelled.",
        },
      ],
      isError: false,
      details: {},
    });

    expect(mockZulipClient.postMessage).not.toHaveBeenCalled();
  });

  it("should call onUpdate with progress messages", async () => {
    const onProgressUpdates: unknown[] = [];
    const onUpdate = vi.fn((update) => {
      onProgressUpdates.push(update);
    });

    mockZulipClient.postMessage.mockResolvedValue("123");
    mockZulipClient.registerEventQueue.mockResolvedValue({
      queueId: "queue-123",
      lastEventId: "999",
    });
    mockZulipClient.pollForReply.mockResolvedValue({
      id: "456",
      sender_email: "human@example.com",
      content: "Answer",
    });
    mockZulipClient.deregisterQueue.mockResolvedValue();

    const tool = createAskHumanTool(
      mockConfig,
      mockZulipClient as unknown as ZulipClient,
    );

    await tool.execute(
      "tool-call-123",
      {
        question: "What should I do?",
        context: "Context",
        confidence: 25,
      },
      new AbortController().signal,
      onUpdate,
      {} as any,
    );

    expect(onUpdate).toHaveBeenCalledWith({
      type: "progress",
      content: "Posting question to Zulip...",
    });
    expect(onUpdate).toHaveBeenCalledWith({
      type: "progress",
      content: "Waiting for human response...",
    });
    expect(onUpdate).toHaveBeenCalledWith({
      type: "progress",
      content: "Human response received.",
    });
  });

  it("should cleanup queue even when poll throws error", async () => {
    mockZulipClient.postMessage.mockResolvedValue("123");
    mockZulipClient.registerEventQueue.mockResolvedValue({
      queueId: "queue-123",
      lastEventId: "999",
    });
    mockZulipClient.pollForReply.mockRejectedValue(
      new Error("Network error during poll"),
    );
    mockZulipClient.deregisterQueue.mockResolvedValue();

    const tool = createAskHumanTool(
      mockConfig,
      mockZulipClient as unknown as ZulipClient,
    );

    const result = await tool.execute(
      "tool-call-123",
      {
        question: "What should I do?",
        context: "Context",
        confidence: 25,
      },
      new AbortController().signal,
      undefined,
      {} as any,
    );

    expect(result.isError).toBe(true);
    expect(mockZulipClient.deregisterQueue).toHaveBeenCalledWith("queue-123");
  });

  it("should have correct tool metadata", () => {
    const tool = createAskHumanTool(
      mockConfig,
      mockZulipClient as unknown as ZulipClient,
    );

    expect(tool.name).toBe("ask_human");
    expect(tool.label).toBe("Ask Human");
    expect(tool.description).toContain("Zulip");
    expect(tool.parameters).toBeDefined();
  });
});
