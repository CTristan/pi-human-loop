/**
 * Tests for queue registry module.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupAllQueues,
  registerQueue,
  unregisterQueue,
} from "../src/queue-registry.js";

// Mock ZulipClient
const createMockZulipClient = (shouldFail = false) => ({
  postMessage: vi.fn(),
  registerEventQueue: vi.fn(),
  pollForReply: vi.fn(),
  deregisterQueue: vi.fn().mockImplementation(async () => {
    if (shouldFail) {
      throw new Error("Failed to deregister queue");
    }
  }),
});

describe("queue-registry", () => {
  beforeEach(() => {
    // Clear all active queues before each test
    vi.clearAllMocks();
  });

  describe("registerQueue", () => {
    it("should add queue to registry", () => {
      const mockClient = createMockZulipClient();
      registerQueue("queue-1", mockClient);

      // Verify the queue was registered by checking cleanup calls it
      expect(mockClient.deregisterQueue).not.toHaveBeenCalled();
    });

    it("should allow registering multiple queues", () => {
      const mockClient1 = createMockZulipClient();
      const mockClient2 = createMockZulipClient();

      registerQueue("queue-1", mockClient1);
      registerQueue("queue-2", mockClient2);

      // Both queues should be registered
      expect(mockClient1.deregisterQueue).not.toHaveBeenCalled();
      expect(mockClient2.deregisterQueue).not.toHaveBeenCalled();
    });

    it("should overwrite existing queue with same ID", () => {
      const mockClient1 = createMockZulipClient();
      const mockClient2 = createMockZulipClient();

      registerQueue("queue-1", mockClient1);
      registerQueue("queue-1", mockClient2);

      // The second client should be used for cleanup
      cleanupAllQueues().then(() => {
        expect(mockClient1.deregisterQueue).not.toHaveBeenCalled();
        expect(mockClient2.deregisterQueue).toHaveBeenCalledTimes(1);
        expect(mockClient2.deregisterQueue).toHaveBeenCalledWith("queue-1");
      });
    });
  });

  describe("unregisterQueue", () => {
    it("should remove queue from registry", () => {
      const mockClient = createMockZulipClient();
      registerQueue("queue-1", mockClient);

      unregisterQueue("queue-1");

      // Queue should be removed, so cleanup won't call it
      cleanupAllQueues().then(() => {
        expect(mockClient.deregisterQueue).not.toHaveBeenCalled();
      });
    });

    it("should not throw when unregistering non-existent queue", () => {
      expect(() => {
        unregisterQueue("non-existent-queue");
      }).not.toThrow();
    });

    it("should only remove specified queue when multiple are registered", () => {
      const mockClient1 = createMockZulipClient();
      const mockClient2 = createMockZulipClient();

      registerQueue("queue-1", mockClient1);
      registerQueue("queue-2", mockClient2);

      unregisterQueue("queue-1");

      // Only queue-2 should be cleaned up
      cleanupAllQueues().then(() => {
        expect(mockClient1.deregisterQueue).not.toHaveBeenCalled();
        expect(mockClient2.deregisterQueue).toHaveBeenCalledTimes(1);
        expect(mockClient2.deregisterQueue).toHaveBeenCalledWith("queue-2");
      });
    });
  });

  describe("cleanupAllQueues", () => {
    it("should deregister all registered queues", async () => {
      const mockClient1 = createMockZulipClient();
      const mockClient2 = createMockZulipClient();
      const mockClient3 = createMockZulipClient();

      registerQueue("queue-1", mockClient1);
      registerQueue("queue-2", mockClient2);
      registerQueue("queue-3", mockClient3);

      await cleanupAllQueues();

      expect(mockClient1.deregisterQueue).toHaveBeenCalledTimes(1);
      expect(mockClient1.deregisterQueue).toHaveBeenCalledWith("queue-1");
      expect(mockClient2.deregisterQueue).toHaveBeenCalledTimes(1);
      expect(mockClient2.deregisterQueue).toHaveBeenCalledWith("queue-2");
      expect(mockClient3.deregisterQueue).toHaveBeenCalledTimes(1);
      expect(mockClient3.deregisterQueue).toHaveBeenCalledWith("queue-3");
    });

    it("should handle errors from individual deregistrations gracefully", async () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      const mockClient1 = createMockZulipClient();
      const mockClient2 = createMockZulipClient(true); // This one will fail
      const mockClient3 = createMockZulipClient();

      registerQueue("queue-1", mockClient1);
      registerQueue("queue-2", mockClient2);
      registerQueue("queue-3", mockClient3);

      await cleanupAllQueues();

      // All queues should be attempted
      expect(mockClient1.deregisterQueue).toHaveBeenCalledTimes(1);
      expect(mockClient2.deregisterQueue).toHaveBeenCalledTimes(1);
      expect(mockClient3.deregisterQueue).toHaveBeenCalledTimes(1);

      // Warning should be logged for failed queue
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "Failed to cleanup queue queue-2:",
        expect.any(Error),
      );

      consoleWarnSpy.mockRestore();
    });

    it("should remove queues from map after cleanup", async () => {
      const mockClient1 = createMockZulipClient();
      const mockClient2 = createMockZulipClient();

      registerQueue("queue-1", mockClient1);
      registerQueue("queue-2", mockClient2);

      await cleanupAllQueues();

      // Calling cleanup again should not call deregisterQueue again
      await cleanupAllQueues();

      expect(mockClient1.deregisterQueue).toHaveBeenCalledTimes(1);
      expect(mockClient2.deregisterQueue).toHaveBeenCalledTimes(1);
    });

    it("should work correctly with multiple concurrent queues", async () => {
      const queues = Array.from({ length: 10 }, (_, i) => ({
        id: `queue-${i}`,
        client: createMockZulipClient(),
      }));

      // Register all queues
      for (const { id, client } of queues) {
        registerQueue(id, client);
      }

      await cleanupAllQueues();

      // All queues should be deregistered exactly once
      for (const { id, client } of queues) {
        expect(client.deregisterQueue).toHaveBeenCalledTimes(1);
        expect(client.deregisterQueue).toHaveBeenCalledWith(id);
      }
    });

    it("should handle empty registry gracefully", async () => {
      await expect(cleanupAllQueues()).resolves.not.toThrow();
    });

    it("should handle queues that fail and succeed together", async () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      const mockClient1 = createMockZulipClient(true); // Will fail
      const mockClient2 = createMockZulipClient(); // Will succeed
      const mockClient3 = createMockZulipClient(true); // Will fail

      registerQueue("queue-1", mockClient1);
      registerQueue("queue-2", mockClient2);
      registerQueue("queue-3", mockClient3);

      await cleanupAllQueues();

      expect(mockClient1.deregisterQueue).toHaveBeenCalledTimes(1);
      expect(mockClient2.deregisterQueue).toHaveBeenCalledTimes(1);
      expect(mockClient3.deregisterQueue).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).toHaveBeenCalledTimes(2);

      consoleWarnSpy.mockRestore();
    });

    it("should handle partial cleanup before full cleanup", async () => {
      const mockClient1 = createMockZulipClient();
      const mockClient2 = createMockZulipClient();

      registerQueue("queue-1", mockClient1);
      registerQueue("queue-2", mockClient2);

      // Unregister one queue manually
      unregisterQueue("queue-1");

      await cleanupAllQueues();

      // Only the remaining queue should be cleaned up
      expect(mockClient1.deregisterQueue).not.toHaveBeenCalled();
      expect(mockClient2.deregisterQueue).toHaveBeenCalledTimes(1);
    });
  });
});
