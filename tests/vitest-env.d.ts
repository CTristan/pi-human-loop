/**
 * Vitest type definitions for test environment.
 */

declare module "vitest" {
  export interface MockedFunction<T extends (...args: unknown[]) => unknown> {
    mockResolvedValue: (value: unknown) => MockInstance<T>;
    mockRejectedValue: (value: unknown) => MockInstance<T>;
    mockImplementation: (fn: T) => MockInstance<T>;
  }
}

declare module "../src/zulip-client.ts" {
  export interface ZulipClient {
    postMessage: ReturnType<typeof import("vitest").vi.fn>;
    registerEventQueue: ReturnType<typeof import("vitest").vi.fn>;
    pollForReply: ReturnType<typeof import("vitest").vi.fn>;
    deregisterQueue: ReturnType<typeof import("vitest").vi.fn>;
  }
}

declare global {
  // Global fetch mock
  var fetch: ReturnType<typeof import("vitest").vi.fn>;
}
