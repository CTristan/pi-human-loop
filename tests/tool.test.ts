/**
 * Tests for ask_human tool.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { createAskHumanTool } from "../src/tool.js";
import type { ZulipClient } from "../src/zulip-client.js";

type MockedZulipClient = {
  postMessage: ReturnType<typeof vi.fn<ZulipClient["postMessage"]>>;
  registerEventQueue: ReturnType<
    typeof vi.fn<ZulipClient["registerEventQueue"]>
  >;
  pollForReply: ReturnType<typeof vi.fn<ZulipClient["pollForReply"]>>;
  deregisterQueue: ReturnType<typeof vi.fn<ZulipClient["deregisterQueue"]>>;
  ensureSubscribed: ReturnType<typeof vi.fn<ZulipClient["ensureSubscribed"]>>;
};

describe("tool", () => {
  const baseConfig = {
    serverUrl: "https://zulip.example.com",
    botEmail: "bot@example.com",
    botApiKey: "test-api-key",
    stream: "test-stream",
    pollIntervalMs: 5000,
    autoProvision: true,
  };

  const mockZulipClient: MockedZulipClient = {
    postMessage: vi.fn(),
    registerEventQueue: vi.fn(),
    pollForReply: vi.fn(),
    deregisterQueue: vi.fn(),
    ensureSubscribed: vi.fn(),
  };

  const ctx = { cwd: "/tmp" } as ExtensionContext;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  type ConfigOverride = Omit<Partial<typeof baseConfig>, "stream"> & {
    stream?: string | undefined;
  };

  function buildTool(configOverride: ConfigOverride = {}) {
    const { stream: streamOverride, ...otherOverrides } = configOverride;
    const config: Omit<typeof baseConfig, "stream"> & { stream?: string } = {
      ...baseConfig,
      ...otherOverrides,
    };

    if ("stream" in configOverride) {
      if (streamOverride === undefined) {
        delete config.stream;
      } else {
        config.stream = streamOverride;
      }
    }

    const loadConfig = vi.fn().mockReturnValue(config);
    const createZulipClient = vi.fn().mockReturnValue(mockZulipClient);
    const autoProvisionStream = vi
      .fn()
      .mockResolvedValue(config.stream ?? "auto-stream");

    const tool = createAskHumanTool({
      loadConfig,
      createZulipClient,
      autoProvisionStream,
    });

    return { tool, loadConfig, createZulipClient, autoProvisionStream, config };
  }

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

    const { tool } = buildTool();

    const result = await tool.execute(
      "tool-call-123",
      {
        question: "What should I do?",
        context: "Error: something failed",
        confidence: 25,
      },
      new AbortController().signal,
      undefined,
      ctx,
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

    const { tool } = buildTool();

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
      ctx,
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

    const { tool } = buildTool();

    await tool.execute(
      "tool-call-123",
      {
        question: "Should I change X or Y?",
        context: "Context line 1\nContext line 2\nContext line 3",
        confidence: 30,
      },
      new AbortController().signal,
      undefined,
      ctx,
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

  it("should truncate long summaries in the topic", async () => {
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

    const { tool } = buildTool();

    const longQuestion =
      "This is a very long question that should be trimmed in the topic line because it exceeds fifty characters.";

    await tool.execute(
      "tool-call-123",
      {
        question: longQuestion,
        context: "Context",
        confidence: 30,
      },
      new AbortController().signal,
      undefined,
      ctx,
    );

    const topic = mockZulipClient.postMessage.mock.calls[0]?.[1] as string;
    expect(topic).toContain("Agent Q #");
    expect(topic).toContain("...");
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

    const { tool } = buildTool();

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
      ctx,
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

    const { tool } = buildTool();

    const result = await tool.execute(
      "tool-call-123",
      {
        question: "What should I do?",
        context: "Error context",
        confidence: 25,
      },
      new AbortController().signal,
      undefined,
      ctx,
    );

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: expect.stringContaining("CRITICAL: Failed to reach human"),
        },
      ],
      isError: true,
      details: {},
    });
    expect(result.content?.[0]?.text).toContain("Do NOT proceed");
  });

  it("should return error on register queue failure", async () => {
    mockZulipClient.postMessage.mockResolvedValue("123");
    mockZulipClient.registerEventQueue.mockRejectedValue(
      new Error("Failed to register queue: 400 Bad Request"),
    );

    const { tool } = buildTool();

    const result = await tool.execute(
      "tool-call-123",
      {
        question: "What should I do?",
        context: "Error context",
        confidence: 25,
      },
      new AbortController().signal,
      undefined,
      ctx,
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

    const { tool } = buildTool();

    const result = await tool.execute(
      "tool-call-123",
      {
        question: "What should I do?",
        context: "Error context",
        confidence: 25,
      },
      new AbortController().signal,
      undefined,
      ctx,
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

    const { tool } = buildTool();

    const result = await tool.execute(
      "tool-call-123",
      {
        question: "What should I do?",
        context: "Context",
        confidence: 25,
      },
      abortController.signal,
      undefined,
      ctx,
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

  it("should return cancellation when poll returns null without abort", async () => {
    mockZulipClient.postMessage.mockResolvedValue("123");
    mockZulipClient.registerEventQueue.mockResolvedValue({
      queueId: "queue-123",
      lastEventId: "999",
    });
    mockZulipClient.pollForReply.mockResolvedValue(null);
    mockZulipClient.deregisterQueue.mockResolvedValue();

    const { tool } = buildTool();

    const result = await tool.execute(
      "tool-call-123",
      {
        question: "What should I do?",
        context: "Context",
        confidence: 25,
      },
      new AbortController().signal,
      undefined,
      ctx,
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

    const { tool } = buildTool();

    const result = await tool.execute(
      "tool-call-123",
      {
        question: "What should I do?",
        context: "Context",
        confidence: 25,
      },
      abortController.signal,
      undefined,
      ctx,
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

    const { tool } = buildTool();

    await tool.execute(
      "tool-call-123",
      {
        question: "What should I do?",
        context: "Context",
        confidence: 25,
      },
      new AbortController().signal,
      onUpdate,
      ctx,
    );

    expect(onUpdate).toHaveBeenCalledWith({
      content: [{ type: "text", text: "Posting question to Zulip..." }],
      details: { status: "posting" },
    });
    expect(onUpdate).toHaveBeenCalledWith({
      content: [{ type: "text", text: "Waiting for human response..." }],
      details: { status: "waiting" },
    });
    expect(onUpdate).toHaveBeenCalledWith({
      content: [{ type: "text", text: "Human response received." }],
      details: { status: "received" },
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

    const { tool } = buildTool();

    const result = await tool.execute(
      "tool-call-123",
      {
        question: "What should I do?",
        context: "Context",
        confidence: 25,
      },
      new AbortController().signal,
      undefined,
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(mockZulipClient.deregisterQueue).toHaveBeenCalledWith("queue-123");
  });

  it("should have correct tool metadata", () => {
    const { tool } = buildTool();

    expect(tool.name).toBe("ask_human");
    expect(tool.label).toBe("Ask Human");
    expect(tool.description).toContain("Zulip");
    expect(tool.parameters).toBeDefined();
  });

  it("should return error when config load fails", async () => {
    const loadConfig = vi.fn().mockImplementation(() => {
      throw new Error("Configuration validation failed");
    });

    const tool = createAskHumanTool({
      loadConfig,
      createZulipClient: vi.fn().mockReturnValue(mockZulipClient),
      autoProvisionStream: vi.fn(),
    });

    const result = await tool.execute(
      "tool-call-123",
      {
        question: "What should I do?",
        context: "Context",
        confidence: 25,
      },
      new AbortController().signal,
      undefined,
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain(
      "CRITICAL: Failed to reach human",
    );
    expect(result.content?.[0]?.text).toContain(
      "Configuration validation failed",
    );
  });

  it("should use default loadConfig when dependency is not provided", async () => {
    const oldServerUrl = process.env.ZULIP_SERVER_URL;
    const oldBotEmail = process.env.ZULIP_BOT_EMAIL;
    const oldApiKey = process.env.ZULIP_BOT_API_KEY;

    // Force validation to fail even if ~/.pi/human-loop.json exists locally.
    process.env.ZULIP_SERVER_URL = "invalid-url";
    process.env.ZULIP_BOT_EMAIL = "";
    process.env.ZULIP_BOT_API_KEY = "";

    try {
      const tool = createAskHumanTool({
        createZulipClient: vi.fn().mockReturnValue(mockZulipClient),
        autoProvisionStream: vi.fn(),
      });

      const result = await tool.execute(
        "tool-call-123",
        {
          question: "What should I do?",
          context: "Context",
          confidence: 25,
        },
        new AbortController().signal,
        undefined,
        {
          cwd: `/tmp/pi-human-loop-no-config-${Date.now()}`,
        } as ExtensionContext,
      );

      expect(result.isError).toBe(true);
      expect(result.content?.[0]?.text).toContain(
        "Configuration validation failed",
      );
    } finally {
      if (oldServerUrl === undefined) {
        delete process.env.ZULIP_SERVER_URL;
      } else {
        process.env.ZULIP_SERVER_URL = oldServerUrl;
      }

      if (oldBotEmail === undefined) {
        delete process.env.ZULIP_BOT_EMAIL;
      } else {
        process.env.ZULIP_BOT_EMAIL = oldBotEmail;
      }

      if (oldApiKey === undefined) {
        delete process.env.ZULIP_BOT_API_KEY;
      } else {
        process.env.ZULIP_BOT_API_KEY = oldApiKey;
      }
    }
  });

  it("should auto-provision when stream is missing", async () => {
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

    const { tool, autoProvisionStream } = buildTool({ stream: undefined });
    autoProvisionStream.mockResolvedValue("auto-stream");

    await tool.execute(
      "tool-call-123",
      {
        question: "What should I do?",
        context: "Context",
        confidence: 25,
      },
      new AbortController().signal,
      undefined,
      ctx,
    );

    expect(autoProvisionStream).toHaveBeenCalled();
    expect(mockZulipClient.postMessage).toHaveBeenCalledWith(
      "auto-stream",
      expect.any(String),
      expect.any(String),
    );
  });

  it("should return error when auto-provision fails", async () => {
    const { tool, autoProvisionStream } = buildTool({ stream: undefined });
    autoProvisionStream.mockRejectedValue(new Error("No stream available"));

    const result = await tool.execute(
      "tool-call-123",
      {
        question: "What should I do?",
        context: "Context",
        confidence: 25,
      },
      new AbortController().signal,
      undefined,
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("No stream available");
  });

  it("should return critical error when auto-provision returns no stream", async () => {
    const { tool, autoProvisionStream } = buildTool({ stream: undefined });
    autoProvisionStream.mockResolvedValueOnce(undefined as unknown as string);

    const result = await tool.execute(
      "tool-call-123",
      {
        question: "What should I do?",
        context: "Context",
        confidence: 25,
      },
      new AbortController().signal,
      undefined,
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("No stream configured");
  });

  it("should return cancellation when poll errors after abort", async () => {
    const abortController = new AbortController();

    mockZulipClient.postMessage.mockResolvedValue("123");
    mockZulipClient.registerEventQueue.mockResolvedValue({
      queueId: "queue-123",
      lastEventId: "999",
    });
    mockZulipClient.pollForReply.mockImplementation(async () => {
      abortController.abort();
      throw new Error("Poll failed");
    });
    mockZulipClient.deregisterQueue.mockResolvedValue();

    const { tool } = buildTool();

    const result = await tool.execute(
      "tool-call-123",
      {
        question: "What should I do?",
        context: "Context",
        confidence: 25,
      },
      abortController.signal,
      undefined,
      ctx,
    );

    expect(result.isError).toBe(false);
    expect(result.content?.[0]?.text).toBe("Human consultation cancelled.");
  });
});
