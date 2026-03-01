/**
 * Tests for Zulip client.
 */

import { createZulipClient, type ZulipClient } from "../src/zulip-client.js";

describe("zulip-client", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let client: ZulipClient;
  const originalFetch = global.fetch;
  const config = {
    serverUrl: "https://zulip.example.com",
    botEmail: "bot@example.com",
    botApiKey: "test-api-key",
    pollIntervalMs: 5000,
    debug: false,
  };

  beforeEach(() => {
    // Reset fetch mock
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof global.fetch;

    // Create client
    client = createZulipClient(config);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("should post message to Zulip", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 123 }),
    });

    const messageId = await client.postMessage(
      "test-stream",
      "test-topic",
      "test content",
    );

    expect(messageId).toBe("123");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://zulip.example.com/api/v1/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: expect.stringContaining("Basic"),
        }),
      }),
    );
  });

  it("should post message with correct form data", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 456 }),
    });

    await client.postMessage("my-stream", "my-topic", "my message");

    const callArgs = mockFetch.mock.calls[0];
    if (!callArgs) {
      throw new Error("Expected fetch to be called");
    }
    const body = callArgs[1]?.body as string;
    expect(body).toContain("type=stream");
    expect(body).toContain("to=my-stream");
    expect(body).toContain("topic=my-topic");
    // URLSearchParams uses + for spaces, not %20
    expect(body).toContain("content=my+message");
  });

  it("should throw error when post message fails", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "Invalid API key",
    });

    await expect(
      client.postMessage("stream", "topic", "content"),
    ).rejects.toThrow(/Failed to post message to Zulip: 401/);
  });

  it("should register event queue", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        queue_id: "queue-123",
        last_event_id: 999,
      }),
    });

    const result = await client.registerEventQueue("test-stream", "test-topic");

    expect(result).toEqual({
      queueId: "queue-123",
      lastEventId: "999",
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("should register event queue with correct narrow", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        queue_id: "queue-123",
        last_event_id: 999,
      }),
    });

    await client.registerEventQueue("my-stream", "my-topic");

    const callArgs = mockFetch.mock.calls[0];
    if (!callArgs) {
      throw new Error("Expected fetch to be called");
    }
    const body = callArgs[1]?.body as string;
    expect(body).toContain("event_types=%5B%22message%22%5D"); // ["message"]
    expect(body).toContain(
      "narrow=%5B%5B%22stream%22%2C%22my-stream%22%5D%2C%5B%22topic%22%2C%22my-topic%22%5D%5D",
    );
  });

  it("should register event queue with all_public_streams parameter", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        queue_id: "queue-123",
        last_event_id: 999,
      }),
    });

    await client.registerEventQueue("test-stream", "test-topic");

    const callArgs = mockFetch.mock.calls[0];
    if (!callArgs) {
      throw new Error("Expected fetch to be called");
    }
    const body = callArgs[1]?.body as string;
    expect(body).toContain("all_public_streams=true");
  });

  it("should log registerEventQueue narrow payload", async () => {
    const logger = { debug: vi.fn() };
    const clientWithLogger = createZulipClient({
      ...config,
      logger,
    });

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        queue_id: "queue-123",
        last_event_id: 999,
      }),
    });

    await clientWithLogger.registerEventQueue("test-stream", "test-topic");

    expect(logger.debug).toHaveBeenCalledWith(
      "ZulipClient.registerEventQueue called",
      {
        stream: "test-stream",
        topic: "test-topic",
        narrow: [
          ["stream", "test-stream"],
          ["topic", "test-topic"],
        ],
      },
    );
  });

  it("should throw error when register queue fails", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: async () => "Invalid narrow",
    });

    await expect(client.registerEventQueue("stream", "topic")).rejects.toThrow(
      /Failed to register event queue: 400/,
    );
  });

  it("should poll for reply and return human message", async () => {
    const abortController = new AbortController();

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        events: [
          {
            id: 1001,
            message: {
              id: 200,
              sender_email: "human@example.com",
              content: "Human's reply",
              subject: "Agent Q #abc123 — test",
            },
          },
        ],
      }),
    });

    const reply = await client.pollForReply(
      "queue-123",
      "999",
      "bot@example.com",
      abortController.signal,
    );

    expect(reply).toEqual({
      id: "200",
      sender_email: "human@example.com",
      content: "Human's reply",
      subject: "Agent Q #abc123 — test",
    });
  });

  it("should return reply when topicId matches message subject", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        events: [
          {
            id: 1001,
            message: {
              id: 200,
              sender_email: "human@example.com",
              content: "Human's reply",
              subject: "Agent Q #mm77lq7a — test",
            },
          },
        ],
      }),
    });

    const reply = await client.pollForReply(
      "queue-123",
      "999",
      "bot@example.com",
      new AbortController().signal,
      { topicId: "mm77lq7a" },
    );

    expect(reply).toEqual({
      id: "200",
      sender_email: "human@example.com",
      content: "Human's reply",
      subject: "Agent Q #mm77lq7a — test",
    });
  });

  it("should skip message when topicId does not match and return next matching reply", async () => {
    const logger = { debug: vi.fn() };
    const clientWithLogger = createZulipClient({
      ...config,
      logger,
    });

    let callCount = 0;
    mockFetch.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          json: async () => ({
            events: [
              {
                id: 1001,
                message: {
                  id: 200,
                  sender_email: "human@example.com",
                  content: "Wrong thread",
                  subject: "Agent Q #differentid — other",
                },
              },
            ],
          }),
        };
      }

      return {
        ok: true,
        json: async () => ({
          events: [
            {
              id: 1002,
              message: {
                id: 201,
                sender_email: "human@example.com",
                content: "Correct thread",
                subject: "Agent Q #mm77lq7a — target",
              },
            },
          ],
        }),
      };
    });

    const reply = await clientWithLogger.pollForReply(
      "queue-123",
      "999",
      "bot@example.com",
      new AbortController().signal,
      { topicId: "mm77lq7a" },
    );

    expect(reply).toEqual({
      id: "201",
      sender_email: "human@example.com",
      content: "Correct thread",
      subject: "Agent Q #mm77lq7a — target",
    });

    expect(logger.debug).toHaveBeenCalledWith(
      "Skipping message: topic ID mismatch",
      {
        expectedTopicId: "mm77lq7a",
        actualSubject: "Agent Q #differentid — other",
      },
    );
  });

  it("should accept reply when topicId is not provided", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        events: [
          {
            id: 1001,
            message: {
              id: 200,
              sender_email: "human@example.com",
              content: "Reply without topic filter",
              subject: "Completely unrelated topic",
            },
          },
        ],
      }),
    });

    const reply = await client.pollForReply(
      "queue-123",
      "999",
      "bot@example.com",
      new AbortController().signal,
    );

    expect(reply).toEqual({
      id: "200",
      sender_email: "human@example.com",
      content: "Reply without topic filter",
      subject: "Completely unrelated topic",
    });
  });

  it("should filter out bot messages", async () => {
    const abortController = new AbortController();

    let callCount = 0;
    mockFetch.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // First poll returns bot message only
        return {
          ok: true,
          json: async () => ({
            events: [
              {
                id: 1001,
                message: {
                  id: 200,
                  sender_email: "bot@example.com",
                  content: "Bot's message",
                  subject: "Agent Q #abc123 — test",
                },
              },
            ],
          }),
        };
      }
      // Second poll returns human message
      return {
        ok: true,
        json: async () => ({
          events: [
            {
              id: 1002,
              message: {
                id: 201,
                sender_email: "human@example.com",
                content: "Human's reply",
                subject: "Agent Q #abc123 — test",
              },
            },
          ],
        }),
      };
    });

    const reply = await client.pollForReply(
      "queue-123",
      "999",
      "bot@example.com",
      abortController.signal,
    );

    expect(reply).toEqual({
      id: "201",
      sender_email: "human@example.com",
      content: "Human's reply",
      subject: "Agent Q #abc123 — test",
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("should ignore heartbeat events and keep polling", async () => {
    const abortController = new AbortController();

    let callCount = 0;
    mockFetch.mockImplementation(async () => {
      callCount++;

      if (callCount === 1) {
        return {
          ok: true,
          json: async () => ({
            events: [{ type: "heartbeat", id: 0 }],
          }),
        };
      }

      return {
        ok: true,
        json: async () => ({
          events: [
            {
              id: 1,
              message: {
                id: 200,
                sender_email: "human@example.com",
                content: "Human's reply",
                subject: "Agent Q #abc123 — test",
              },
            },
          ],
        }),
      };
    });

    const reply = await client.pollForReply(
      "queue-123",
      "-1",
      "bot@example.com",
      abortController.signal,
    );

    expect(reply).toEqual({
      id: "200",
      sender_email: "human@example.com",
      content: "Human's reply",
      subject: "Agent Q #abc123 — test",
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("should re-poll on empty response", async () => {
    const abortController = new AbortController();

    let callCount = 0;
    mockFetch.mockImplementation(async () => {
      callCount++;
      if (callCount < 3) {
        // First two polls return empty (long-poll timeout)
        return {
          ok: true,
          json: async () => ({ events: [] }),
        };
      }
      // Third poll returns human message
      return {
        ok: true,
        json: async () => ({
          events: [
            {
              id: 1001,
              message: {
                id: 200,
                sender_email: "human@example.com",
                content: "Human's reply",
                subject: "Agent Q #abc123 — test",
              },
            },
          ],
        }),
      };
    });

    const reply = await client.pollForReply(
      "queue-123",
      "999",
      "bot@example.com",
      abortController.signal,
    );

    expect(reply).toEqual({
      id: "200",
      sender_email: "human@example.com",
      content: "Human's reply",
      subject: "Agent Q #abc123 — test",
    });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("should return first non-bot message when multiple humans reply", async () => {
    const abortController = new AbortController();

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        events: [
          {
            id: 1001,
            message: {
              id: 200,
              sender_email: "human1@example.com",
              content: "First reply",
              subject: "Agent Q #abc123 — test",
            },
          },
          {
            id: 1002,
            message: {
              id: 201,
              sender_email: "human2@example.com",
              content: "Second reply",
              subject: "Agent Q #abc123 — test",
            },
          },
        ],
      }),
    });

    const reply = await client.pollForReply(
      "queue-123",
      "999",
      "bot@example.com",
      abortController.signal,
    );

    expect(reply).toEqual({
      id: "200",
      sender_email: "human1@example.com",
      content: "First reply",
      subject: "Agent Q #abc123 — test",
    });
  });

  it("should exit on signal.aborted", async () => {
    const abortController = new AbortController();

    let pollCount = 0;
    mockFetch.mockImplementation(async () => {
      pollCount++;
      if (pollCount === 2) {
        abortController.abort();
      }
      // Return empty response (long-poll timeout)
      return {
        ok: true,
        json: async () => ({ events: [] }),
      };
    });

    const reply = await client.pollForReply(
      "queue-123",
      "999",
      "bot@example.com",
      abortController.signal,
    );

    expect(reply).toBeNull();
    expect(abortController.signal.aborted).toBe(true);
  });

  it("should handle abort error during fetch", async () => {
    const abortController = new AbortController();
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";

    mockFetch.mockImplementation(async () => {
      abortController.abort();
      throw abortError;
    });

    const reply = await client.pollForReply(
      "queue-123",
      "999",
      "bot@example.com",
      abortController.signal,
    );

    expect(reply).toBeNull();
  });

  it("should retry with backoff on HTTP 500 errors", async () => {
    const abortController = new AbortController();
    vi.useFakeTimers();

    let callCount = 0;
    mockFetch.mockImplementation(async () => {
      callCount++;
      if (callCount <= 2) {
        // First two calls fail with 500
        return {
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          text: async () => "Server error",
        };
      }
      // Third call succeeds
      return {
        ok: true,
        json: async () => ({
          events: [
            {
              id: 1001,
              message: {
                id: 200,
                sender_email: "human@example.com",
                content: "Human's reply",
                subject: "Agent Q #abc123 — test",
              },
            },
          ],
        }),
      };
    });

    // Start polling
    const pollPromise = client.pollForReply(
      "queue-123",
      "999",
      "bot@example.com",
      abortController.signal,
    );

    // Fast-forward through retries
    await vi.advanceTimersByTimeAsync(5000); // First retry (pollIntervalMs)
    await vi.advanceTimersByTimeAsync(10000); // Second retry (2 * pollIntervalMs, exponential backoff)

    const reply = await pollPromise;

    expect(reply).toEqual({
      id: "200",
      sender_email: "human@example.com",
      content: "Human's reply",
      subject: "Agent Q #abc123 — test",
    });
    expect(mockFetch).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });

  it("should give up after max retries on HTTP errors", async () => {
    const abortController = new AbortController();
    vi.useFakeTimers();

    try {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "Server error",
      });

      let caughtError: Error | null = null;

      const pollPromise = client
        .pollForReply(
          "queue-123",
          "999",
          "bot@example.com",
          abortController.signal,
        )
        .catch((error: unknown) => {
          // Immediately catch to prevent unhandled rejection warning
          caughtError = error as Error;
          return null;
        });

      // Fast-forward through all retries (maxRetries = 10)
      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(Math.min(5000 * 2 ** i, 60000));
      }

      // Wait for the promise to settle
      await pollPromise;

      // The promise should have been rejected with the expected error
      expect(caughtError).toBeDefined();
      expect(caughtError).toBeInstanceOf(Error);
      expect((caughtError as Error | null)?.message).toMatch(
        /Failed to poll for reply/,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("should retry network errors", async () => {
    const abortController = new AbortController();
    vi.useFakeTimers();

    let callCount = 0;
    mockFetch.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new TypeError("Network error");
      }
      // Second call succeeds
      return {
        ok: true,
        json: async () => ({
          events: [
            {
              id: 1001,
              message: {
                id: 200,
                sender_email: "human@example.com",
                content: "Human's reply",
                subject: "Agent Q #abc123 — test",
              },
            },
          ],
        }),
      };
    });

    const pollPromise = client.pollForReply(
      "queue-123",
      "999",
      "bot@example.com",
      abortController.signal,
    );

    await vi.advanceTimersByTimeAsync(5000); // Retry delay (pollIntervalMs)

    const reply = await pollPromise;

    expect(reply).toEqual({
      id: "200",
      sender_email: "human@example.com",
      content: "Human's reply",
      subject: "Agent Q #abc123 — test",
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("should abort immediately during network-error retry backoff", async () => {
    const abortController = new AbortController();
    vi.useFakeTimers();

    mockFetch.mockRejectedValue(new TypeError("Network error"));

    const pollPromise = client.pollForReply(
      "queue-123",
      "999",
      "bot@example.com",
      abortController.signal,
    );

    await Promise.resolve();
    abortController.abort();

    const reply = await pollPromise;

    expect(reply).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("should abort immediately during HTTP 500 retry backoff", async () => {
    const abortController = new AbortController();
    vi.useFakeTimers();

    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "Server error",
    });

    const pollPromise = client.pollForReply(
      "queue-123",
      "999",
      "bot@example.com",
      abortController.signal,
    );

    await Promise.resolve();
    abortController.abort();

    const reply = await pollPromise;

    expect(reply).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("should deregister queue successfully", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
    });

    await expect(client.deregisterQueue("queue-123")).resolves.not.toThrow();
    expect(mockFetch).toHaveBeenCalledWith(
      "https://zulip.example.com/api/v1/events",
      expect.objectContaining({
        method: "DELETE",
      }),
    );
  });

  it("should handle deregister queue errors gracefully", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});

    await expect(client.deregisterQueue("queue-123")).resolves.not.toThrow();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to deregister queue queue-123"),
    );

    consoleWarnSpy.mockRestore();
  });

  it("should handle deregister queue network errors gracefully", async () => {
    mockFetch.mockImplementation(() => {
      throw new Error("Network error");
    });

    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});

    await expect(client.deregisterQueue("queue-123")).resolves.not.toThrow();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to deregister queue queue-123"),
      expect.any(Error),
    );

    consoleWarnSpy.mockRestore();
  });

  it("should use correct Authorization header", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 123 }),
    });

    await client.postMessage("stream", "topic", "content");

    const callArgs = mockFetch.mock.calls[0];
    if (!callArgs) {
      throw new Error("Expected fetch to be called");
    }
    const authHeader = callArgs[1]?.headers?.Authorization as string;

    expect(authHeader).toMatch(/^Basic [A-Za-z0-9+/]+=*$/);

    // Decode and verify credentials
    const base64Part = authHeader.replace("Basic ", "");
    const decoded = Buffer.from(base64Part, "base64").toString();
    expect(decoded).toBe("bot@example.com:test-api-key");
  });

  it("should validate credentials", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        email: "bot@example.com",
        full_name: "Bot User",
        user_id: 99,
      }),
    });

    const profile = await client.validateCredentials();

    expect(profile).toEqual({
      email: "bot@example.com",
      full_name: "Bot User",
      user_id: 99,
    });
  });

  it("should throw on credential validation failure", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "Invalid API key",
    });

    await expect(client.validateCredentials()).rejects.toThrow(
      /Failed to validate credentials: 401/,
    );
  });

  it("should create a stream", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => "",
    });

    await expect(
      client.createStream("new-stream", "My stream"),
    ).resolves.not.toThrow();

    expect(mockFetch).toHaveBeenCalledWith(
      "https://zulip.example.com/api/v1/users/me/subscriptions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("should throw when create stream fails", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: async () => "Invalid stream name",
    });

    await expect(client.createStream("bad", "bad")).rejects.toThrow(
      /Failed to create or subscribe to stream: 400/,
    );
  });

  it("should ensure subscribed to stream", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => "",
    });

    await expect(client.ensureSubscribed("test-stream")).resolves.not.toThrow();

    expect(mockFetch).toHaveBeenCalledWith(
      "https://zulip.example.com/api/v1/users/me/subscriptions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("should log ensureSubscribed call", async () => {
    const logger = { debug: vi.fn() };
    const clientWithLogger = createZulipClient({
      ...config,
      logger,
    });

    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => "",
    });

    await clientWithLogger.ensureSubscribed("test-stream");

    expect(logger.debug).toHaveBeenCalledWith(
      "ZulipClient.ensureSubscribed called",
      { streamName: "test-stream" },
    );
  });

  it("should throw when ensureSubscribed fails", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: async () => "Stream not found",
    });

    await expect(client.ensureSubscribed("nonexistent")).rejects.toThrow(
      /Failed to subscribe to stream: 400/,
    );
  });

  it("should check if stream exists", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ streams: [{ name: "alpha" }, { name: "beta" }] }),
    });

    await expect(client.checkStreamExists("beta")).resolves.toBe(true);
    await expect(client.checkStreamExists("gamma")).resolves.toBe(false);
  });

  it("should list stream subscriptions", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        subscriptions: [
          { name: "alpha", description: "desc", stream_id: 1 },
          { name: "beta" },
        ],
      }),
    });

    const subscriptions = await client.getStreamSubscriptions();

    expect(subscriptions).toEqual([
      { name: "alpha", description: "desc", stream_id: 1 },
      { name: "beta", description: undefined, stream_id: undefined },
    ]);
  });

  it("should handle trailing slash in server URL", async () => {
    const configWithSlash = {
      ...config,
      serverUrl: "https://zulip.example.com/",
    };
    const clientWithSlash = createZulipClient(configWithSlash);

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 123 }),
    });

    await clientWithSlash.postMessage("stream", "topic", "content");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://zulip.example.com/api/v1/messages",
      expect.anything(),
    );
  });

  describe("BAD_EVENT_QUEUE_ID re-registration", () => {
    it("should re-register queue on BAD_EVENT_QUEUE_ID error", async () => {
      vi.useFakeTimers();
      try {
        let callCount = 0;
        mockFetch.mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            // First poll returns BAD_EVENT_QUEUE_ID
            return Promise.resolve({
              ok: false,
              status: 400,
              statusText: "Bad Request",
              text: async () => "BAD_EVENT_QUEUE_ID",
            });
          } else if (callCount === 2) {
            // Re-register queue response
            return Promise.resolve({
              ok: true,
              json: async () => ({
                queue_id: "new-queue-456",
                last_event_id: 1000,
              }),
            });
          } else if (callCount === 3) {
            // Second poll succeeds
            return Promise.resolve({
              ok: true,
              json: async () => ({
                events: [
                  {
                    id: 1001,
                    type: "message",
                    message: {
                      id: 1002,
                      sender_email: "human@example.com",
                      content: "Here is the reply",
                      subject: "Agent Q #abc123 — test",
                    },
                  },
                ],
              }),
            });
          }
          return Promise.resolve({
            ok: true,
            json: async () => ({ events: [] }),
          });
        });

        const abortController = new AbortController();

        const pollPromise = client.pollForReply(
          "old-queue-123",
          "999",
          "bot@example.com",
          abortController.signal,
          {
            stream: "test-stream",
            topic: "test-topic",
          },
        );

        await vi.advanceTimersByTimeAsync(0); // Process first poll
        await vi.advanceTimersByTimeAsync(0); // Process re-register
        await vi.advanceTimersByTimeAsync(0); // Process second poll

        const result = await pollPromise;

        expect(result).toEqual({
          id: "1002",
          sender_email: "human@example.com",
          content: "Here is the reply",
          subject: "Agent Q #abc123 — test",
        });

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining("api/v1/register"),
          expect.anything(),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("should give up after max re-registration attempts", async () => {
      vi.useFakeTimers();
      try {
        mockFetch.mockImplementation((url) => {
          const urlStr = url.toString();
          if (urlStr.includes("/register")) {
            // Re-register always succeeds
            return Promise.resolve({
              ok: true,
              json: async () => ({
                queue_id: `new-queue-${Math.random()}`,
                last_event_id: 1000,
              }),
            });
          }
          // Poll always returns BAD_EVENT_QUEUE_ID
          return Promise.resolve({
            ok: false,
            status: 400,
            statusText: "Bad Request",
            text: async () => "BAD_EVENT_QUEUE_ID",
          });
        });

        const abortController = new AbortController();
        const logger = { debug: vi.fn() };
        const clientWithLogger = createZulipClient({
          ...config,
          logger,
        });

        await expect(
          clientWithLogger.pollForReply(
            "queue-123",
            "999",
            "bot@example.com",
            abortController.signal,
            {
              stream: "test-stream",
              topic: "test-topic",
            },
          ),
        ).rejects.toThrow(/Failed to poll for reply/);

        // Should have attempted to re-register 3 times (max)
        const registerCalls = mockFetch.mock.calls.filter((call) =>
          call[0]?.toString().includes("/register"),
        );
        expect(registerCalls.length).toBe(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it("should not re-register when stream/topic not provided", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        text: async () => "BAD_EVENT_QUEUE_ID",
      });

      await expect(
        client.pollForReply(
          "queue-123",
          "999",
          "bot@example.com",
          new AbortController().signal,
        ),
      ).rejects.toThrow(/Failed to poll for reply/);

      // Should not call register
      const registerCalls = mockFetch.mock.calls.filter((call) =>
        call[0]?.toString().includes("/register"),
      );
      expect(registerCalls.length).toBe(0);
    });
  });

  describe("message ID filtering", () => {
    it("should skip messages with id <= questionMessageId", async () => {
      const logger = { debug: vi.fn() };
      const clientWithLogger = createZulipClient({
        ...config,
        logger,
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          events: [
            {
              id: 1001,
              type: "message",
              message: {
                id: 99, // Before question (id 100)
                sender_email: "human@example.com",
                content: "Old message",
                subject: "Agent Q #abc123 — test",
              },
            },
            {
              id: 1002,
              type: "message",
              message: {
                id: 100, // The question itself
                sender_email: "bot@example.com",
                content: "Question",
                subject: "Agent Q #abc123 — test",
              },
            },
            {
              id: 1003,
              type: "message",
              message: {
                id: 101, // After question
                sender_email: "human@example.com",
                content: "Real reply",
                subject: "Agent Q #abc123 — test",
              },
            },
          ],
        }),
      });

      const result = await clientWithLogger.pollForReply(
        "queue-123",
        "999",
        "bot@example.com",
        new AbortController().signal,
        {
          questionMessageId: "100",
        },
      );

      expect(result).toEqual({
        id: "101",
        sender_email: "human@example.com",
        content: "Real reply",
        subject: "Agent Q #abc123 — test",
      });

      expect(logger.debug).toHaveBeenCalledWith("Skipping stale message", {
        messageId: 99,
        questionMessageId: "100",
      });
    });

    it("should accept all messages when questionMessageId not provided", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          events: [
            {
              id: 1001,
              type: "message",
              message: {
                id: 99,
                sender_email: "human@example.com",
                content: "Reply",
                subject: "Agent Q #abc123 — test",
              },
            },
          ],
        }),
      });

      const result = await client.pollForReply(
        "queue-123",
        "999",
        "bot@example.com",
        new AbortController().signal,
      );

      expect(result).toEqual({
        id: "99",
        sender_email: "human@example.com",
        content: "Reply",
        subject: "Agent Q #abc123 — test",
      });
    });
  });
});
