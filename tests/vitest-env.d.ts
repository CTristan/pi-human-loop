/**
 * Vitest type definitions for test environment.
 */

/// <reference types="vitest/globals" />

import type { ZulipClient } from "../src/zulip-client.js";

declare global {
  // Global fetch mock - typed to accept vi.fn() while providing typed calls array
  var fetch: unknown & {
    mock: {
      calls: Array<[RequestInfo | URL, RequestInit?]>;
      implementation?: (...args: unknown[]) => unknown;
    };
  };
}

// Export a type for the mocked ZulipClient to use in tests
export type MockedZulipClient = {
  postMessage: ReturnType<typeof vi.fn<ZulipClient["postMessage"]>>;
  registerEventQueue: ReturnType<
    typeof vi.fn<ZulipClient["registerEventQueue"]>
  >;
  pollForReply: ReturnType<typeof vi.fn<ZulipClient["pollForReply"]>>;
  deregisterQueue: ReturnType<typeof vi.fn<ZulipClient["deregisterQueue"]>>;
};
