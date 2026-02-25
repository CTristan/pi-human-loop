/**
 * Tests for Zulip client.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createZulipClient, type ZulipClient } from "../src/zulip-client.ts";

describe("zulip-client", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let client: ZulipClient;
  const config = {
    serverUrl: "https://zulip.example.com",
    botEmail: "bot@example.com",
    botApiKey: "test-api-key",
    stream: "test-stream",
    pollIntervalMs: 5000,
  };

  beforeEach(() => {
    // Reset fetch mock
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    // Create client
    client = createZulipClient(config);
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
    const body = callArgs[1]?.body as string;
    expect(body).toContain("event_types=%5B%22message%22%5D"); // ["message"]
    expect(body).toContain(
      "narrow=%5B%5B%22stream%22%2C%22my-stream%22%5D%2C%5B%22topic%22%2C%22my-topic%22%5D%5D",
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
            },
          },
          {
            id: 1002,
            message: {
              id: 201,
              sender_email: "human2@example.com",
              content: "Second reply",
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
    await vi.advanceTimersByTimeAsync(1000); // First retry
    await vi.advanceTimersByTimeAsync(2000); // Second retry (exponential backoff)

    const reply = await pollPromise;

    expect(reply).toEqual({
      id: "200",
      sender_email: "human@example.com",
      content: "Human's reply",
    });
    expect(mockFetch).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });

  it("should give up after max retries on HTTP errors", async () => {
    const abortController = new AbortController();
    vi.useFakeTimers();

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
      .catch((error) => {
        // Immediately catch to prevent unhandled rejection warning
        caughtError = error as Error;
        return null;
      });

    // Fast-forward through all retries (maxRetries = 10)
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(Math.min(1000 * 2 ** i, 60000));
    }

    // Wait for the promise to settle
    await pollPromise;

    // The promise should have been rejected with the expected error
    expect(caughtError).toBeDefined();
    expect(caughtError).toBeInstanceOf(Error);
    expect(caughtError?.message).toMatch(/Failed to poll for reply/);

    vi.useRealTimers();
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

    await vi.advanceTimersByTimeAsync(1000); // Retry delay

    const reply = await pollPromise;

    expect(reply).toEqual({
      id: "200",
      sender_email: "human@example.com",
      content: "Human's reply",
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);

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
    const authHeader = callArgs[1]?.headers?.Authorization as string;

    expect(authHeader).toMatch(/^Basic [A-Za-z0-9+/]+=*$/);

    // Decode and verify credentials
    const base64Part = authHeader.replace("Basic ", "");
    const decoded = Buffer.from(base64Part, "base64").toString();
    expect(decoded).toBe("bot@example.com:test-api-key");
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
});
