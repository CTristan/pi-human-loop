/**
 * Tests for ask_human tool.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { buildTopic, createAskHumanTool } from "../src/tool.js";
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

describe("buildTopic", () => {
  it("returns short repo:branch unchanged", () => {
    expect(buildTopic("my-repo", "main")).toBe("my-repo:main");
  });

  it("returns exactly 60 code points unchanged", () => {
    const repo = "a".repeat(25);
    const branch = "b".repeat(34);
    const topic = buildTopic(repo, branch);
    expect(topic).toBe(`${repo}:${branch}`);
    expect([...topic]).toHaveLength(60);
  });

  it("truncates branch side when repo + branch exceeds 60 code points", () => {
    const repo = "my-repo";
    const branch = "feature/very-long-branch-name-with-lots-of-text-and-more";
    const topic = buildTopic(repo, branch);

    expect(topic.startsWith("my-repo:")).toBe(true);
    expect(topic.endsWith("...")).toBe(true);
    expect([...topic]).toHaveLength(60);
  });

  it("preserves full repo name when possible", () => {
    const repo = "my-repository-name";
    const branch = "feature/" + "x".repeat(80);
    const topic = buildTopic(repo, branch);

    expect(topic.startsWith("my-repository-name:")).toBe(true);
    expect(topic.endsWith("...")).toBe(true);
    expect([...topic]).toHaveLength(60);
  });

  it("handles very long repo names by truncating both sides", () => {
    const repo = "very-long-repository-name-that-exceeds-limit";
    const branch = "feature/long-branch";
    const topic = buildTopic(repo, branch);

    expect(topic.endsWith("...")).toBe(true);
    expect([...topic]).toHaveLength(60);
  });

  it("handles extreme case where repo name alone exceeds limit", () => {
    const repo = "x".repeat(70);
    const branch = "main";
    const topic = buildTopic(repo, branch);

    expect(topic.endsWith("...")).toBe(true);
    expect([...topic]).toHaveLength(60);
  });

  it("counts Unicode code points correctly", () => {
    const repo = "🧪".repeat(50);
    const branch = "feature/branch";
    const topic = buildTopic(repo, branch);

    // Should truncate due to emoji counting as code points
    expect(topic.endsWith("...")).toBe(true);
    expect([...topic]).toHaveLength(60);
  });

  it("handles Unicode in branch names", () => {
    const repo = "my-repo";
    const branch = "🧪".repeat(61);
    const topic = buildTopic(repo, branch);

    expect(topic.startsWith("my-repo:")).toBe(true);
    expect(topic.endsWith("...")).toBe(true);
    expect([...topic]).toHaveLength(60);
  });
});

describe("tool", () => {
  const baseConfig = {
    serverUrl: "https://zulip.example.com",
    botEmail: "bot@example.com",
    botApiKey: "test-api-key",
    stream: "test-stream",
    streamSource: "global-config" as const,
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
    const autoProvisionStream = vi.fn().mockResolvedValue(undefined);
    const detectBranchName = vi.fn().mockReturnValue("feature/add-payments");
    const detectRepoName = vi.fn().mockReturnValue("my-repo");

    const tool = createAskHumanTool({
      loadConfig,
      createZulipClient,
      autoProvisionStream,
      detectBranchName,
      detectRepoName,
    });

    return {
      tool,
      loadConfig,
      createZulipClient,
      autoProvisionStream,
      detectBranchName,
      detectRepoName,
      config,
    };
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
      subject: "feature/add-payments",
    });
    mockZulipClient.deregisterQueue.mockResolvedValue();

    const { tool, detectBranchName, detectRepoName } = buildTool();

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
        thread_id: "my-repo:feature/add-payments",
        responder: "human@example.com",
      },
    });

    expect(detectBranchName).toHaveBeenCalledWith({ cwd: "/tmp" });
    expect(detectRepoName).toHaveBeenCalledWith({ cwd: "/tmp" });
    expect(mockZulipClient.postMessage).toHaveBeenCalledWith(
      "test-stream",
      "my-repo:feature/add-payments",
      expect.stringContaining("What should I do?"),
    );
    expect(mockZulipClient.registerEventQueue).toHaveBeenCalled();
    expect(mockZulipClient.pollForReply).toHaveBeenCalled();

    const pollOptions = mockZulipClient.pollForReply.mock.calls[0]?.[4] as {
      questionMessageId?: string;
      stream?: string;
      topic?: string;
    };
    expect(pollOptions).toMatchObject({
      stream: "test-stream",
      topic: "my-repo:feature/add-payments",
      questionMessageId: "123",
    });

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
      subject: "feature/add-payments",
    });
    mockZulipClient.deregisterQueue.mockResolvedValue();

    const { tool, detectBranchName } = buildTool();

    const result = await tool.execute(
      "tool-call-123",
      {
        question: "Does this help?",
        context: "More context",
        confidence: 40,
        thread_id: "feature/add-payments",
      },
      new AbortController().signal,
      undefined,
      ctx,
    );

    expect(result.isError).toBe(false);
    expect(result.details?.thread_id).toBe("feature/add-payments");
    expect(mockZulipClient.postMessage).toHaveBeenCalledWith(
      "test-stream",
      "feature/add-payments",
      expect.stringContaining("Follow-up:"),
    );
    expect(detectBranchName).not.toHaveBeenCalled();

    const followUpPollOptions = mockZulipClient.pollForReply.mock
      .calls[0]?.[4] as {
      questionMessageId?: string;
      stream?: string;
      topic?: string;
    };
    expect(followUpPollOptions).toMatchObject({
      stream: "test-stream",
      topic: "feature/add-payments",
      questionMessageId: "123",
    });
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
      subject: "feature/add-payments",
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

  it("should truncate long repo:branch topics to 60 code points", async () => {
    mockZulipClient.postMessage.mockResolvedValue("123");
    mockZulipClient.registerEventQueue.mockResolvedValue({
      queueId: "queue-123",
      lastEventId: "999",
    });
    mockZulipClient.pollForReply.mockResolvedValue({
      id: "456",
      sender_email: "human@example.com",
      content: "Answer",
      subject: "my-repo:feature/some-really-long-branch-name",
    });
    mockZulipClient.deregisterQueue.mockResolvedValue();

    const { tool, detectBranchName } = buildTool();
    detectBranchName.mockReturnValueOnce(`feature/${"🧪".repeat(80)}`);

    await tool.execute(
      "tool-call-123",
      {
        question: "Short question?",
        context: "Context",
        confidence: 30,
      },
      new AbortController().signal,
      undefined,
      ctx,
    );

    const topic = mockZulipClient.postMessage.mock.calls[0]?.[1] as string;
    expect(topic.endsWith("...")).toBe(true);
    expect([...topic]).toHaveLength(60);
  });

  it("should use repo:Detached HEAD topic when branch detection falls back", async () => {
    mockZulipClient.postMessage.mockResolvedValue("123");
    mockZulipClient.registerEventQueue.mockResolvedValue({
      queueId: "queue-123",
      lastEventId: "999",
    });
    mockZulipClient.pollForReply.mockResolvedValue({
      id: "456",
      sender_email: "human@example.com",
      content: "Answer",
      subject: "my-repo:Detached HEAD",
    });
    mockZulipClient.deregisterQueue.mockResolvedValue();

    const { tool, detectBranchName } = buildTool();
    detectBranchName.mockReturnValueOnce("Detached HEAD");

    await tool.execute(
      "tool-call-123",
      {
        question: "Short question?",
        context: "Context",
        confidence: 30,
      },
      new AbortController().signal,
      undefined,
      ctx,
    );

    expect(mockZulipClient.postMessage).toHaveBeenCalledWith(
      "test-stream",
      "my-repo:Detached HEAD",
      expect.any(String),
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
      subject: "feature/add-payments",
    });
    mockZulipClient.deregisterQueue.mockResolvedValue();

    const { tool } = buildTool();

    await tool.execute(
      "tool-call-123",
      {
        question: "Here is more info",
        context: "",
        confidence: 50,
        thread_id: "feature/add-payments",
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
      subject: "feature/add-payments",
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

  it("should auto-provision stream when enabled", async () => {
    mockZulipClient.postMessage.mockResolvedValue("123");
    mockZulipClient.registerEventQueue.mockResolvedValue({
      queueId: "queue-123",
      lastEventId: "999",
    });
    mockZulipClient.pollForReply.mockResolvedValue({
      id: "456",
      sender_email: "human@example.com",
      content: "Answer",
      subject: "my-repo:feature/add-payments",
    });
    mockZulipClient.deregisterQueue.mockResolvedValue();

    const { tool, autoProvisionStream } = buildTool();

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
      "test-stream",
      expect.any(String),
      expect.any(String),
    );
  });

  it("should return error when auto-provision fails", async () => {
    const { tool, autoProvisionStream } = buildTool();
    autoProvisionStream.mockRejectedValue(new Error("Permission denied"));

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
    expect(result.content?.[0]?.text).toContain("Permission denied");
  });

  it("should skip auto-provision when disabled", async () => {
    mockZulipClient.postMessage.mockResolvedValue("123");
    mockZulipClient.registerEventQueue.mockResolvedValue({
      queueId: "queue-123",
      lastEventId: "999",
    });
    mockZulipClient.pollForReply.mockResolvedValue({
      id: "456",
      sender_email: "human@example.com",
      content: "Answer",
      subject: "my-repo:feature/add-payments",
    });
    mockZulipClient.deregisterQueue.mockResolvedValue();

    const { tool, autoProvisionStream } = buildTool({
      autoProvision: false,
    });

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

    expect(autoProvisionStream).not.toHaveBeenCalled();
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
